/**
 * Peer Connection Manager for Torm Engine
 *
 * Manages peer connections for all active torrents, handling connection
 * establishment, protocol handshakes, message routing, and connection limits.
 *
 * @module engine/peer/manager
 */

import { TypedEventEmitter } from '../events.js';
import { Peer, PeerError } from '../types.js';
import { PeerConnection } from './connection.js';
import { WireProtocol } from './protocol.js';
import { ExtensionManager, type PexPeer } from './extension.js';
import { hasCapability } from './messages.js';
import { smartConnect } from './smart-connect.js';
import type { PeerInfo } from '../tracker/client.js';
import { lookupCountry } from '../geoip.js';

// =============================================================================
// Constants
// =============================================================================

/** BitTorrent protocol identifier (19 bytes + "BitTorrent protocol") */
const _PROTOCOL_STRING = 'BitTorrent protocol';

/** Number of samples to keep for speed calculation */
const SPEED_SAMPLE_COUNT = 10;

/** Interval between speed samples in milliseconds */
const SPEED_SAMPLE_INTERVAL = 1000;

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Events emitted by the PeerManager
 */
export interface PeerManagerEvents {
  /** Emitted when a peer connection is established and handshake complete */
  peerConnected: { infoHash: string; peer: Peer };

  /** Emitted when a peer disconnects */
  peerDisconnected: { infoHash: string; peerId: string; reason: string };

  /** Emitted when a protocol message is received from a peer */
  peerMessage: { infoHash: string; peerId: string; type: string; payload: unknown };

  /** Emitted when a peer encounters an error */
  peerError: { infoHash: string; peerId: string; error: Error };

  /** Emitted when a peer sends a choke message */
  peerChoked: { infoHash: string; peerId: string };

  /** Emitted when a peer sends an unchoke message */
  peerUnchoked: { infoHash: string; peerId: string };

  /** Emitted when a peer sends an interested message */
  peerInterested: { infoHash: string; peerId: string };

  /** Emitted when a peer sends a not interested message */
  peerNotInterested: { infoHash: string; peerId: string };

  /** Emitted when a peer announces they have a piece */
  peerHave: { infoHash: string; peerId: string; pieceIndex: number };

  /** Emitted when a peer sends their bitfield */
  peerBitfield: { infoHash: string; peerId: string; bitfield: Buffer };

  /** Emitted when a piece block is received from a peer */
  pieceReceived: {
    infoHash: string;
    peerId: string;
    pieceIndex: number;
    begin: number;
    block: Buffer;
  };

  /** Emitted when a peer requests a piece block */
  requestReceived: {
    infoHash: string;
    peerId: string;
    pieceIndex: number;
    begin: number;
    length: number;
  };

  /** Emitted when attempting to reconnect to a peer */
  peerReconnecting: {
    infoHash: string;
    ip: string;
    port: number;
    attempt: number;
    maxAttempts: number;
    delay: number;
  };

  /** Emitted when a peer is banned due to misbehavior or repeated failures */
  peerBanned: {
    infoHash: string;
    ip: string;
    port: number;
    reason: string;
    bannedUntil: number | null;
  };

  /** Emitted when peers are discovered via PEX (Peer Exchange) */
  pexPeers: {
    infoHash: string;
    peerId: string;
    added: PexPeer[];
    dropped: PexPeer[];
  };
}

/**
 * Configuration options for the PeerManager
 */
export interface PeerManagerOptions {
  /** Our 20-byte peer ID */
  peerId: Buffer;

  /** Maximum total connections across all torrents (default: 50) */
  maxConnections?: number;

  /** Maximum connections per torrent (default: 30) */
  maxConnectionsPerTorrent?: number;

  /** Connection timeout in milliseconds (default: 10000) */
  connectTimeout?: number;

  /** Handshake timeout in milliseconds (default: 20000) */
  handshakeTimeout?: number;

  /** Initial delay before reconnect attempt in milliseconds (default: 5000) */
  reconnectDelay?: number;

  /** Maximum reconnection attempts per peer (default: 3) */
  maxReconnectAttempts?: number;

  /** Backoff multiplier for reconnection delay (default: 2) */
  reconnectBackoffMultiplier?: number;

  /** Enable automatic reconnection to disconnected peers (default: true) */
  enableReconnection?: boolean;

  /** Ban duration in milliseconds for misbehaving peers (default: 3600000 - 1 hour) */
  banDuration?: number;

  /** Number of consecutive failures before banning a peer (default: 5) */
  failuresBeforeBan?: number;

  /**
   * Encryption mode for peer connections (MSE/PE)
   * - 'prefer': Try encrypted connection first, fall back to plaintext (default)
   * - 'require': Only accept encrypted connections
   * - 'disabled': Only use plaintext connections
   */
  encryptionMode?: 'prefer' | 'require' | 'disabled';
}

/**
 * Reason codes for peer disconnection
 */
export enum DisconnectReason {
  /** Normal disconnection (connection closed) */
  NORMAL = 'normal',
  /** Connection or handshake timeout */
  TIMEOUT = 'timeout',
  /** Protocol error or invalid message */
  PROTOCOL_ERROR = 'protocol_error',
  /** Peer explicitly rejected our connection */
  REJECTED = 'rejected',
  /** Network error */
  NETWORK_ERROR = 'network_error',
  /** Disconnected by client (us) */
  CLIENT_DISCONNECT = 'client_disconnect',
  /** Manager stopped */
  MANAGER_STOPPED = 'manager_stopped',
  /** Torrent removed */
  TORRENT_REMOVED = 'torrent_removed',
}

/**
 * Tracks a disconnected peer for potential reconnection
 */
interface DisconnectedPeer {
  /** IP address of the peer */
  ip: string;
  /** Port of the peer */
  port: number;
  /** Info hash (hex) of the torrent */
  infoHash: string;
  /** Info hash buffer for reconnection */
  infoHashBuffer: Buffer;
  /** Peer ID if known (hex string) */
  peerId?: string;
  /** Timestamp when the peer was disconnected */
  disconnectedAt: number;
  /** Number of reconnection attempts made */
  reconnectAttempts: number;
  /** Reason for disconnection */
  disconnectReason: DisconnectReason;
  /** Scheduled reconnection timeout ID */
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Health statistics for a peer
 */
interface PeerHealth {
  /** IP address of the peer */
  ip: string;
  /** Port of the peer */
  port: number;
  /** Total successful connections */
  successfulConnections: number;
  /** Total failed connection attempts */
  failedConnections: number;
  /** Total bytes downloaded from this peer */
  totalDownloaded: number;
  /** Total bytes uploaded to this peer */
  totalUploaded: number;
  /** Last successful connection timestamp */
  lastSuccessfulConnection: number | null;
  /** Last failed connection timestamp */
  lastFailedConnection: number | null;
  /** Consecutive failures count */
  consecutiveFailures: number;
  /** Whether this peer is currently banned */
  banned: boolean;
  /** Timestamp when ban expires (null = permanent) */
  bannedUntil: number | null;
  /** Reason for ban if banned */
  banReason?: string;
}

/**
 * Internal state for a connected peer
 */
interface PeerState {
  /** The TCP connection to the peer */
  connection: PeerConnection;

  /** Wire protocol handler for this peer */
  protocol: WireProtocol;

  /** Public peer interface */
  peer: Peer;

  /** Info hash this peer is connected for (hex string) */
  infoHash: string;

  /** Info hash as 20-byte buffer (needed for reconnection) */
  infoHashBuffer: Buffer;

  /** Whether the handshake has been completed */
  handshakeComplete: boolean;

  /** Timestamp of last activity (for timeout detection) */
  lastActivity: number;

  /** Total bytes downloaded from this peer */
  downloadedBytes: number;

  /** Total bytes uploaded to this peer */
  uploadedBytes: number;

  /** Recent download speed samples for averaging */
  downloadSamples: number[];

  /** Recent upload speed samples for averaging */
  uploadSamples: number[];

  /** Extension manager for BEP 10 extensions (PEX, etc.) */
  extensionManager: ExtensionManager;

  /** Whether the remote peer supports extensions */
  supportsExtensions: boolean;
}

/**
 * Map of known BitTorrent client identifiers to names
 */
const CLIENT_IDENTIFIERS: Record<string, string> = {
  '-TR': 'Transmission',
  '-qB': 'qBittorrent',
  '-DE': 'Deluge',
  '-UT': 'uTorrent',
  '-lt': 'libtorrent',
  '-AZ': 'Azureus',
  '-BC': 'BitComet',
  '-BT': 'BitTorrent',
  '-BI': 'BiglyBT',
  '-LT': 'libtorrent',
  '-SD': 'Thunder',
  '-XL': 'Xunlei',
  '-FD': 'Free Download Manager',
  '-AG': 'Ares',
  '-A~': 'Ares',
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse client name from a peer ID
 *
 * The peer ID typically follows the Azureus-style format:
 * -XX1234-xxxxxxxxxxxx where XX is the client ID and 1234 is the version
 *
 * @param peerId - The 20-byte peer ID (as hex string or Buffer)
 * @returns Parsed client name and version
 */
function parseClientName(peerId: string | Buffer): string {
  let peerIdStr: string;

  if (Buffer.isBuffer(peerId)) {
    // Try to interpret as ASCII for client ID parsing
    peerIdStr = peerId.toString('ascii');
  } else {
    // If hex string, convert to ASCII representation
    try {
      peerIdStr = Buffer.from(peerId, 'hex').toString('ascii');
    } catch {
      peerIdStr = peerId;
    }
  }

  // Azureus-style: -XX1234-xxxxxxxxxxxx
  if (peerIdStr.startsWith('-') && peerIdStr.length >= 8) {
    const clientCode = peerIdStr.substring(0, 3);
    const clientName = CLIENT_IDENTIFIERS[clientCode];

    if (clientName) {
      // Parse version number (next 4 characters)
      const versionStr = peerIdStr.substring(3, 7);
      const version = parseVersion(versionStr);
      return version ? `${clientName} ${version}` : clientName;
    }
  }

  // Shadow-style: X1234-----xxxxxxxxxxxx
  const shadowCode = peerIdStr.charAt(0);
  if (/[A-Za-z]/.test(shadowCode)) {
    // Could be Shadow style, but we don't have a mapping for it
    return 'Unknown Client';
  }

  return 'Unknown Client';
}

/**
 * Parse version string from Azureus-style peer ID
 *
 * @param versionStr - 4-character version string
 * @returns Formatted version or null
 */
function parseVersion(versionStr: string): string | null {
  // Version can be numeric (e.g., "3000" -> "3.0.0.0") or
  // alphanumeric (e.g., "45A0" -> "4.5.10.0")
  const chars = versionStr.split('');
  const parts: string[] = [];

  for (const char of chars) {
    if (/\d/.test(char)) {
      parts.push(char);
    } else if (/[A-Za-z]/.test(char)) {
      // A=10, B=11, etc.
      const num = char.toUpperCase().charCodeAt(0) - 55;
      if (num >= 10 && num <= 35) {
        parts.push(String(num));
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }

  // Remove trailing zeros
  while (parts.length > 1 && parts[parts.length - 1] === '0') {
    parts.pop();
  }

  return parts.join('.');
}

/**
 * Calculate average speed from samples
 *
 * @param samples - Array of byte counts per interval
 * @returns Average speed in bytes per second
 */
function calculateAverageSpeed(samples: number[]): number {
  if (samples.length === 0) {
    return 0;
  }

  const sum = samples.reduce((a, b) => a + b, 0);
  return Math.round(sum / samples.length);
}

/**
 * Create a unique key for a peer connection
 *
 * @param infoHash - Info hash hex string
 * @param peerId - Peer ID hex string
 * @returns Unique connection key
 */
function connectionKey(infoHash: string, peerId: string): string {
  return `${infoHash}:${peerId}`;
}

// =============================================================================
// PeerManager Class
// =============================================================================

/**
 * Peer Connection Manager
 *
 * Manages all peer connections for the BitTorrent client:
 * - Establishes TCP connections to peers
 * - Handles BitTorrent handshake protocol
 * - Routes protocol messages between peers and engine
 * - Enforces connection limits (total and per-torrent)
 * - Tracks download/upload speeds for each peer
 *
 * @example
 * ```typescript
 * const manager = new PeerManager({
 *   peerId: Buffer.from('-TR3000-xxxxxxxxxxxx'),
 *   maxConnections: 100,
 *   maxConnectionsPerTorrent: 50,
 * });
 *
 * manager.on('peerConnected', ({ infoHash, peer }) => {
 *   console.log(`Connected to ${peer.client} at ${peer.ip}:${peer.port}`);
 * });
 *
 * manager.on('pieceReceived', ({ infoHash, peerId, pieceIndex, begin, block }) => {
 *   // Handle received piece data
 * });
 *
 * // Add peers from tracker
 * manager.addPeers(infoHash, infoHashBuffer, trackerPeers);
 *
 * // Send messages to peers
 * await manager.sendInterested(infoHash, peerId);
 * await manager.sendRequest(infoHash, peerId, pieceIndex, begin, length);
 * ```
 */
export class PeerManager extends TypedEventEmitter<PeerManagerEvents> {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** Our 20-byte peer ID */
  private readonly peerId: Buffer;

  /** Maximum total connections */
  private readonly maxConnections: number;

  /** Maximum connections per torrent */
  private readonly maxConnectionsPerTorrent: number;

  /** Connection timeout in milliseconds */
  private readonly connectTimeout: number;

  /** Handshake timeout in milliseconds */
  private readonly handshakeTimeout: number;

  /** Initial delay before reconnect attempt in milliseconds */
  private readonly reconnectDelay: number;

  /** Maximum reconnection attempts per peer */
  private readonly maxReconnectAttempts: number;

  /** Backoff multiplier for reconnection delay */
  private readonly reconnectBackoffMultiplier: number;

  /** Whether automatic reconnection is enabled */
  private readonly enableReconnection: boolean;

  /** Ban duration for misbehaving peers in milliseconds */
  private readonly banDuration: number;

  /** Number of consecutive failures before banning */
  private readonly failuresBeforeBan: number;

  /** Encryption mode for peer connections */
  private readonly encryptionMode: 'prefer' | 'require' | 'disabled';

  /** Map of infoHash -> Map of peerId -> PeerState */
  private readonly peers: Map<string, Map<string, PeerState>>;

  /** Map of pending connection attempts (ip:port -> infoHash) */
  private readonly pendingConnections: Map<string, string>;

  /** Map of disconnected peers awaiting reconnection (ip:port -> DisconnectedPeer) */
  private readonly disconnectedPeers: Map<string, DisconnectedPeer>;

  /** Map of peer health statistics (ip:port -> PeerHealth) */
  private readonly peerHealth: Map<string, PeerHealth>;

  /** Speed sample timer */
  private speedSampleTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether the manager is stopped */
  private stopped = false;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Create a new PeerManager
   *
   * @param options - Manager configuration
   */
  constructor(options: PeerManagerOptions) {
    super();

    this.peerId = options.peerId;
    this.maxConnections = options.maxConnections ?? 50;
    this.maxConnectionsPerTorrent = options.maxConnectionsPerTorrent ?? 30;
    this.connectTimeout = options.connectTimeout ?? 5000; // 5 seconds (reduced from 10s)
    this.handshakeTimeout = options.handshakeTimeout ?? 10000; // 10 seconds (reduced from 20s)

    // Reconnection configuration
    this.reconnectDelay = options.reconnectDelay ?? 2000; // 2 seconds (reduced from 5s)
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
    this.reconnectBackoffMultiplier = options.reconnectBackoffMultiplier ?? 1.5; // Reduced from 2x
    this.enableReconnection = options.enableReconnection ?? true;
    this.banDuration = options.banDuration ?? 600000; // 10 minutes (reduced from 1 hour)
    this.failuresBeforeBan = options.failuresBeforeBan ?? 5;

    // Encryption mode - default to 'disabled' until MSE is fully tested
    this.encryptionMode = options.encryptionMode ?? 'disabled';

    this.peers = new Map();
    this.pendingConnections = new Map();
    this.disconnectedPeers = new Map();
    this.peerHealth = new Map();

    // Start speed sampling timer
    this.startSpeedSampling();
  }

  // ===========================================================================
  // Public Methods - Peer Management
  // ===========================================================================

  /**
   * Add potential peers for a torrent
   *
   * Filters out already connected peers and attempts to connect
   * to new peers up to the connection limits.
   *
   * @param infoHash - Info hash hex string
   * @param infoHashBuffer - Info hash as 20-byte Buffer
   * @param peers - Array of peer info from tracker
   */
  addPeers(infoHash: string, infoHashBuffer: Buffer, peers: PeerInfo[]): void {
    if (this.stopped) {
      return;
    }

    // Ensure we have a map for this torrent
    if (!this.peers.has(infoHash)) {
      this.peers.set(infoHash, new Map());
    }

    const torrentPeers = this.peers.get(infoHash)!;

    // Build a Set of connected peer addresses for O(1) lookup (optimization)
    const connectedAddresses = new Set<string>();
    for (const state of torrentPeers.values()) {
      connectedAddresses.add(`${state.peer.ip}:${state.peer.port}`);
    }

    // Cache counts to avoid recalculating in loop (optimization)
    const totalPeerCount = this.getTotalPeerCount();
    let pendingCount = this.pendingConnections.size;
    let torrentPendingCount = this.countPendingForTorrent(infoHash);

    for (const peerInfo of peers) {
      const pendingKey = `${peerInfo.ip}:${peerInfo.port}`;

      // Skip if already connected or connecting (O(1) lookups)
      if (this.pendingConnections.has(pendingKey) || connectedAddresses.has(pendingKey)) {
        continue;
      }

      // Skip if peer is banned
      if (this.isPeerBanned(peerInfo.ip, peerInfo.port)) {
        continue;
      }

      // Check connection limits using cached counts
      if (totalPeerCount + pendingCount >= this.maxConnections) {
        break;
      }
      if (torrentPeers.size + torrentPendingCount >= this.maxConnectionsPerTorrent) {
        break;
      }

      // Attempt connection (fire and forget - runs in parallel)
      pendingCount++;
      torrentPendingCount++;
      this.connectToPeer(infoHash, infoHashBuffer, peerInfo).catch(() => {
        // Connection errors are already handled and emitted
      });
    }
  }

  /**
   * Connect to a specific peer
   *
   * Establishes a TCP connection and performs the BitTorrent handshake.
   *
   * @param infoHash - Info hash hex string
   * @param infoHashBuffer - Info hash as 20-byte Buffer
   * @param peerInfo - Peer connection info
   * @throws {Error} If connection or handshake fails
   */
  async connectToPeer(
    infoHash: string,
    infoHashBuffer: Buffer,
    peerInfo: PeerInfo
  ): Promise<void> {
    if (this.stopped) {
      throw new Error('PeerManager is stopped');
    }

    const pendingKey = `${peerInfo.ip}:${peerInfo.port}`;

    // Check if already connecting
    if (this.pendingConnections.has(pendingKey)) {
      throw new Error(`Already connecting to ${pendingKey}`);
    }

    // Check if peer is banned
    if (this.isPeerBanned(peerInfo.ip, peerInfo.port)) {
      throw new Error(`Peer ${pendingKey} is banned`);
    }

    // Check connection limits
    if (this.getTotalPeerCount() >= this.maxConnections) {
      throw new Error('Maximum total connections reached');
    }

    const torrentPeers = this.peers.get(infoHash) ?? new Map();
    if (torrentPeers.size >= this.maxConnectionsPerTorrent) {
      throw new Error('Maximum connections per torrent reached');
    }

    this.pendingConnections.set(pendingKey, infoHash);

    // Remove from disconnected peers if reconnecting
    this.disconnectedPeers.delete(pendingKey);

    try {
      // Use smart connection with dual-attempt strategy
      const connectResult = await smartConnect(peerInfo.ip, peerInfo.port, infoHashBuffer, {
        encryptionMode: this.encryptionMode,
        connectTimeout: this.connectTimeout,
        encryptionTimeout: 5000,
        idleTimeout: 30000,
      });

      if (!connectResult.success || !connectResult.connection) {
        throw new Error(connectResult.error ?? 'Connection failed');
      }

      const connection = connectResult.connection;

      // Enable encryption on the connection if negotiated
      if (connectResult.encrypted && connectResult.encryptStream && connectResult.decryptStream) {
        connection.enableEncryption('rc4', connectResult.encryptStream, connectResult.decryptStream);
      }

      // Create wire protocol handler
      const protocol = new WireProtocol(connection);

      // Feed any remaining data from MSE handshake
      if (connectResult.remainder && connectResult.remainder.length > 0) {
        connection.feedData(connectResult.remainder);
      }

      // Perform handshake
      const { peerId: remotePeerId, reserved } = await this.withTimeout(
        this.performHandshake(protocol, infoHashBuffer),
        this.handshakeTimeout,
        `Handshake with ${pendingKey} timed out`
      );

      // Parse client name from peer ID
      const clientName = parseClientName(remotePeerId);
      const peerIdHex = remotePeerId.toString('hex');

      // Look up country code for the peer's IP
      const country = lookupCountry(peerInfo.ip);

      // Create peer state
      const now = Date.now();
      const peer: Peer = {
        id: peerIdHex,
        ip: peerInfo.ip,
        port: peerInfo.port,
        client: clientName,
        downloadSpeed: 0,
        uploadSpeed: 0,
        progress: 0,
        flags: {
          amInterested: false,
          amChoking: true,
          peerInterested: false,
          peerChoking: true,
        },
        country,
      };

      // Check if peer supports extensions (BEP 10)
      const supportsExtensions = hasCapability(reserved, 'EXTENSION_PROTOCOL');

      // Create extension manager for this peer
      const extensionManager = new ExtensionManager();

      const state: PeerState = {
        connection,
        protocol,
        peer,
        infoHash,
        infoHashBuffer,
        handshakeComplete: true,
        lastActivity: now,
        downloadedBytes: 0,
        uploadedBytes: 0,
        downloadSamples: [],
        uploadSamples: [],
        extensionManager,
        supportsExtensions,
      };

      // Record successful connection in health stats
      this.recordConnectionSuccess(peerInfo.ip, peerInfo.port);

      // Ensure torrent map exists and add peer
      if (!this.peers.has(infoHash)) {
        this.peers.set(infoHash, new Map());
      }
      this.peers.get(infoHash)!.set(peerIdHex, state);

      // Set up protocol event handlers
      this.setupProtocolHandlers(state);

      // Send extension handshake if peer supports extensions (BEP 10)
      this.sendExtensionHandshake(state).catch(() => {
        // Extension handshake failed, not critical
      });

      // Emit connected event
      this.emit('peerConnected', { infoHash, peer });
    } catch (err) {
      // Record connection failure in health stats
      const error = err instanceof Error ? err : new Error(String(err));
      const disconnectReason = this.classifyError(error);
      this.recordConnectionFailure(peerInfo.ip, peerInfo.port, disconnectReason, infoHash);

      // Emit error event
      this.emit('peerError', {
        infoHash,
        peerId: peerInfo.peerId ?? pendingKey,
        error,
      });
      throw error;
    } finally {
      this.pendingConnections.delete(pendingKey);
    }
  }

  /**
   * Disconnect a specific peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   */
  disconnectPeer(infoHash: string, peerId: string): void {
    const torrentPeers = this.peers.get(infoHash);
    if (!torrentPeers) {
      return;
    }

    const state = torrentPeers.get(peerId);
    if (!state) {
      return;
    }

    // Close connection
    state.connection.destroy();

    // Remove from maps
    torrentPeers.delete(peerId);

    // Clean up empty torrent map
    if (torrentPeers.size === 0) {
      this.peers.delete(infoHash);
    }

    // Emit disconnected event
    this.emit('peerDisconnected', {
      infoHash,
      peerId,
      reason: 'Disconnected by client',
    });
  }

  /**
   * Disconnect all peers for a torrent
   *
   * @param infoHash - Info hash hex string
   */
  disconnectAllPeers(infoHash: string): void {
    const torrentPeers = this.peers.get(infoHash);
    if (!torrentPeers) {
      return;
    }

    // Disconnect each peer
    for (const [peerId, state] of torrentPeers) {
      state.connection.destroy();

      this.emit('peerDisconnected', {
        infoHash,
        peerId,
        reason: 'Torrent removed',
      });
    }

    // Remove the torrent map
    this.peers.delete(infoHash);
  }

  /**
   * Get all connected peers for a torrent
   *
   * @param infoHash - Info hash hex string
   * @returns Array of Peer objects
   */
  getPeers(infoHash: string): Peer[] {
    const torrentPeers = this.peers.get(infoHash);
    if (!torrentPeers) {
      return [];
    }

    return Array.from(torrentPeers.values()).map((state) => ({ ...state.peer }));
  }

  /**
   * Get the number of connected peers for a torrent
   *
   * @param infoHash - Info hash hex string
   * @returns Number of connected peers
   */
  getPeerCount(infoHash: string): number {
    const torrentPeers = this.peers.get(infoHash);
    return torrentPeers?.size ?? 0;
  }

  /**
   * Get the total number of connected peers across all torrents
   *
   * @returns Total number of connected peers
   */
  getTotalPeerCount(): number {
    let total = 0;
    for (const torrentPeers of this.peers.values()) {
      total += torrentPeers.size;
    }
    return total;
  }

  /**
   * Stop the peer manager and close all connections
   */
  async stop(): Promise<void> {
    this.stopped = true;

    // Stop speed sampling
    if (this.speedSampleTimer) {
      clearInterval(this.speedSampleTimer);
      this.speedSampleTimer = null;
    }

    // Cancel all pending reconnection timers
    for (const disconnected of this.disconnectedPeers.values()) {
      if (disconnected.reconnectTimer) {
        clearTimeout(disconnected.reconnectTimer);
      }
    }

    // Disconnect all peers for all torrents
    for (const [infoHash, torrentPeers] of this.peers) {
      for (const [peerId, state] of torrentPeers) {
        try {
          state.connection.destroy();
        } catch {
          // Ignore errors during shutdown
        }

        this.emit('peerDisconnected', {
          infoHash,
          peerId,
          reason: 'Manager stopped',
        });
      }
    }

    // Clear all state
    this.peers.clear();
    this.pendingConnections.clear();
    this.disconnectedPeers.clear();
  }

  // ===========================================================================
  // Public Methods - Message Sending
  // ===========================================================================

  /**
   * Send a choke message to a peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   */
  async sendChoke(infoHash: string, peerId: string): Promise<void> {
    const state = this.getPeerState(infoHash, peerId);
    if (!state) {
      throw new PeerError(`Peer not found: ${peerId}`, peerId);
    }

    await state.protocol.sendChoke();
    state.peer.flags.amChoking = true;
    state.lastActivity = Date.now();
  }

  /**
   * Send an unchoke message to a peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   */
  async sendUnchoke(infoHash: string, peerId: string): Promise<void> {
    const state = this.getPeerState(infoHash, peerId);
    if (!state) {
      throw new PeerError(`Peer not found: ${peerId}`, peerId);
    }

    await state.protocol.sendUnchoke();
    state.peer.flags.amChoking = false;
    state.lastActivity = Date.now();
  }

  /**
   * Send an interested message to a peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   */
  async sendInterested(infoHash: string, peerId: string): Promise<void> {
    const state = this.getPeerState(infoHash, peerId);
    if (!state) {
      throw new PeerError(`Peer not found: ${peerId}`, peerId);
    }

    await state.protocol.sendInterested();
    state.peer.flags.amInterested = true;
    state.lastActivity = Date.now();
  }

  /**
   * Send a not interested message to a peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   */
  async sendNotInterested(infoHash: string, peerId: string): Promise<void> {
    const state = this.getPeerState(infoHash, peerId);
    if (!state) {
      throw new PeerError(`Peer not found: ${peerId}`, peerId);
    }

    await state.protocol.sendNotInterested();
    state.peer.flags.amInterested = false;
    state.lastActivity = Date.now();
  }

  /**
   * Send a have message to a peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   * @param pieceIndex - Index of the piece we now have
   */
  async sendHave(infoHash: string, peerId: string, pieceIndex: number): Promise<void> {
    const state = this.getPeerState(infoHash, peerId);
    if (!state) {
      throw new PeerError(`Peer not found: ${peerId}`, peerId);
    }

    await state.protocol.sendHave(pieceIndex);
    state.lastActivity = Date.now();
  }

  /**
   * Send a bitfield message to a peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   * @param bitfield - Bitfield indicating which pieces we have
   */
  async sendBitfield(infoHash: string, peerId: string, bitfield: Buffer): Promise<void> {
    const state = this.getPeerState(infoHash, peerId);
    if (!state) {
      throw new PeerError(`Peer not found: ${peerId}`, peerId);
    }

    await state.protocol.sendBitfield(bitfield);
    state.lastActivity = Date.now();
  }

  /**
   * Send a request message to a peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   * @param pieceIndex - Index of the piece
   * @param begin - Byte offset within the piece
   * @param length - Number of bytes to request
   */
  async sendRequest(
    infoHash: string,
    peerId: string,
    pieceIndex: number,
    begin: number,
    length: number
  ): Promise<void> {
    const state = this.getPeerState(infoHash, peerId);
    if (!state) {
      throw new PeerError(`Peer not found: ${peerId}`, peerId);
    }

    await state.protocol.sendRequest(pieceIndex, begin, length);
    state.lastActivity = Date.now();
  }

  /**
   * Send a piece message to a peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   * @param pieceIndex - Index of the piece
   * @param begin - Byte offset within the piece
   * @param block - The data block
   */
  async sendPiece(
    infoHash: string,
    peerId: string,
    pieceIndex: number,
    begin: number,
    block: Buffer
  ): Promise<void> {
    const state = this.getPeerState(infoHash, peerId);
    if (!state) {
      throw new PeerError(`Peer not found: ${peerId}`, peerId);
    }

    await state.protocol.sendPiece(pieceIndex, begin, block);
    state.uploadedBytes += block.length;
    state.lastActivity = Date.now();
  }

  /**
   * Send a cancel message to a peer
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   * @param pieceIndex - Index of the piece
   * @param begin - Byte offset within the piece
   * @param length - Number of bytes to cancel
   */
  async sendCancel(
    infoHash: string,
    peerId: string,
    pieceIndex: number,
    begin: number,
    length: number
  ): Promise<void> {
    const state = this.getPeerState(infoHash, peerId);
    if (!state) {
      throw new PeerError(`Peer not found: ${peerId}`, peerId);
    }

    await state.protocol.sendCancel(pieceIndex, begin, length);
    state.lastActivity = Date.now();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Get peer state by info hash and peer ID
   *
   * @param infoHash - Info hash hex string
   * @param peerId - Peer ID hex string
   * @returns Peer state or undefined
   */
  private getPeerState(infoHash: string, peerId: string): PeerState | undefined {
    const torrentPeers = this.peers.get(infoHash);
    return torrentPeers?.get(peerId);
  }

  /**
   * Count pending connections for a specific torrent
   *
   * @param infoHash - Info hash hex string
   * @returns Number of pending connections for this torrent
   */
  private countPendingForTorrent(infoHash: string): number {
    let count = 0;
    for (const pendingInfoHash of this.pendingConnections.values()) {
      if (pendingInfoHash === infoHash) {
        count++;
      }
    }
    return count;
  }

  /**
   * Perform BitTorrent handshake with a peer
   *
   * The handshake format is:
   * <pstrlen><pstr><reserved><info_hash><peer_id>
   *
   * @param protocol - Wire protocol handler
   * @param infoHash - Expected info hash (20 bytes)
   * @returns Object with remote peer ID and reserved bytes
   */
  private async performHandshake(
    protocol: WireProtocol,
    infoHash: Buffer
  ): Promise<{ peerId: Buffer; reserved: Buffer }> {
    // Send our handshake
    await protocol.sendHandshake(infoHash, this.peerId);

    // Receive and verify their handshake
    const { infoHash: remoteInfoHash, peerId: remotePeerId, reserved } =
      await protocol.receiveHandshake();

    // Verify info hash matches
    if (!infoHash.equals(remoteInfoHash)) {
      throw new Error('Info hash mismatch in handshake');
    }

    return { peerId: remotePeerId, reserved };
  }

  /**
   * Set up protocol event handlers for a peer
   *
   * @param state - Peer state
   */
  private setupProtocolHandlers(state: PeerState): void {
    const { protocol, infoHash, peer } = state;
    const peerId = peer.id;

    // Handle choke
    protocol.on('choke', () => {
      state.peer.flags.peerChoking = true;
      state.lastActivity = Date.now();
      this.emit('peerChoked', { infoHash, peerId });
      this.emit('peerMessage', { infoHash, peerId, type: 'choke', payload: null });
    });

    // Handle unchoke
    protocol.on('unchoke', () => {
      state.peer.flags.peerChoking = false;
      state.lastActivity = Date.now();
      this.emit('peerUnchoked', { infoHash, peerId });
      this.emit('peerMessage', { infoHash, peerId, type: 'unchoke', payload: null });
    });

    // Handle interested
    protocol.on('interested', () => {
      state.peer.flags.peerInterested = true;
      state.lastActivity = Date.now();
      this.emit('peerInterested', { infoHash, peerId });
      this.emit('peerMessage', { infoHash, peerId, type: 'interested', payload: null });
    });

    // Handle not interested
    protocol.on('notInterested', () => {
      state.peer.flags.peerInterested = false;
      state.lastActivity = Date.now();
      this.emit('peerNotInterested', { infoHash, peerId });
      this.emit('peerMessage', { infoHash, peerId, type: 'notInterested', payload: null });
    });

    // Handle have
    protocol.on('have', (pieceIndex: number) => {
      state.lastActivity = Date.now();
      this.updatePeerProgress(state, pieceIndex);
      this.emit('peerHave', { infoHash, peerId, pieceIndex });
      this.emit('peerMessage', { infoHash, peerId, type: 'have', payload: { pieceIndex } });
    });

    // Handle bitfield
    protocol.on('bitfield', (bitfield: Buffer) => {
      state.lastActivity = Date.now();
      this.updatePeerProgressFromBitfield(state, bitfield);
      this.emit('peerBitfield', { infoHash, peerId, bitfield });
      this.emit('peerMessage', { infoHash, peerId, type: 'bitfield', payload: { bitfield } });
    });

    // Handle piece
    protocol.on('piece', ({ pieceIndex, begin, block }) => {
      state.downloadedBytes += block.length;
      state.lastActivity = Date.now();
      this.emit('pieceReceived', { infoHash, peerId, pieceIndex, begin, block });
      this.emit('peerMessage', {
        infoHash,
        peerId,
        type: 'piece',
        payload: { pieceIndex, begin, block },
      });
    });

    // Handle request
    protocol.on('request', ({ pieceIndex, begin, length }) => {
      state.lastActivity = Date.now();
      this.emit('requestReceived', { infoHash, peerId, pieceIndex, begin, length });
      this.emit('peerMessage', {
        infoHash,
        peerId,
        type: 'request',
        payload: { pieceIndex, begin, length },
      });
    });

    // Handle cancel
    protocol.on('cancel', ({ pieceIndex, begin, length }) => {
      state.lastActivity = Date.now();
      this.emit('peerMessage', {
        infoHash,
        peerId,
        type: 'cancel',
        payload: { pieceIndex, begin, length },
      });
    });

    // Handle keep-alive
    protocol.on('keepAlive', () => {
      state.lastActivity = Date.now();
    });

    // Handle errors
    protocol.on('error', (error: Error) => {
      this.handlePeerError(state, error);
    });

    // Handle close
    protocol.on('close', () => {
      this.handlePeerDisconnect(state, 'Connection closed');
    });

    // Handle end
    protocol.on('end', () => {
      this.handlePeerDisconnect(state, 'Connection ended by peer');
    });

    // Handle extended messages (BEP 10)
    protocol.on('extended', ({ extendedId, payload }) => {
      state.lastActivity = Date.now();

      // Pass to extension manager
      state.extensionManager.handleMessage(peerId, {
        type: 20, // MessageType.Extended
        extendedId,
        payload,
      });
    });

    // Handle PEX peers discovered
    state.extensionManager.on('pex', ({ added, dropped }) => {
      // Emit event for session to handle
      this.emit('pexPeers', {
        infoHash,
        peerId,
        added,
        dropped,
      });
    });
  }

  /**
   * Send extension handshake to a peer if they support extensions
   */
  private async sendExtensionHandshake(state: PeerState): Promise<void> {
    if (!state.supportsExtensions) {
      return;
    }

    try {
      const handshake = state.extensionManager.createHandshake();
      await state.protocol.sendExtended(0, handshake.subarray(6)); // Skip length prefix and msg id
    } catch {
      // Extension handshake failed, not critical
    }
  }

  /**
   * Handle a peer error
   *
   * @param state - Peer state
   * @param error - The error that occurred
   */
  private handlePeerError(state: PeerState, error: Error): void {
    const { infoHash, peer } = state;
    const peerId = peer.id;

    // Emit error event
    this.emit('peerError', { infoHash, peerId, error });

    // Disconnect the peer
    this.handlePeerDisconnect(state, error.message);
  }

  /**
   * Handle a peer disconnect
   *
   * @param state - Peer state
   * @param reason - Disconnect reason
   * @param disconnectReason - Structured disconnect reason for reconnection logic
   */
  private handlePeerDisconnect(
    state: PeerState,
    reason: string,
    disconnectReason: DisconnectReason = DisconnectReason.NORMAL
  ): void {
    const { infoHash, infoHashBuffer, peer } = state;
    const peerId = peer.id;
    const { ip, port } = peer;

    // Update health stats with transfer data before removing
    this.updatePeerHealthWithTransfer(ip, port, state.downloadedBytes, state.uploadedBytes);

    // Remove from peers map
    const torrentPeers = this.peers.get(infoHash);
    if (torrentPeers) {
      torrentPeers.delete(peerId);

      // Clean up empty torrent map
      if (torrentPeers.size === 0) {
        this.peers.delete(infoHash);
      }
    }

    // Emit disconnected event
    this.emit('peerDisconnected', { infoHash, peerId, reason });

    // Schedule reconnection if appropriate
    if (this.enableReconnection && !this.stopped) {
      this.scheduleReconnection(ip, port, infoHash, infoHashBuffer, peerId, disconnectReason);
    }
  }

  /**
   * Update peer progress when receiving a have message
   *
   * Note: Without knowing the total piece count, we can only
   * track that this piece is available. The actual progress
   * percentage should be calculated by the piece manager.
   *
   * @param state - Peer state
   * @param pieceIndex - Index of the piece the peer has
   */
  private updatePeerProgress(_state: PeerState, _pieceIndex: number): void {
    // Progress updates would be calculated by the piece manager
    // based on total piece count and the peer's bitfield
  }

  /**
   * Update peer progress from bitfield
   *
   * @param state - Peer state
   * @param bitfield - Peer's bitfield
   */
  private updatePeerProgressFromBitfield(state: PeerState, bitfield: Buffer): void {
    // Count bits set in bitfield
    let bitsSet = 0;
    const totalBits = bitfield.length * 8;

    for (let i = 0; i < bitfield.length; i++) {
      let byte = bitfield[i];
      while (byte) {
        bitsSet += byte & 1;
        byte >>= 1;
      }
    }

    // Calculate approximate progress
    if (totalBits > 0) {
      state.peer.progress = bitsSet / totalBits;
    }
  }

  /**
   * Start the speed sampling timer
   *
   * Samples download/upload bytes at regular intervals to calculate
   * rolling average speeds.
   */
  private startSpeedSampling(): void {
    const lastSample = new Map<string, { downloaded: number; uploaded: number }>();

    this.speedSampleTimer = setInterval(() => {
      for (const [infoHash, torrentPeers] of this.peers) {
        for (const [peerId, state] of torrentPeers) {
          const key = connectionKey(infoHash, peerId);
          const last = lastSample.get(key);

          if (last) {
            // Calculate bytes transferred since last sample
            const downloadDelta = state.downloadedBytes - last.downloaded;
            const uploadDelta = state.uploadedBytes - last.uploaded;

            // Add to samples (bytes per second)
            state.downloadSamples.push(downloadDelta * (1000 / SPEED_SAMPLE_INTERVAL));
            state.uploadSamples.push(uploadDelta * (1000 / SPEED_SAMPLE_INTERVAL));

            // Limit sample count
            if (state.downloadSamples.length > SPEED_SAMPLE_COUNT) {
              state.downloadSamples.shift();
            }
            if (state.uploadSamples.length > SPEED_SAMPLE_COUNT) {
              state.uploadSamples.shift();
            }

            // Update peer speeds
            state.peer.downloadSpeed = calculateAverageSpeed(state.downloadSamples);
            state.peer.uploadSpeed = calculateAverageSpeed(state.uploadSamples);
          }

          // Update last sample
          lastSample.set(key, {
            downloaded: state.downloadedBytes,
            uploaded: state.uploadedBytes,
          });
        }
      }

      // Clean up entries for disconnected peers
      for (const key of lastSample.keys()) {
        const [infoHash, peerId] = key.split(':');
        const torrentPeers = this.peers.get(infoHash);
        if (!torrentPeers || !torrentPeers.has(peerId)) {
          lastSample.delete(key);
        }
      }
    }, SPEED_SAMPLE_INTERVAL);
  }

  /**
   * Helper to wrap a promise with a timeout
   *
   * @param promise - The promise to wrap
   * @param ms - Timeout in milliseconds
   * @param message - Error message on timeout
   * @returns The promise result
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(message));
      }, ms);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (err) {
      clearTimeout(timeoutId!);
      throw err;
    }
  }

  // ===========================================================================
  // Private Methods - Reconnection Logic
  // ===========================================================================

  /**
   * Schedule a reconnection attempt for a disconnected peer
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   * @param infoHash - Info hash hex string
   * @param infoHashBuffer - Info hash buffer
   * @param peerId - Peer ID if known
   * @param disconnectReason - Reason for disconnect
   */
  private scheduleReconnection(
    ip: string,
    port: number,
    infoHash: string,
    infoHashBuffer: Buffer,
    peerId: string | undefined,
    disconnectReason: DisconnectReason
  ): void {
    const peerKey = `${ip}:${port}`;

    // Don't reconnect to peers that explicitly rejected us
    if (disconnectReason === DisconnectReason.REJECTED) {
      return;
    }

    // Don't reconnect if manager stopped or torrent removed
    if (
      disconnectReason === DisconnectReason.MANAGER_STOPPED ||
      disconnectReason === DisconnectReason.TORRENT_REMOVED ||
      disconnectReason === DisconnectReason.CLIENT_DISCONNECT
    ) {
      return;
    }

    // Check if peer is banned
    if (this.isPeerBanned(ip, port)) {
      return;
    }

    // Get existing disconnected peer record or create new one
    let disconnected = this.disconnectedPeers.get(peerKey);

    if (disconnected) {
      // Cancel existing reconnect timer
      if (disconnected.reconnectTimer) {
        clearTimeout(disconnected.reconnectTimer);
      }
      disconnected.reconnectAttempts++;
      disconnected.disconnectedAt = Date.now();
      disconnected.disconnectReason = disconnectReason;
    } else {
      disconnected = {
        ip,
        port,
        infoHash,
        infoHashBuffer,
        peerId,
        disconnectedAt: Date.now(),
        reconnectAttempts: 0,
        disconnectReason,
      };
      this.disconnectedPeers.set(peerKey, disconnected);
    }

    // Check if max attempts reached
    if (disconnected.reconnectAttempts >= this.maxReconnectAttempts) {
      this.disconnectedPeers.delete(peerKey);
      // Record this as a failure for potential banning
      this.recordConnectionFailure(ip, port, disconnectReason, infoHash);
      return;
    }

    // Calculate delay with exponential backoff
    const delay =
      this.reconnectDelay *
      Math.pow(this.reconnectBackoffMultiplier, disconnected.reconnectAttempts);

    // Emit reconnecting event
    this.emit('peerReconnecting', {
      infoHash,
      ip,
      port,
      attempt: disconnected.reconnectAttempts + 1,
      maxAttempts: this.maxReconnectAttempts,
      delay,
    });

    // Schedule reconnection
    disconnected.reconnectTimer = setTimeout(() => {
      this.attemptReconnection(peerKey);
    }, delay);
  }

  /**
   * Attempt to reconnect to a disconnected peer
   *
   * @param peerKey - The ip:port key for the peer
   */
  private attemptReconnection(peerKey: string): void {
    const disconnected = this.disconnectedPeers.get(peerKey);
    if (!disconnected || this.stopped) {
      return;
    }

    const { ip, port, infoHash, infoHashBuffer } = disconnected;

    // Check if peer is now banned
    if (this.isPeerBanned(ip, port)) {
      this.disconnectedPeers.delete(peerKey);
      return;
    }

    // Check if already connected
    if (this.pendingConnections.has(peerKey)) {
      this.disconnectedPeers.delete(peerKey);
      return;
    }

    // Attempt connection
    this.connectToPeer(infoHash, infoHashBuffer, { ip, port }).catch(() => {
      // Connection failure is handled in connectToPeer, which will
      // call recordConnectionFailure and potentially schedule another reconnect
    });
  }

  // ===========================================================================
  // Private Methods - Peer Health Tracking
  // ===========================================================================

  /**
   * Get or create health record for a peer
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   * @returns PeerHealth record
   */
  private getOrCreatePeerHealth(ip: string, port: number): PeerHealth {
    const peerKey = `${ip}:${port}`;
    let health = this.peerHealth.get(peerKey);

    if (!health) {
      health = {
        ip,
        port,
        successfulConnections: 0,
        failedConnections: 0,
        totalDownloaded: 0,
        totalUploaded: 0,
        lastSuccessfulConnection: null,
        lastFailedConnection: null,
        consecutiveFailures: 0,
        banned: false,
        bannedUntil: null,
      };
      this.peerHealth.set(peerKey, health);
    }

    return health;
  }

  /**
   * Record a successful connection to a peer
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   */
  private recordConnectionSuccess(ip: string, port: number): void {
    const health = this.getOrCreatePeerHealth(ip, port);
    health.successfulConnections++;
    health.lastSuccessfulConnection = Date.now();
    health.consecutiveFailures = 0; // Reset consecutive failures on success
  }

  /**
   * Record a failed connection to a peer
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   * @param reason - Reason for failure
   * @param infoHash - Info hash for the torrent
   */
  private recordConnectionFailure(
    ip: string,
    port: number,
    reason: DisconnectReason,
    infoHash: string
  ): void {
    const health = this.getOrCreatePeerHealth(ip, port);
    health.failedConnections++;
    health.lastFailedConnection = Date.now();
    health.consecutiveFailures++;

    // Check if peer should be banned
    if (health.consecutiveFailures >= this.failuresBeforeBan) {
      this.banPeer(ip, port, infoHash, `Too many consecutive failures (${health.consecutiveFailures})`);
    }
  }

  /**
   * Update peer health with transfer statistics
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   * @param downloaded - Bytes downloaded in this session
   * @param uploaded - Bytes uploaded in this session
   */
  private updatePeerHealthWithTransfer(
    ip: string,
    port: number,
    downloaded: number,
    uploaded: number
  ): void {
    const peerKey = `${ip}:${port}`;
    const health = this.peerHealth.get(peerKey);

    if (health) {
      health.totalDownloaded += downloaded;
      health.totalUploaded += uploaded;
    }
  }

  /**
   * Classify an error into a disconnect reason
   *
   * @param error - The error to classify
   * @returns DisconnectReason
   */
  private classifyError(error: Error): DisconnectReason {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) {
      return DisconnectReason.TIMEOUT;
    }
    if (message.includes('refused') || message.includes('rejected')) {
      return DisconnectReason.REJECTED;
    }
    if (
      message.includes('protocol') ||
      message.includes('handshake') ||
      message.includes('info hash mismatch')
    ) {
      return DisconnectReason.PROTOCOL_ERROR;
    }
    if (
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('epipe') ||
      message.includes('network')
    ) {
      return DisconnectReason.NETWORK_ERROR;
    }

    return DisconnectReason.NORMAL;
  }

  // ===========================================================================
  // Private Methods - Peer Banning
  // ===========================================================================

  /**
   * Check if a peer is currently banned
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   * @returns True if the peer is banned
   */
  private isPeerBanned(ip: string, port: number): boolean {
    const peerKey = `${ip}:${port}`;
    const health = this.peerHealth.get(peerKey);

    if (!health || !health.banned) {
      return false;
    }

    // Check if ban has expired
    if (health.bannedUntil !== null && Date.now() > health.bannedUntil) {
      health.banned = false;
      health.bannedUntil = null;
      health.banReason = undefined;
      health.consecutiveFailures = 0; // Reset on unban
      return false;
    }

    return true;
  }

  /**
   * Ban a peer
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   * @param infoHash - Info hash of the torrent
   * @param reason - Reason for banning
   * @param permanent - If true, ban is permanent (bannedUntil = null)
   */
  private banPeer(
    ip: string,
    port: number,
    infoHash: string,
    reason: string,
    permanent = false
  ): void {
    const health = this.getOrCreatePeerHealth(ip, port);

    health.banned = true;
    health.bannedUntil = permanent ? null : Date.now() + this.banDuration;
    health.banReason = reason;

    // Remove from disconnected peers queue
    const peerKey = `${ip}:${port}`;
    const disconnected = this.disconnectedPeers.get(peerKey);
    if (disconnected) {
      if (disconnected.reconnectTimer) {
        clearTimeout(disconnected.reconnectTimer);
      }
      this.disconnectedPeers.delete(peerKey);
    }

    // Emit banned event
    this.emit('peerBanned', {
      infoHash,
      ip,
      port,
      reason,
      bannedUntil: health.bannedUntil,
    });
  }

  // ===========================================================================
  // Public Methods - Peer Health and Ban Management
  // ===========================================================================

  /**
   * Get health statistics for a peer
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   * @returns PeerHealth object or undefined if no data exists
   */
  getPeerHealth(ip: string, port: number): PeerHealth | undefined {
    const peerKey = `${ip}:${port}`;
    const health = this.peerHealth.get(peerKey);
    return health ? { ...health } : undefined;
  }

  /**
   * Get reliability score for a peer (0-1)
   *
   * Higher scores indicate more reliable peers.
   * Score is based on success rate and transfer volume.
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   * @returns Reliability score from 0 to 1
   */
  getPeerReliability(ip: string, port: number): number {
    const health = this.getPeerHealth(ip, port);

    if (!health) {
      return 0.5; // Unknown peers get neutral score
    }

    const totalAttempts = health.successfulConnections + health.failedConnections;
    if (totalAttempts === 0) {
      return 0.5;
    }

    // Calculate success rate (0-1)
    const successRate = health.successfulConnections / totalAttempts;

    // Give bonus for data transferred (up to 0.2 bonus)
    const transferBonus = Math.min(
      0.2,
      (health.totalDownloaded + health.totalUploaded) / (100 * 1024 * 1024) // 100MB for max bonus
    );

    return Math.min(1, successRate * 0.8 + transferBonus);
  }

  /**
   * Manually ban a peer
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   * @param infoHash - Info hash of the torrent (for event)
   * @param reason - Reason for banning
   * @param permanent - If true, ban is permanent
   */
  ban(
    ip: string,
    port: number,
    infoHash: string,
    reason: string,
    permanent = false
  ): void {
    this.banPeer(ip, port, infoHash, reason, permanent);
  }

  /**
   * Manually unban a peer
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   */
  unban(ip: string, port: number): void {
    const peerKey = `${ip}:${port}`;
    const health = this.peerHealth.get(peerKey);

    if (health) {
      health.banned = false;
      health.bannedUntil = null;
      health.banReason = undefined;
      health.consecutiveFailures = 0;
    }
  }

  /**
   * Get list of all banned peers
   *
   * @returns Array of banned peer info
   */
  getBannedPeers(): Array<{
    ip: string;
    port: number;
    reason?: string;
    bannedUntil: number | null;
  }> {
    const banned: Array<{
      ip: string;
      port: number;
      reason?: string;
      bannedUntil: number | null;
    }> = [];

    for (const health of this.peerHealth.values()) {
      if (health.banned) {
        banned.push({
          ip: health.ip,
          port: health.port,
          reason: health.banReason,
          bannedUntil: health.bannedUntil,
        });
      }
    }

    return banned;
  }

  /**
   * Clear all peer health data and bans
   */
  clearPeerHealth(): void {
    this.peerHealth.clear();
  }

  /**
   * Get list of peers pending reconnection
   *
   * @returns Array of pending reconnection info
   */
  getPendingReconnections(): Array<{
    ip: string;
    port: number;
    infoHash: string;
    attempts: number;
    maxAttempts: number;
    disconnectedAt: number;
  }> {
    const pending: Array<{
      ip: string;
      port: number;
      infoHash: string;
      attempts: number;
      maxAttempts: number;
      disconnectedAt: number;
    }> = [];

    for (const disconnected of this.disconnectedPeers.values()) {
      pending.push({
        ip: disconnected.ip,
        port: disconnected.port,
        infoHash: disconnected.infoHash,
        attempts: disconnected.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        disconnectedAt: disconnected.disconnectedAt,
      });
    }

    return pending;
  }

  /**
   * Cancel pending reconnection for a specific peer
   *
   * @param ip - Peer IP address
   * @param port - Peer port
   */
  cancelReconnection(ip: string, port: number): void {
    const peerKey = `${ip}:${port}`;
    const disconnected = this.disconnectedPeers.get(peerKey);

    if (disconnected) {
      if (disconnected.reconnectTimer) {
        clearTimeout(disconnected.reconnectTimer);
      }
      this.disconnectedPeers.delete(peerKey);
    }
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default PeerManager;
