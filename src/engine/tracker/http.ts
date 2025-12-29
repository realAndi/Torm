/**
 * HTTP Tracker Client for Torm
 *
 * Implements the BitTorrent HTTP tracker protocol as specified in BEP 3.
 * Handles announce and scrape requests to HTTP/HTTPS trackers.
 *
 * @module engine/tracker/http
 */

import { decode, BencodeValue } from '../bencode.js';
import { TrackerError } from '../types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for an announce request to the tracker.
 */
export interface AnnounceParams {
  /** 20-byte info hash identifying the torrent */
  infoHash: Buffer;

  /** 20-byte peer ID uniquely identifying this client */
  peerId: Buffer;

  /** Port number the client is listening on */
  port: number;

  /** Total bytes uploaded since the client started */
  uploaded: number;

  /** Total bytes downloaded since the client started */
  downloaded: number;

  /** Total bytes remaining to download */
  left: number;

  /** Event type: 'started', 'completed', or 'stopped' */
  event?: 'started' | 'completed' | 'stopped';

  /** Request compact peer list format (default: true) */
  compact?: boolean;

  /** Number of peers wanted (default: 50) */
  numwant?: number;
}

/**
 * Response from an announce request.
 */
export interface AnnounceResponse {
  /** Recommended interval in seconds between announces */
  interval: number;

  /** Minimum allowed interval in seconds between announces */
  minInterval?: number;

  /** Tracker ID to send in future requests */
  trackerId?: string;

  /** Number of seeders (peers with complete files) */
  complete: number;

  /** Number of leechers (peers still downloading) */
  incomplete: number;

  /** List of peers returned by the tracker */
  peers: PeerInfo[];
}

/**
 * Information about a peer returned by the tracker.
 */
export interface PeerInfo {
  /** IP address of the peer */
  ip: string;

  /** Port number the peer is listening on */
  port: number;

  /** Peer ID (only available in non-compact responses) */
  peerId?: string;
}

/**
 * Response from a scrape request.
 */
export interface ScrapeResponse {
  /** Map of info hash (hex) to torrent statistics */
  files: Map<
    string,
    {
      /** Number of seeders */
      complete: number;
      /** Number of leechers */
      incomplete: number;
      /** Total number of completed downloads */
      downloaded: number;
    }
  >;
}

/**
 * Options for the HTTP tracker client.
 */
export interface HTTPTrackerOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** User-Agent header (default: 'Torm/1.0') */
  userAgent?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_USER_AGENT = 'Torm/1.0';
const DEFAULT_NUMWANT = 50;

// =============================================================================
// HTTP Tracker Client
// =============================================================================

/**
 * HTTP tracker client for BitTorrent trackers.
 *
 * Supports both announce and scrape operations over HTTP/HTTPS.
 *
 * @example
 * ```typescript
 * const tracker = new HTTPTracker('http://tracker.example.com/announce');
 *
 * const response = await tracker.announce({
 *   infoHash: Buffer.from('...'),
 *   peerId: Buffer.from('-TR3000-...'),
 *   port: 6881,
 *   uploaded: 0,
 *   downloaded: 0,
 *   left: 1000000,
 *   event: 'started',
 * });
 *
 * console.log(`Got ${response.peers.length} peers`);
 * ```
 */
export class HTTPTracker {
  private readonly announceUrl: string;
  private readonly timeout: number;
  private readonly userAgent: string;

  /**
   * Create a new HTTP tracker client.
   *
   * @param announceUrl - The announce URL of the tracker
   * @param options - Optional configuration
   */
  constructor(announceUrl: string, options: HTTPTrackerOptions = {}) {
    this.announceUrl = announceUrl;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  /**
   * Send an announce request to the tracker.
   *
   * @param params - Announce parameters
   * @returns Announce response with peer list
   * @throws {TrackerError} If the request fails or tracker returns an error
   */
  async announce(params: AnnounceParams): Promise<AnnounceResponse> {
    // Validate parameters
    if (params.infoHash.length !== 20) {
      throw new TrackerError(
        'info_hash must be exactly 20 bytes',
        this.announceUrl
      );
    }
    if (params.peerId.length !== 20) {
      throw new TrackerError(
        'peer_id must be exactly 20 bytes',
        this.announceUrl
      );
    }

    // Build the URL with query parameters
    const url = this.buildAnnounceUrl(params);

    // Make the request
    const data = await this.makeRequest(url);

    // Parse the response
    return this.parseAnnounceResponse(data);
  }

  /**
   * Send a scrape request to the tracker.
   *
   * @param infoHashes - Array of 20-byte info hashes to scrape
   * @returns Scrape response with statistics for each torrent
   * @throws {TrackerError} If scrape is not supported or request fails
   */
  async scrape(infoHashes: Buffer[]): Promise<ScrapeResponse> {
    const scrapeUrl = this.getScrapeUrl();

    if (scrapeUrl === null) {
      throw new TrackerError(
        'Tracker does not support scrape (announce URL does not contain "announce")',
        this.announceUrl
      );
    }

    // Validate info hashes
    for (const hash of infoHashes) {
      if (hash.length !== 20) {
        throw new TrackerError(
          'info_hash must be exactly 20 bytes',
          this.announceUrl
        );
      }
    }

    // Build the scrape URL
    const url = this.buildScrapeUrl(scrapeUrl, infoHashes);

    // Make the request
    const data = await this.makeRequest(url);

    // Parse the response
    return this.parseScrapeResponse(data);
  }

  /**
   * Get the scrape URL derived from the announce URL.
   *
   * The scrape URL is derived by replacing "announce" with "scrape" in the
   * path component of the URL. If the announce URL does not contain "announce",
   * scrape is not supported and null is returned.
   *
   * @returns The scrape URL, or null if scrape is not supported
   */
  getScrapeUrl(): string | null {
    // The BEP 48 spec says to replace the last occurrence of "announce" with "scrape"
    const url = new URL(this.announceUrl);
    const path = url.pathname;

    const lastAnnounceIndex = path.lastIndexOf('announce');
    if (lastAnnounceIndex === -1) {
      return null;
    }

    // Replace "announce" with "scrape"
    const newPath =
      path.substring(0, lastAnnounceIndex) +
      'scrape' +
      path.substring(lastAnnounceIndex + 'announce'.length);

    url.pathname = newPath;
    return url.toString();
  }

  /**
   * Build the announce URL with query parameters.
   */
  private buildAnnounceUrl(params: AnnounceParams): string {
    const url = new URL(this.announceUrl);

    // Add required parameters
    url.searchParams.set('info_hash', urlEncodeBinary(params.infoHash));
    url.searchParams.set('peer_id', urlEncodeBinary(params.peerId));
    url.searchParams.set('port', params.port.toString());
    url.searchParams.set('uploaded', params.uploaded.toString());
    url.searchParams.set('downloaded', params.downloaded.toString());
    url.searchParams.set('left', params.left.toString());

    // Add optional parameters
    if (params.event !== undefined) {
      url.searchParams.set('event', params.event);
    }

    // Compact is typically defaulted to 1 (true)
    const compact = params.compact ?? true;
    url.searchParams.set('compact', compact ? '1' : '0');

    // Number of peers wanted
    const numwant = params.numwant ?? DEFAULT_NUMWANT;
    url.searchParams.set('numwant', numwant.toString());

    // URLSearchParams encodes values, but we need raw binary encoding for info_hash and peer_id
    // So we need to manually construct the URL
    return this.buildUrlWithBinaryParams(params);
  }

  /**
   * Build URL with properly encoded binary parameters.
   *
   * URLSearchParams doesn't handle binary data correctly, so we manually
   * construct the query string.
   */
  private buildUrlWithBinaryParams(params: AnnounceParams): string {
    const url = new URL(this.announceUrl);

    const queryParts: string[] = [];

    // Required parameters
    queryParts.push(`info_hash=${urlEncodeBinary(params.infoHash)}`);
    queryParts.push(`peer_id=${urlEncodeBinary(params.peerId)}`);
    queryParts.push(`port=${params.port}`);
    queryParts.push(`uploaded=${params.uploaded}`);
    queryParts.push(`downloaded=${params.downloaded}`);
    queryParts.push(`left=${params.left}`);

    // Optional parameters
    if (params.event !== undefined) {
      queryParts.push(`event=${params.event}`);
    }

    const compact = params.compact ?? true;
    queryParts.push(`compact=${compact ? '1' : '0'}`);

    const numwant = params.numwant ?? DEFAULT_NUMWANT;
    queryParts.push(`numwant=${numwant}`);

    // Build the final URL
    const queryString = queryParts.join('&');
    const baseUrl = url.origin + url.pathname;

    return `${baseUrl}?${queryString}`;
  }

  /**
   * Build the scrape URL with info hash parameters.
   */
  private buildScrapeUrl(scrapeUrl: string, infoHashes: Buffer[]): string {
    const queryParts = infoHashes.map(
      (hash) => `info_hash=${urlEncodeBinary(hash)}`
    );

    const queryString = queryParts.join('&');
    return `${scrapeUrl}?${queryString}`;
  }

  /**
   * Make an HTTP request to the tracker.
   */
  private async makeRequest(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new TrackerError(
          `HTTP error ${response.status}: ${response.statusText}`,
          this.announceUrl
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      if (error instanceof TrackerError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new TrackerError(
            `Request timed out after ${this.timeout}ms`,
            this.announceUrl
          );
        }
        throw new TrackerError(
          `Network error: ${error.message}`,
          this.announceUrl
        );
      }

      throw new TrackerError('Unknown error occurred', this.announceUrl);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse a bencoded announce response.
   */
  private parseAnnounceResponse(data: Buffer): AnnounceResponse {
    let decoded: BencodeValue;

    try {
      decoded = decode(data);
    } catch (error) {
      throw new TrackerError(
        `Invalid bencode response: ${error instanceof Error ? error.message : 'unknown error'}`,
        this.announceUrl
      );
    }

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      throw new TrackerError(
        'Invalid response: expected dictionary',
        this.announceUrl
      );
    }

    const response = decoded as { [key: string]: BencodeValue };

    // Check for failure reason
    if ('failure reason' in response) {
      const reason = response['failure reason'];
      const message = Buffer.isBuffer(reason)
        ? reason.toString('utf8')
        : String(reason);
      throw new TrackerError(`Tracker error: ${message}`, this.announceUrl);
    }

    // Parse interval
    const interval = response['interval'];
    if (typeof interval !== 'number') {
      throw new TrackerError(
        'Invalid response: missing or invalid interval',
        this.announceUrl
      );
    }

    // Parse optional min interval
    const minInterval = response['min interval'];

    // Parse optional tracker id
    const trackerIdValue = response['tracker id'];
    let trackerId: string | undefined;
    if (trackerIdValue !== undefined) {
      trackerId = Buffer.isBuffer(trackerIdValue)
        ? trackerIdValue.toString('utf8')
        : String(trackerIdValue);
    }

    // Parse complete (seeders)
    const complete = response['complete'];
    const seeders = typeof complete === 'number' ? complete : 0;

    // Parse incomplete (leechers)
    const incomplete = response['incomplete'];
    const leechers = typeof incomplete === 'number' ? incomplete : 0;

    // Parse peers
    const peers = this.parsePeers(response['peers']);

    return {
      interval,
      minInterval: typeof minInterval === 'number' ? minInterval : undefined,
      trackerId,
      complete: seeders,
      incomplete: leechers,
      peers,
    };
  }

  /**
   * Parse the peers field from an announce response.
   *
   * Peers can be in two formats:
   * 1. Compact: A binary string where each peer is 6 bytes (4 IP + 2 port)
   * 2. Dictionary: A list of dictionaries with 'ip', 'port', and optionally 'peer id'
   */
  private parsePeers(peersValue: BencodeValue | undefined): PeerInfo[] {
    if (peersValue === undefined) {
      return [];
    }

    // Compact format: binary string
    if (Buffer.isBuffer(peersValue)) {
      return this.parseCompactPeers(peersValue);
    }

    // Dictionary format: list of peer dictionaries
    if (Array.isArray(peersValue)) {
      return this.parseDictPeers(peersValue);
    }

    throw new TrackerError(
      'Invalid peers format in response',
      this.announceUrl
    );
  }

  /**
   * Parse compact peer format (6 bytes per peer: 4 IP + 2 port big-endian).
   */
  private parseCompactPeers(data: Buffer): PeerInfo[] {
    if (data.length % 6 !== 0) {
      throw new TrackerError(
        `Invalid compact peers length: ${data.length} (must be multiple of 6)`,
        this.announceUrl
      );
    }

    const peers: PeerInfo[] = [];
    const numPeers = data.length / 6;

    for (let i = 0; i < numPeers; i++) {
      const offset = i * 6;

      // Parse IP address (4 bytes)
      const ip = [
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
      ].join('.');

      // Parse port (2 bytes, big-endian)
      const port = data.readUInt16BE(offset + 4);

      peers.push({ ip, port });
    }

    return peers;
  }

  /**
   * Parse dictionary peer format (list of {ip, port, peer id} dictionaries).
   */
  private parseDictPeers(peersArray: BencodeValue[]): PeerInfo[] {
    const peers: PeerInfo[] = [];

    for (const peerValue of peersArray) {
      if (
        typeof peerValue !== 'object' ||
        peerValue === null ||
        Array.isArray(peerValue)
      ) {
        continue;
      }

      const peerDict = peerValue as { [key: string]: BencodeValue };

      // Parse IP
      const ipValue = peerDict['ip'];
      if (ipValue === undefined) {
        continue;
      }
      const ip = Buffer.isBuffer(ipValue)
        ? ipValue.toString('utf8')
        : String(ipValue);

      // Parse port
      const portValue = peerDict['port'];
      if (typeof portValue !== 'number') {
        continue;
      }
      const port = portValue;

      // Parse optional peer ID
      const peerIdValue = peerDict['peer id'];
      let peerId: string | undefined;
      if (peerIdValue !== undefined) {
        peerId = Buffer.isBuffer(peerIdValue)
          ? peerIdValue.toString('hex')
          : String(peerIdValue);
      }

      peers.push({ ip, port, peerId });
    }

    return peers;
  }

  /**
   * Parse a bencoded scrape response.
   */
  private parseScrapeResponse(data: Buffer): ScrapeResponse {
    let decoded: BencodeValue;

    try {
      decoded = decode(data);
    } catch (error) {
      throw new TrackerError(
        `Invalid bencode response: ${error instanceof Error ? error.message : 'unknown error'}`,
        this.announceUrl
      );
    }

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      throw new TrackerError(
        'Invalid scrape response: expected dictionary',
        this.announceUrl
      );
    }

    const response = decoded as { [key: string]: BencodeValue };

    // Check for failure reason
    if ('failure reason' in response) {
      const reason = response['failure reason'];
      const message = Buffer.isBuffer(reason)
        ? reason.toString('utf8')
        : String(reason);
      throw new TrackerError(`Tracker error: ${message}`, this.announceUrl);
    }

    // Parse files dictionary
    const filesValue = response['files'];
    if (
      filesValue === undefined ||
      typeof filesValue !== 'object' ||
      filesValue === null ||
      Array.isArray(filesValue)
    ) {
      throw new TrackerError(
        'Invalid scrape response: missing or invalid files dictionary',
        this.announceUrl
      );
    }

    const filesDict = filesValue as { [key: string]: BencodeValue };
    const files = new Map<
      string,
      { complete: number; incomplete: number; downloaded: number }
    >();

    // The keys in the files dictionary are raw 20-byte info hashes
    for (const [key, value] of Object.entries(filesDict)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        continue;
      }

      const stats = value as { [key: string]: BencodeValue };

      // Convert the key (which may be binary) to hex
      const infoHashHex = Buffer.from(key, 'binary').toString('hex');

      const complete =
        typeof stats['complete'] === 'number' ? stats['complete'] : 0;
      const incomplete =
        typeof stats['incomplete'] === 'number' ? stats['incomplete'] : 0;
      const downloaded =
        typeof stats['downloaded'] === 'number' ? stats['downloaded'] : 0;

      files.set(infoHashHex, { complete, incomplete, downloaded });
    }

    return { files };
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * URL-encode binary data for use in tracker requests.
 *
 * This function percent-encodes each byte that is not an unreserved character
 * (letters, digits, '-', '.', '_', '~').
 *
 * @param data - Binary data to encode
 * @returns URL-encoded string
 */
export function urlEncodeBinary(data: Buffer): string {
  const result: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    const char = String.fromCharCode(byte);

    // RFC 3986 unreserved characters
    if (
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || // -
      byte === 0x2e || // .
      byte === 0x5f || // _
      byte === 0x7e // ~
    ) {
      result.push(char);
    } else {
      // Percent-encode
      result.push(`%${byte.toString(16).toUpperCase().padStart(2, '0')}`);
    }
  }

  return result.join('');
}
