/**
 * Tracker Coordinator for Torm Engine
 *
 * Manages multiple trackers for torrents, handling announce scheduling,
 * tier management, and peer aggregation.
 *
 * @module engine/tracker/client
 */

import { TypedEventEmitter } from '../events.js';
import { TrackerInfo, TrackerStatus } from '../types.js';
import { HTTPTracker } from './http.js';
import { UDPTracker } from './udp.js';

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Information about a peer returned from a tracker
 */
export interface PeerInfo {
  /** IP address of the peer */
  ip: string;

  /** Port number the peer is listening on */
  port: number;

  /** Optional peer ID (20 bytes as hex string) */
  peerId?: string;
}

/**
 * Events emitted by the TrackerClient
 */
export interface TrackerClientEvents {
  /** Emitted when peers are received from a tracker announce */
  announce: { infoHash: string; tracker: TrackerInfo; peers: PeerInfo[] };

  /** Emitted when a tracker encounters an error */
  error: { infoHash: string; url: string; error: Error };

  /** Emitted for non-fatal warnings */
  warning: { infoHash: string; url: string; message: string };
}

/**
 * Options for configuring the TrackerClient
 */
export interface TrackerClientOptions {
  /** Our 20-byte peer ID */
  peerId: Buffer;

  /** Our listening port for incoming connections */
  port: number;

  /** Optional user agent string for HTTP trackers */
  userAgent?: string;

  /** Override the announce interval from trackers (in seconds) */
  announceInterval?: number;
}

/**
 * State of a torrent for tracker announces
 */
export interface TorrentTrackerState {
  /** 20-byte info hash of the torrent */
  infoHash: Buffer;

  /** Total bytes downloaded */
  downloaded: number;

  /** Total bytes uploaded */
  uploaded: number;

  /** Bytes remaining to download */
  left: number;

  /** Tier list of tracker URLs */
  trackers: string[][];
}

/**
 * Response from a tracker announce
 */
export interface AnnounceResponse {
  /** Interval until next announce (seconds) */
  interval: number;

  /** Minimum interval between announces (seconds) */
  minInterval?: number;

  /** Tracker ID for future requests */
  trackerId?: string;

  /** Number of seeders */
  complete: number;

  /** Number of leechers */
  incomplete: number;

  /** List of peers */
  peers: PeerInfo[];

  /** Optional warning message from tracker */
  warning?: string;
}

/**
 * Internal state for a tracker
 */
interface TrackerState {
  /** Tracker URL */
  url: string;

  /** Protocol type */
  type: 'http' | 'udp' | 'unknown';

  /** Current status */
  status: TrackerStatus;

  /** Peers from last successful announce */
  peers: number;

  /** Seeders from last announce */
  seeds: number;

  /** Leechers from last announce */
  leeches: number;

  /** Last successful announce timestamp */
  lastAnnounce: Date | null;

  /** Next scheduled announce timestamp */
  nextAnnounce: Date | null;

  /** Error message if status is error */
  errorMessage?: string;

  /** Consecutive failure count for exponential backoff */
  failureCount: number;

  /** Announce interval from tracker (seconds) */
  interval: number;

  /** Minimum interval from tracker (seconds) */
  minInterval: number;

  /** Tracker ID from tracker */
  trackerId?: string;

  /** Timer handle for scheduled announce */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Internal state for a tracked torrent
 */
interface TorrentState {
  /** Info hash as hex string */
  infoHashHex: string;

  /** Info hash as Buffer */
  infoHash: Buffer;

  /** Bytes downloaded */
  downloaded: number;

  /** Bytes uploaded */
  uploaded: number;

  /** Bytes remaining */
  left: number;

  /** Tracker tiers (array of arrays of TrackerState) */
  tiers: TrackerState[][];

  /** Whether the torrent is active */
  active: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Determine the tracker protocol type from a URL
 *
 * @param url - Tracker URL
 * @returns Protocol type: 'http', 'udp', or 'unknown'
 */
export function getTrackerType(url: string): 'http' | 'udp' | 'unknown' {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol === 'http:' || protocol === 'https:') {
      return 'http';
    }

    if (protocol === 'udp:') {
      return 'udp';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Parse announce-list from torrent metadata
 *
 * Handles both single announce URL and multi-tier announce-list.
 * Returns a normalized tier structure.
 *
 * @param announce - Primary announce URL
 * @param announceList - Optional tier list of tracker URLs
 * @returns Normalized tier list
 */
export function parseAnnounceList(
  announce: string,
  announceList?: string[][]
): string[][] {
  // If we have an announce-list, use it
  if (announceList && announceList.length > 0) {
    // Filter out empty tiers and empty URLs
    const filtered = announceList
      .map((tier) => tier.filter((url) => url && url.trim().length > 0))
      .filter((tier) => tier.length > 0);

    if (filtered.length > 0) {
      // Add primary announce to tier 0 if not already present
      if (announce && !filtered.some((tier) => tier.includes(announce))) {
        filtered[0] = [announce, ...filtered[0]];
      }
      return filtered;
    }
  }

  // Fall back to single announce URL
  if (announce && announce.trim().length > 0) {
    return [[announce]];
  }

  return [];
}

/**
 * Shuffle an array in place using Fisher-Yates algorithm
 *
 * @param array - Array to shuffle
 * @returns The shuffled array (same reference)
 */
function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Calculate backoff delay for retries
 *
 * @param failureCount - Number of consecutive failures
 * @param baseInterval - Base interval in seconds
 * @returns Delay in milliseconds
 */
function calculateBackoff(failureCount: number, baseInterval: number): number {
  // Exponential backoff: base * 2^failures, capped at 1 hour
  const maxBackoff = 3600; // 1 hour in seconds
  const backoffSeconds = Math.min(
    baseInterval * Math.pow(2, failureCount),
    maxBackoff
  );
  return backoffSeconds * 1000;
}

/**
 * Create a unique key for a peer (for deduplication)
 *
 * @param peer - Peer info
 * @returns Unique key string
 */
function peerKey(peer: PeerInfo): string {
  return `${peer.ip}:${peer.port}`;
}

// =============================================================================
// TrackerClient Class
// =============================================================================

/**
 * Tracker Coordinator
 *
 * Manages tracker communication for multiple torrents:
 * - Handles multiple tracker tiers with failover
 * - Schedules periodic announces
 * - Aggregates and deduplicates peers
 * - Implements exponential backoff on failures
 *
 * @example
 * ```typescript
 * const client = new TrackerClient({
 *   peerId: Buffer.from('-TR3000-xxxxxxxxxxxx'),
 *   port: 6881,
 * });
 *
 * client.on('announce', ({ infoHash, tracker, peers }) => {
 *   console.log(`Got ${peers.length} peers from ${tracker.url}`);
 * });
 *
 * client.addTorrent({
 *   infoHash: Buffer.from(hash, 'hex'),
 *   downloaded: 0,
 *   uploaded: 0,
 *   left: totalSize,
 *   trackers: [['udp://tracker.example.com:1337/announce']],
 * });
 *
 * await client.announce(infoHashHex, 'started');
 * ```
 */
export class TrackerClient extends TypedEventEmitter<TrackerClientEvents> {
  /** Client options */
  private readonly options: Required<TrackerClientOptions>;

  /** Map of info hash (hex) to torrent state */
  private readonly torrents: Map<string, TorrentState> = new Map();

  /** Cache of HTTP tracker instances by URL */
  private readonly httpTrackers: Map<string, HTTPTracker> = new Map();

  /** Cache of UDP tracker instances by URL */
  private readonly udpTrackers: Map<string, UDPTracker> = new Map();

  /** Default announce interval if tracker doesn't specify (30 minutes) */
  private readonly defaultInterval = 1800;

  /** Minimum interval between announces (1 minute) */
  private readonly minAnnounceInterval = 60;

  /** Whether the client is stopped */
  private stopped = false;

  /**
   * Create a new TrackerClient
   *
   * @param options - Client configuration
   */
  constructor(options: TrackerClientOptions) {
    super();

    this.options = {
      peerId: options.peerId,
      port: options.port,
      userAgent: options.userAgent ?? 'Torm/1.0.0',
      announceInterval: options.announceInterval ?? 0,
    };
  }

  /**
   * Add a torrent to track
   *
   * @param state - Torrent tracker state
   */
  addTorrent(state: TorrentTrackerState): void {
    const infoHashHex = state.infoHash.toString('hex');

    if (this.torrents.has(infoHashHex)) {
      // Update existing torrent
      const existing = this.torrents.get(infoHashHex)!;
      existing.downloaded = state.downloaded;
      existing.uploaded = state.uploaded;
      existing.left = state.left;
      return;
    }

    // Create tracker state for each tier
    const tiers: TrackerState[][] = state.trackers.map((tier) => {
      // Shuffle trackers within tier for load balancing
      const shuffled = shuffleArray([...tier]);

      return shuffled.map((url) => ({
        url,
        type: getTrackerType(url),
        status: TrackerStatus.Idle,
        peers: 0,
        seeds: 0,
        leeches: 0,
        lastAnnounce: null,
        nextAnnounce: null,
        failureCount: 0,
        interval: this.defaultInterval,
        minInterval: this.minAnnounceInterval,
      }));
    });

    const torrent: TorrentState = {
      infoHashHex,
      infoHash: Buffer.from(state.infoHash),
      downloaded: state.downloaded,
      uploaded: state.uploaded,
      left: state.left,
      tiers,
      active: true,
    };

    this.torrents.set(infoHashHex, torrent);
  }

  /**
   * Remove a torrent from tracking
   *
   * Cancels all pending announce timers for this torrent.
   *
   * @param infoHash - Info hash as hex string
   */
  removeTorrent(infoHash: string): void {
    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      return;
    }

    // Cancel all timers
    for (const tier of torrent.tiers) {
      for (const tracker of tier) {
        if (tracker.timer) {
          clearTimeout(tracker.timer);
          tracker.timer = undefined;
        }
      }
    }

    this.torrents.delete(infoHash);
  }

  /**
   * Trigger an immediate announce for a torrent
   *
   * @param infoHash - Info hash as hex string
   * @param event - Optional announce event type
   */
  async announce(
    infoHash: string,
    event?: 'started' | 'completed' | 'stopped'
  ): Promise<void> {
    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    if (this.stopped) {
      return;
    }

    // Flatten all tiers and try ALL trackers in parallel for faster peer discovery
    const allTrackers = torrent.tiers.flat();

    // Try all trackers simultaneously - don't wait for failures
    const promises = allTrackers.map((tracker) =>
      this.announceToTracker(torrent, tracker, event)
    );

    const results = await Promise.allSettled(promises);

    // Check if any succeeded
    const succeeded = results.some(
      (result) => result.status === 'fulfilled' && result.value
    );

    if (!succeeded && event !== 'stopped') {
      // All trackers failed - emit warning
      this.emit('warning', {
        infoHash,
        url: '',
        message: 'All trackers failed to respond',
      });
    }
  }

  /**
   * Update torrent statistics
   *
   * Called periodically to update downloaded/uploaded/left values
   * for the next announce.
   *
   * @param infoHash - Info hash as hex string
   * @param downloaded - Total bytes downloaded
   * @param uploaded - Total bytes uploaded
   * @param left - Bytes remaining
   */
  updateStats(
    infoHash: string,
    downloaded: number,
    uploaded: number,
    left: number
  ): void {
    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      return;
    }

    torrent.downloaded = downloaded;
    torrent.uploaded = uploaded;
    torrent.left = left;
  }

  /**
   * Get tracker information for a torrent
   *
   * @param infoHash - Info hash as hex string
   * @returns Array of TrackerInfo objects
   */
  getTrackerInfo(infoHash: string): TrackerInfo[] {
    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      return [];
    }

    const trackers: TrackerInfo[] = [];

    for (const tier of torrent.tiers) {
      for (const tracker of tier) {
        trackers.push({
          url: tracker.url,
          status: tracker.status,
          peers: tracker.peers,
          seeds: tracker.seeds,
          leeches: tracker.leeches,
          lastAnnounce: tracker.lastAnnounce,
          nextAnnounce: tracker.nextAnnounce,
          errorMessage: tracker.errorMessage,
        });
      }
    }

    return trackers;
  }

  /**
   * Stop all tracking
   *
   * Sends 'stopped' event to all trackers and cancels timers.
   */
  async stop(): Promise<void> {
    this.stopped = true;

    // Send stopped event to all torrents
    const stopPromises: Promise<void>[] = [];

    for (const [infoHash, torrent] of this.torrents) {
      // Cancel all timers first
      for (const tier of torrent.tiers) {
        for (const tracker of tier) {
          if (tracker.timer) {
            clearTimeout(tracker.timer);
            tracker.timer = undefined;
          }
        }
      }

      // Send stopped announce (best effort)
      stopPromises.push(
        this.announce(infoHash, 'stopped').catch(() => {
          // Ignore errors on stop
        })
      );
    }

    // Wait for all stop announces to complete (with timeout)
    await Promise.race([
      Promise.allSettled(stopPromises),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);

    // Close all UDP trackers
    for (const tracker of this.udpTrackers.values()) {
      tracker.close();
    }
    this.udpTrackers.clear();
    this.httpTrackers.clear();

    // Clear all state
    this.torrents.clear();
  }

  /**
   * Announce to a specific tracker
   *
   * @param torrent - Torrent state
   * @param tracker - Tracker state
   * @param event - Optional announce event
   * @returns True if announce succeeded
   */
  private async announceToTracker(
    torrent: TorrentState,
    tracker: TrackerState,
    event?: 'started' | 'completed' | 'stopped'
  ): Promise<boolean> {
    // Cancel existing timer
    if (tracker.timer) {
      clearTimeout(tracker.timer);
      tracker.timer = undefined;
    }

    // Skip unknown protocol trackers
    if (tracker.type === 'unknown') {
      tracker.status = TrackerStatus.Error;
      tracker.errorMessage = 'Unknown tracker protocol';
      return false;
    }

    tracker.status = TrackerStatus.Announcing;

    try {
      // Perform the announce based on tracker type
      const response = await this.performAnnounce(torrent, tracker, event);

      // Update tracker state with response
      tracker.status = TrackerStatus.Working;
      tracker.peers = response.peers.length;
      tracker.seeds = response.complete;
      tracker.leeches = response.incomplete;
      tracker.lastAnnounce = new Date();
      tracker.failureCount = 0;
      tracker.errorMessage = undefined;

      // Update intervals
      if (response.interval > 0) {
        tracker.interval = this.options.announceInterval || response.interval;
      }
      if (response.minInterval) {
        tracker.minInterval = response.minInterval;
      }
      if (response.trackerId) {
        tracker.trackerId = response.trackerId;
      }

      // Schedule next announce (unless stopping)
      if (event !== 'stopped' && !this.stopped && torrent.active) {
        const nextAnnounceMs = Math.max(
          tracker.interval,
          tracker.minInterval
        ) * 1000;
        tracker.nextAnnounce = new Date(Date.now() + nextAnnounceMs);

        tracker.timer = setTimeout(() => {
          this.announceToTracker(torrent, tracker).catch((err) => {
            this.emit('error', {
              infoHash: torrent.infoHashHex,
              url: tracker.url,
              error: err instanceof Error ? err : new Error(String(err)),
            });
          });
        }, nextAnnounceMs);
      }

      // Emit warning if tracker provided one
      if (response.warning) {
        this.emit('warning', {
          infoHash: torrent.infoHashHex,
          url: tracker.url,
          message: response.warning,
        });
      }

      // Emit announce event with peers
      const trackerInfo: TrackerInfo = {
        url: tracker.url,
        status: tracker.status,
        peers: tracker.peers,
        seeds: tracker.seeds,
        leeches: tracker.leeches,
        lastAnnounce: tracker.lastAnnounce,
        nextAnnounce: tracker.nextAnnounce,
      };

      // Deduplicate peers
      const uniquePeers = this.deduplicatePeers(response.peers);

      this.emit('announce', {
        infoHash: torrent.infoHashHex,
        tracker: trackerInfo,
        peers: uniquePeers,
      });

      return true;
    } catch (err) {
      // Handle failure
      tracker.status = TrackerStatus.Error;
      tracker.failureCount++;
      tracker.errorMessage =
        err instanceof Error ? err.message : String(err);

      // Emit error event
      this.emit('error', {
        infoHash: torrent.infoHashHex,
        url: tracker.url,
        error: err instanceof Error ? err : new Error(String(err)),
      });

      // Schedule retry with exponential backoff (unless stopping)
      if (event !== 'stopped' && !this.stopped && torrent.active) {
        const backoffMs = calculateBackoff(
          tracker.failureCount,
          tracker.interval
        );
        tracker.nextAnnounce = new Date(Date.now() + backoffMs);

        tracker.timer = setTimeout(() => {
          this.announceToTracker(torrent, tracker).catch(() => {
            // Error already handled
          });
        }, backoffMs);
      }

      return false;
    }
  }

  /**
   * Perform the actual announce request
   *
   * This method dispatches to HTTP or UDP tracker implementations.
   * Currently a stub that will be implemented with actual protocol handlers.
   *
   * @param torrent - Torrent state
   * @param tracker - Tracker state
   * @param event - Optional announce event
   * @returns Announce response
   */
  private async performAnnounce(
    torrent: TorrentState,
    tracker: TrackerState,
    event?: 'started' | 'completed' | 'stopped'
  ): Promise<AnnounceResponse> {
    // Build common announce parameters
    const _params = {
      infoHash: torrent.infoHash,
      peerId: this.options.peerId,
      port: this.options.port,
      uploaded: torrent.uploaded,
      downloaded: torrent.downloaded,
      left: torrent.left,
      compact: 1,
      numWant: event === 'stopped' ? 0 : 50,
      event,
      trackerId: tracker.trackerId,
    };

    if (tracker.type === 'http') {
      return this.announceHTTP(tracker.url, _params);
    } else if (tracker.type === 'udp') {
      return this.announceUDP(tracker.url, _params);
    }

    throw new Error(`Unsupported tracker type: ${tracker.type}`);
  }

  /**
   * HTTP tracker announce
   *
   * Uses the HTTPTracker class to perform announce requests.
   * Tracker instances are cached for reuse.
   *
   * @param url - Tracker URL
   * @param params - Announce parameters
   * @returns Announce response
   */
  private async announceHTTP(
    url: string,
    params: {
      infoHash: Buffer;
      peerId: Buffer;
      port: number;
      uploaded: number;
      downloaded: number;
      left: number;
      compact: number;
      numWant: number;
      event?: string;
      trackerId?: string;
    }
  ): Promise<AnnounceResponse> {
    // Get or create cached tracker instance
    let tracker = this.httpTrackers.get(url);
    if (!tracker) {
      tracker = new HTTPTracker(url, {
        userAgent: this.options.userAgent,
      });
      this.httpTrackers.set(url, tracker);
    }

    // Convert event string to the expected type
    const event = params.event as 'started' | 'completed' | 'stopped' | undefined;

    // Perform the announce
    const response = await tracker.announce({
      infoHash: params.infoHash,
      peerId: params.peerId,
      port: params.port,
      uploaded: params.uploaded,
      downloaded: params.downloaded,
      left: params.left,
      compact: params.compact === 1,
      numwant: params.numWant,
      event,
    });

    return {
      interval: response.interval,
      minInterval: response.minInterval,
      trackerId: response.trackerId,
      complete: response.complete,
      incomplete: response.incomplete,
      peers: response.peers,
    };
  }

  /**
   * UDP tracker announce
   *
   * Uses the UDPTracker class to perform announce requests.
   * Tracker instances are cached for reuse (connection IDs are reused).
   *
   * @param url - Tracker URL
   * @param params - Announce parameters
   * @returns Announce response
   */
  private async announceUDP(
    url: string,
    params: {
      infoHash: Buffer;
      peerId: Buffer;
      port: number;
      uploaded: number;
      downloaded: number;
      left: number;
      compact: number;
      numWant: number;
      event?: string;
      trackerId?: string;
    }
  ): Promise<AnnounceResponse> {
    // Get or create cached tracker instance
    let tracker = this.udpTrackers.get(url);
    if (!tracker) {
      tracker = new UDPTracker(url);
      this.udpTrackers.set(url, tracker);
    }

    // Convert event string to UDP event code
    // 0 = none, 1 = completed, 2 = started, 3 = stopped
    let eventCode: 0 | 1 | 2 | 3 = 0;
    if (params.event === 'started') {
      eventCode = 2;
    } else if (params.event === 'completed') {
      eventCode = 1;
    } else if (params.event === 'stopped') {
      eventCode = 3;
    }

    // Perform the announce
    const response = await tracker.announce({
      infoHash: params.infoHash,
      peerId: params.peerId,
      port: params.port,
      uploaded: BigInt(params.uploaded),
      downloaded: BigInt(params.downloaded),
      left: BigInt(params.left),
      event: eventCode,
      numWant: params.numWant,
    });

    return {
      interval: response.interval,
      complete: response.seeders,
      incomplete: response.leechers,
      peers: response.peers,
    };
  }

  /**
   * Deduplicate peers by IP:port
   *
   * @param peers - Array of peers (may contain duplicates)
   * @returns Deduplicated array of peers
   */
  private deduplicatePeers(peers: PeerInfo[]): PeerInfo[] {
    const seen = new Set<string>();
    const unique: PeerInfo[] = [];

    for (const peer of peers) {
      const key = peerKey(peer);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(peer);
      }
    }

    return unique;
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default TrackerClient;
