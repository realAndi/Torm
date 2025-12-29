/**
 * UDP Tracker Client Implementation
 *
 * Implements the UDP tracker protocol as defined in BEP-15:
 * https://www.bittorrent.org/beps/bep_0015.html
 *
 * The UDP tracker protocol uses a two-step process:
 * 1. Connect: Get a connection ID from the tracker (valid for 1 minute)
 * 2. Announce: Request peers using the connection ID
 *
 * @module engine/tracker/udp
 */

import dgram from 'dgram';
import { TrackerError } from '../types.js';

// =============================================================================
// Constants
// =============================================================================

/** Magic protocol ID for UDP tracker connect request */
const PROTOCOL_ID = BigInt('0x41727101980');

/** Action codes as per BEP-15 */
const Action = {
  CONNECT: 0,
  ANNOUNCE: 1,
  SCRAPE: 2,
  ERROR: 3,
} as const;

/** Initial timeout in milliseconds (5 seconds - reduced for better UX) */
const INITIAL_TIMEOUT_MS = 5000;

/** Maximum number of retries (1 - minimal since we try all trackers in parallel) */
const MAX_RETRIES = 1;

/** Connection ID validity period (1 minute) */
const CONNECTION_ID_TTL_MS = 60000;

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for an announce request to a UDP tracker.
 */
export interface UDPAnnounceParams {
  /** 20-byte info hash of the torrent */
  infoHash: Buffer;

  /** 20-byte peer ID */
  peerId: Buffer;

  /** Number of bytes downloaded */
  downloaded: bigint;

  /** Number of bytes remaining to download */
  left: bigint;

  /** Number of bytes uploaded */
  uploaded: bigint;

  /** Event type: 0=none, 1=completed, 2=started, 3=stopped */
  event: 0 | 1 | 2 | 3;

  /** Port number we're listening on */
  port: number;

  /** Number of peers to request (default: -1 for tracker's choice) */
  numWant?: number;
}

/**
 * Response from a UDP tracker announce request.
 */
export interface UDPAnnounceResponse {
  /** Interval in seconds until next announce */
  interval: number;

  /** Number of leechers (incomplete peers) */
  leechers: number;

  /** Number of seeders (complete peers) */
  seeders: number;

  /** List of peers returned by the tracker */
  peers: Array<{ ip: string; port: number }>;
}

/**
 * Cached connection information for a UDP tracker.
 */
interface ConnectionCache {
  /** Connection ID received from tracker */
  connectionId: bigint;

  /** Timestamp when the connection ID was received */
  timestamp: number;
}

/**
 * Pending request waiting for a response.
 */
interface PendingRequest {
  /** Resolve the promise with a response buffer */
  resolve: (response: Buffer) => void;

  /** Reject the promise with an error */
  reject: (error: Error) => void;

  /** Timeout handle for the request */
  timeout: ReturnType<typeof setTimeout>;

  /** Expected action code for validation */
  expectedAction: number;
}

// =============================================================================
// UDPTracker Class
// =============================================================================

/**
 * UDP Tracker client implementing BEP-15.
 *
 * Handles connection management, announce requests, and automatic
 * retries with exponential backoff.
 *
 * @example
 * ```typescript
 * const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
 *
 * const response = await tracker.announce({
 *   infoHash: Buffer.from('...'),
 *   peerId: Buffer.from('...'),
 *   downloaded: 0n,
 *   left: 1000000n,
 *   uploaded: 0n,
 *   event: 2, // started
 *   port: 6881,
 * });
 *
 * console.log(`Got ${response.peers.length} peers`);
 *
 * tracker.close();
 * ```
 */
export class UDPTracker {
  private readonly host: string;
  private readonly port: number;
  private readonly announceUrl: string;
  private socket: dgram.Socket | null = null;
  private connectionCache: ConnectionCache | null = null;
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private closed = false;

  /**
   * Creates a new UDP tracker client.
   *
   * @param announceUrl - The UDP tracker URL (e.g., "udp://tracker.example.com:6969/announce")
   * @throws {TrackerError} If the URL is invalid or not a UDP URL
   */
  constructor(announceUrl: string) {
    this.announceUrl = announceUrl;

    const parsed = this.parseUrl(announceUrl);
    this.host = parsed.host;
    this.port = parsed.port;
  }

  /**
   * Performs an announce request to the tracker.
   *
   * This method will:
   * 1. Connect to the tracker if no valid connection ID exists
   * 2. Send the announce request
   * 3. Parse and return the response
   *
   * @param params - Announce parameters
   * @returns Promise resolving to the announce response
   * @throws {TrackerError} If the request fails after all retries
   */
  async announce(params: UDPAnnounceParams): Promise<UDPAnnounceResponse> {
    if (this.closed) {
      throw new TrackerError('Tracker client is closed', this.announceUrl);
    }

    // Validate parameters
    if (params.infoHash.length !== 20) {
      throw new TrackerError('info_hash must be 20 bytes', this.announceUrl);
    }
    if (params.peerId.length !== 20) {
      throw new TrackerError('peer_id must be 20 bytes', this.announceUrl);
    }

    // Ensure we have a valid connection
    const connectionId = await this.ensureConnected();

    // Build and send announce request
    const transactionId = this.generateTransactionId();
    const request = this.buildAnnounceRequest(connectionId, transactionId, params);

    const response = await this.sendRequest(request, transactionId, Action.ANNOUNCE);

    return this.parseAnnounceResponse(response);
  }

  /**
   * Closes the tracker client and releases resources.
   *
   * After calling close(), the client cannot be used again.
   */
  close(): void {
    this.closed = true;

    // Reject all pending requests
    for (const [transactionId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new TrackerError('Tracker client closed', this.announceUrl));
      this.pendingRequests.delete(transactionId);
    }

    // Close socket
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Ignore close errors
      }
      this.socket = null;
    }

    this.connectionCache = null;
  }

  // ===========================================================================
  // Private Methods - URL Parsing
  // ===========================================================================

  /**
   * Parses a UDP tracker URL.
   */
  private parseUrl(url: string): { host: string; port: number } {
    // Handle UDP URLs which URL class doesn't parse well
    const match = url.match(/^udp:\/\/([^:/]+)(?::(\d+))?/);
    if (!match) {
      throw new TrackerError(`Invalid UDP tracker URL: ${url}`, url);
    }

    const host = match[1];
    const port = match[2] ? parseInt(match[2], 10) : 80;

    if (port < 1 || port > 65535) {
      throw new TrackerError(`Invalid port in URL: ${url}`, url);
    }

    return { host, port };
  }

  // ===========================================================================
  // Private Methods - Socket Management
  // ===========================================================================

  /**
   * Gets or creates the UDP socket.
   */
  private getSocket(): dgram.Socket {
    if (this.socket) {
      return this.socket;
    }

    // Determine socket type based on host
    const socketType = this.isIPv6(this.host) ? 'udp6' : 'udp4';
    this.socket = dgram.createSocket(socketType);

    this.socket.on('message', (msg) => this.handleMessage(msg));
    this.socket.on('error', (err) => this.handleSocketError(err));

    return this.socket;
  }

  /**
   * Checks if a host is an IPv6 address.
   */
  private isIPv6(host: string): boolean {
    return host.includes(':');
  }

  /**
   * Handles incoming UDP messages.
   */
  private handleMessage(msg: Buffer): void {
    if (msg.length < 8) {
      // Invalid response - too short
      return;
    }

    const action = msg.readUInt32BE(0);
    const transactionId = msg.readUInt32BE(4);

    const pending = this.pendingRequests.get(transactionId);
    if (!pending) {
      // No matching request
      return;
    }

    // Clear timeout
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(transactionId);

    // Handle error response
    if (action === Action.ERROR) {
      const errorMessage = msg.length > 8 ? msg.subarray(8).toString('utf8') : 'Unknown error';
      pending.reject(new TrackerError(errorMessage, this.announceUrl));
      return;
    }

    // Validate action
    if (action !== pending.expectedAction) {
      pending.reject(
        new TrackerError(
          `Unexpected action: expected ${pending.expectedAction}, got ${action}`,
          this.announceUrl,
        ),
      );
      return;
    }

    pending.resolve(msg);
  }

  /**
   * Handles socket errors.
   */
  private handleSocketError(err: Error): void {
    // Reject all pending requests with this error
    for (const [transactionId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new TrackerError(`Socket error: ${err.message}`, this.announceUrl));
      this.pendingRequests.delete(transactionId);
    }
  }

  // ===========================================================================
  // Private Methods - Connection Management
  // ===========================================================================

  /**
   * Ensures we have a valid connection ID, connecting if necessary.
   */
  private async ensureConnected(): Promise<bigint> {
    // Check if we have a valid cached connection
    if (this.connectionCache) {
      const age = Date.now() - this.connectionCache.timestamp;
      if (age < CONNECTION_ID_TTL_MS) {
        return this.connectionCache.connectionId;
      }
      // Connection expired
      this.connectionCache = null;
    }

    // Need to connect
    return this.connect();
  }

  /**
   * Performs the connect handshake with the tracker.
   */
  private async connect(): Promise<bigint> {
    const transactionId = this.generateTransactionId();
    const request = this.buildConnectRequest(transactionId);

    const response = await this.sendRequest(request, transactionId, Action.CONNECT);

    // Parse connect response (16 bytes)
    // Offset 0: action (4 bytes) - already validated
    // Offset 4: transaction_id (4 bytes) - already validated
    // Offset 8: connection_id (8 bytes)
    if (response.length < 16) {
      throw new TrackerError('Connect response too short', this.announceUrl);
    }

    const connectionId = response.readBigUInt64BE(8);

    // Cache the connection
    this.connectionCache = {
      connectionId,
      timestamp: Date.now(),
    };

    return connectionId;
  }

  // ===========================================================================
  // Private Methods - Request Building
  // ===========================================================================

  /**
   * Builds a connect request packet.
   *
   * Format (16 bytes):
   * - Offset 0: protocol_id (8 bytes) - 0x41727101980
   * - Offset 8: action (4 bytes) - 0 for connect
   * - Offset 12: transaction_id (4 bytes)
   */
  private buildConnectRequest(transactionId: number): Buffer {
    const buffer = Buffer.alloc(16);

    buffer.writeBigUInt64BE(PROTOCOL_ID, 0);
    buffer.writeUInt32BE(Action.CONNECT, 8);
    buffer.writeUInt32BE(transactionId, 12);

    return buffer;
  }

  /**
   * Builds an announce request packet.
   *
   * Format (98 bytes minimum):
   * - Offset 0: connection_id (8 bytes)
   * - Offset 8: action (4 bytes) - 1 for announce
   * - Offset 12: transaction_id (4 bytes)
   * - Offset 16: info_hash (20 bytes)
   * - Offset 36: peer_id (20 bytes)
   * - Offset 56: downloaded (8 bytes)
   * - Offset 64: left (8 bytes)
   * - Offset 72: uploaded (8 bytes)
   * - Offset 80: event (4 bytes)
   * - Offset 84: IP address (4 bytes) - 0 for default
   * - Offset 88: key (4 bytes) - random
   * - Offset 92: num_want (4 bytes) - -1 for default
   * - Offset 96: port (2 bytes)
   */
  private buildAnnounceRequest(
    connectionId: bigint,
    transactionId: number,
    params: UDPAnnounceParams,
  ): Buffer {
    const buffer = Buffer.alloc(98);

    buffer.writeBigUInt64BE(connectionId, 0);
    buffer.writeUInt32BE(Action.ANNOUNCE, 8);
    buffer.writeUInt32BE(transactionId, 12);
    params.infoHash.copy(buffer, 16);
    params.peerId.copy(buffer, 36);
    buffer.writeBigUInt64BE(params.downloaded, 56);
    buffer.writeBigUInt64BE(params.left, 64);
    buffer.writeBigUInt64BE(params.uploaded, 72);
    buffer.writeUInt32BE(params.event, 80);
    buffer.writeUInt32BE(0, 84); // IP address - 0 for default
    buffer.writeUInt32BE(this.generateKey(), 88);
    buffer.writeInt32BE(params.numWant ?? -1, 92);
    buffer.writeUInt16BE(params.port, 96);

    return buffer;
  }

  // ===========================================================================
  // Private Methods - Request Sending
  // ===========================================================================

  /**
   * Sends a request and waits for a response with retries.
   */
  private async sendRequest(
    request: Buffer,
    transactionId: number,
    expectedAction: number,
  ): Promise<Buffer> {
    let retries = 0;
    let timeout = INITIAL_TIMEOUT_MS;

    while (retries <= MAX_RETRIES) {
      try {
        return await this.sendRequestOnce(request, transactionId, expectedAction, timeout);
      } catch (err) {
        if (this.closed) {
          throw err;
        }

        const isTimeout = err instanceof TrackerError && err.message.includes('timeout');

        if (!isTimeout || retries >= MAX_RETRIES) {
          throw err;
        }

        // Exponential backoff
        retries++;
        timeout *= 2;

        // Generate new transaction ID for retry
        const newTransactionId = this.generateTransactionId();

        // Update transaction ID in request
        request.writeUInt32BE(newTransactionId, expectedAction === Action.CONNECT ? 12 : 12);

        // Remove old pending request
        const old = this.pendingRequests.get(transactionId);
        if (old) {
          clearTimeout(old.timeout);
          this.pendingRequests.delete(transactionId);
        }
      }
    }

    throw new TrackerError(
      `Request failed after ${MAX_RETRIES} retries`,
      this.announceUrl,
    );
  }

  /**
   * Sends a single request and waits for response.
   */
  private sendRequestOnce(
    request: Buffer,
    transactionId: number,
    expectedAction: number,
    timeoutMs: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const socket = this.getSocket();

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(transactionId);
        reject(new TrackerError(`Request timeout after ${timeoutMs}ms`, this.announceUrl));
      }, timeoutMs);

      // Store pending request
      this.pendingRequests.set(transactionId, {
        resolve,
        reject,
        timeout,
        expectedAction,
      });

      // Send the request
      socket.send(request, 0, request.length, this.port, this.host, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(transactionId);
          reject(new TrackerError(`Send failed: ${err.message}`, this.announceUrl));
        }
      });
    });
  }

  // ===========================================================================
  // Private Methods - Response Parsing
  // ===========================================================================

  /**
   * Parses an announce response.
   *
   * Format (20+ bytes):
   * - Offset 0: action (4 bytes) - already validated
   * - Offset 4: transaction_id (4 bytes) - already validated
   * - Offset 8: interval (4 bytes)
   * - Offset 12: leechers (4 bytes)
   * - Offset 16: seeders (4 bytes)
   * - Offset 20+: peers (6 bytes each: 4 byte IP + 2 byte port)
   */
  private parseAnnounceResponse(response: Buffer): UDPAnnounceResponse {
    if (response.length < 20) {
      throw new TrackerError('Announce response too short', this.announceUrl);
    }

    const interval = response.readUInt32BE(8);
    const leechers = response.readUInt32BE(12);
    const seeders = response.readUInt32BE(16);

    // Parse peers (6 bytes each)
    const peers: Array<{ ip: string; port: number }> = [];
    const peerData = response.subarray(20);
    const peerCount = Math.floor(peerData.length / 6);

    for (let i = 0; i < peerCount; i++) {
      const offset = i * 6;
      const ip = `${peerData[offset]}.${peerData[offset + 1]}.${peerData[offset + 2]}.${peerData[offset + 3]}`;
      const port = peerData.readUInt16BE(offset + 4);

      // Skip invalid peers
      if (port > 0) {
        peers.push({ ip, port });
      }
    }

    return {
      interval,
      leechers,
      seeders,
      peers,
    };
  }

  // ===========================================================================
  // Private Methods - Utilities
  // ===========================================================================

  /**
   * Generates a random 32-bit transaction ID.
   */
  private generateTransactionId(): number {
    return Math.floor(Math.random() * 0xffffffff);
  }

  /**
   * Generates a random 32-bit key for the announce request.
   */
  private generateKey(): number {
    return Math.floor(Math.random() * 0xffffffff);
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Builds a connect request buffer.
 * Exported for testing purposes.
 *
 * @internal
 */
export function buildConnectRequest(transactionId: number): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.writeBigUInt64BE(PROTOCOL_ID, 0);
  buffer.writeUInt32BE(Action.CONNECT, 8);
  buffer.writeUInt32BE(transactionId, 12);
  return buffer;
}

/**
 * Parses a connect response buffer.
 * Exported for testing purposes.
 *
 * @internal
 */
export function parseConnectResponse(response: Buffer): {
  action: number;
  transactionId: number;
  connectionId: bigint;
} {
  if (response.length < 16) {
    throw new Error('Connect response too short');
  }

  return {
    action: response.readUInt32BE(0),
    transactionId: response.readUInt32BE(4),
    connectionId: response.readBigUInt64BE(8),
  };
}

/**
 * Builds an announce request buffer.
 * Exported for testing purposes.
 *
 * @internal
 */
export function buildAnnounceRequest(
  connectionId: bigint,
  transactionId: number,
  params: UDPAnnounceParams & { key?: number },
): Buffer {
  const buffer = Buffer.alloc(98);

  buffer.writeBigUInt64BE(connectionId, 0);
  buffer.writeUInt32BE(Action.ANNOUNCE, 8);
  buffer.writeUInt32BE(transactionId, 12);
  params.infoHash.copy(buffer, 16);
  params.peerId.copy(buffer, 36);
  buffer.writeBigUInt64BE(params.downloaded, 56);
  buffer.writeBigUInt64BE(params.left, 64);
  buffer.writeBigUInt64BE(params.uploaded, 72);
  buffer.writeUInt32BE(params.event, 80);
  buffer.writeUInt32BE(0, 84); // IP address
  buffer.writeUInt32BE(params.key ?? 0, 88);
  buffer.writeInt32BE(params.numWant ?? -1, 92);
  buffer.writeUInt16BE(params.port, 96);

  return buffer;
}

/**
 * Parses an announce response buffer.
 * Exported for testing purposes.
 *
 * @internal
 */
export function parseAnnounceResponse(response: Buffer): UDPAnnounceResponse & {
  action: number;
  transactionId: number;
} {
  if (response.length < 20) {
    throw new Error('Announce response too short');
  }

  const action = response.readUInt32BE(0);
  const transactionId = response.readUInt32BE(4);
  const interval = response.readUInt32BE(8);
  const leechers = response.readUInt32BE(12);
  const seeders = response.readUInt32BE(16);

  const peers: Array<{ ip: string; port: number }> = [];
  const peerData = response.subarray(20);
  const peerCount = Math.floor(peerData.length / 6);

  for (let i = 0; i < peerCount; i++) {
    const offset = i * 6;
    const ip = `${peerData[offset]}.${peerData[offset + 1]}.${peerData[offset + 2]}.${peerData[offset + 3]}`;
    const port = peerData.readUInt16BE(offset + 4);

    if (port > 0) {
      peers.push({ ip, port });
    }
  }

  return {
    action,
    transactionId,
    interval,
    leechers,
    seeders,
    peers,
  };
}

/**
 * Protocol constants exported for testing.
 * @internal
 */
export const UDP_PROTOCOL = {
  PROTOCOL_ID,
  Action,
  INITIAL_TIMEOUT_MS,
  MAX_RETRIES,
  CONNECTION_ID_TTL_MS,
} as const;
