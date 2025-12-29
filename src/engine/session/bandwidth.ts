/**
 * Token Bucket Bandwidth Limiter for Torm Engine
 *
 * Implements rate limiting using the token bucket algorithm for both
 * upload and download directions, with support for global and per-torrent limits.
 *
 * Features:
 * - Configurable rate (bytes/second) and burst size
 * - Separate upload/download limits
 * - Global and per-torrent limits
 * - Fair bandwidth distribution across requesters
 * - 0 = unlimited mode
 *
 * @module engine/session/bandwidth
 */

import { TypedEventEmitter } from '../events.js';

// =============================================================================
// Constants
// =============================================================================

/** Interval for token replenishment in milliseconds */
const REPLENISH_INTERVAL = 100;

/** Default burst size multiplier (burst = rate * multiplier) */
const DEFAULT_BURST_MULTIPLIER = 1.5;

/** Minimum bytes to allocate in a single grant */
const MIN_GRANT_SIZE = 1024;

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Direction of data transfer
 */
export type TransferDirection = 'upload' | 'download';

/**
 * Statistics for a single bucket
 */
export interface BucketStats {
  /** Current available tokens (bytes) */
  availableTokens: number;

  /** Maximum tokens (burst size) */
  maxTokens: number;

  /** Configured rate in bytes/second (0 = unlimited) */
  rate: number;

  /** Number of pending requests in the queue */
  pendingRequests: number;

  /** Total bytes granted through this bucket */
  totalBytesGranted: number;
}

/**
 * Statistics for a torrent's bandwidth usage
 */
export interface TorrentBandwidthStats {
  /** Torrent info hash */
  torrentId: string;

  /** Download bucket statistics */
  download: BucketStats;

  /** Upload bucket statistics */
  upload: BucketStats;
}

/**
 * Global bandwidth statistics
 */
export interface BandwidthStats {
  /** Global download bucket statistics */
  globalDownload: BucketStats;

  /** Global upload bucket statistics */
  globalUpload: BucketStats;

  /** Per-torrent statistics */
  torrents: TorrentBandwidthStats[];

  /** Total pending requests across all buckets */
  totalPendingRequests: number;

  /** Whether the limiter is currently active */
  isRunning: boolean;
}

/**
 * Configuration for bandwidth limits
 */
export interface BandwidthLimitConfig {
  /** Download rate in bytes/second (0 = unlimited) */
  downloadRate: number;

  /** Upload rate in bytes/second (0 = unlimited) */
  uploadRate: number;

  /** Optional download burst size (defaults to rate * 1.5) */
  downloadBurst?: number;

  /** Optional upload burst size (defaults to rate * 1.5) */
  uploadBurst?: number;
}

/**
 * Events emitted by the BandwidthLimiter
 */
export interface BandwidthLimiterEvents {
  /** Emitted when global limits are changed */
  limitsChanged: {
    type: 'global';
    download: number;
    upload: number;
  };

  /** Emitted when torrent limits are changed */
  torrentLimitsChanged: {
    type: 'torrent';
    torrentId: string;
    download: number;
    upload: number;
  };

  /** Emitted when a torrent is removed from bandwidth tracking */
  torrentRemoved: {
    torrentId: string;
  };

  /** Emitted when bandwidth is exhausted and requests are queued */
  bandwidthExhausted: {
    direction: TransferDirection;
    torrentId?: string;
    pendingBytes: number;
  };
}

/**
 * Pending bandwidth request
 */
interface PendingRequest {
  /** Number of bytes requested */
  bytes: number;

  /** Request timestamp for fair ordering */
  timestamp: number;

  /** Resolve function to call when tokens are available */
  resolve: () => void;

  /** Optional torrent ID for per-torrent limiting */
  torrentId?: string;
}

/**
 * Token bucket for rate limiting
 */
interface TokenBucket {
  /** Current available tokens (bytes) */
  tokens: number;

  /** Maximum tokens (burst size) */
  maxTokens: number;

  /** Token replenishment rate (bytes/second), 0 = unlimited */
  rate: number;

  /** Timestamp of last token replenishment */
  lastReplenish: number;

  /** Queue of pending requests */
  pendingQueue: PendingRequest[];

  /** Total bytes granted through this bucket */
  totalBytesGranted: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new token bucket with the given configuration
 *
 * @param rate - Rate in bytes/second (0 = unlimited)
 * @param burst - Optional burst size (defaults to rate * 1.5)
 * @returns New token bucket
 */
function createBucket(rate: number, burst?: number): TokenBucket {
  const maxTokens =
    burst ?? Math.max(rate * DEFAULT_BURST_MULTIPLIER, MIN_GRANT_SIZE);

  return {
    tokens: maxTokens,
    maxTokens,
    rate,
    lastReplenish: Date.now(),
    pendingQueue: [],
    totalBytesGranted: 0,
  };
}

/**
 * Check if a bucket is unlimited (no rate limiting)
 *
 * @param bucket - Token bucket to check
 * @returns True if unlimited
 */
function isUnlimited(bucket: TokenBucket): boolean {
  return bucket.rate === 0;
}

/**
 * Get bucket statistics
 *
 * @param bucket - Token bucket
 * @returns Bucket statistics
 */
function getBucketStats(bucket: TokenBucket): BucketStats {
  return {
    availableTokens: Math.floor(bucket.tokens),
    maxTokens: Math.floor(bucket.maxTokens),
    rate: bucket.rate,
    pendingRequests: bucket.pendingQueue.length,
    totalBytesGranted: bucket.totalBytesGranted,
  };
}

// =============================================================================
// BandwidthLimiter Class
// =============================================================================

/**
 * Token Bucket Bandwidth Limiter
 *
 * Implements the token bucket algorithm for rate limiting bandwidth usage
 * in the BitTorrent client. Supports separate upload/download limits and
 * both global and per-torrent rate limiting.
 *
 * The token bucket algorithm works by:
 * 1. Tokens are added to the bucket at the configured rate
 * 2. Each byte transferred consumes one token
 * 3. The bucket has a maximum capacity (burst size)
 * 4. Requests wait when tokens are exhausted
 *
 * Fair distribution is achieved by:
 * - Processing pending requests in FIFO order
 * - Fairly dividing available tokens among waiting requesters
 * - Respecting both global and per-torrent limits
 *
 * @example
 * ```typescript
 * const limiter = new BandwidthLimiter();
 *
 * // Set global limits (1 MB/s download, 500 KB/s upload)
 * limiter.setGlobalLimits(1024 * 1024, 512 * 1024);
 *
 * // Set per-torrent limits
 * limiter.setTorrentLimits('abc123', 500 * 1024, 250 * 1024);
 *
 * // Request bandwidth (will wait if tokens exhausted)
 * await limiter.request(16384, 'download', 'abc123');
 *
 * // Send/receive data...
 *
 * // Get statistics
 * const stats = limiter.getStats();
 * console.log(`Pending requests: ${stats.totalPendingRequests}`);
 *
 * // Clean up
 * limiter.stop();
 * ```
 */
export class BandwidthLimiter extends TypedEventEmitter<BandwidthLimiterEvents> {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** Global download bucket */
  private globalDownloadBucket: TokenBucket;

  /** Global upload bucket */
  private globalUploadBucket: TokenBucket;

  /** Per-torrent download buckets */
  private torrentDownloadBuckets: Map<string, TokenBucket>;

  /** Per-torrent upload buckets */
  private torrentUploadBuckets: Map<string, TokenBucket>;

  /** Token replenishment timer */
  private replenishTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether the limiter is running */
  private running = false;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Create a new BandwidthLimiter
   *
   * @param config - Optional initial configuration for global limits
   */
  constructor(config?: BandwidthLimitConfig) {
    super();

    // Initialize global buckets (0 = unlimited by default)
    const downloadRate = config?.downloadRate ?? 0;
    const uploadRate = config?.uploadRate ?? 0;

    this.globalDownloadBucket = createBucket(
      downloadRate,
      config?.downloadBurst
    );
    this.globalUploadBucket = createBucket(uploadRate, config?.uploadBurst);

    // Initialize per-torrent bucket maps
    this.torrentDownloadBuckets = new Map();
    this.torrentUploadBuckets = new Map();

    // Start the replenishment timer
    this.start();
  }

  // ===========================================================================
  // Public Methods - Bandwidth Requests
  // ===========================================================================

  /**
   * Request bandwidth for a transfer
   *
   * This method will:
   * 1. Check if bandwidth is available (both global and per-torrent if applicable)
   * 2. If available, consume tokens and return immediately
   * 3. If not available, queue the request and wait for tokens
   *
   * For unlimited buckets (rate = 0), this returns immediately without consuming tokens.
   *
   * @param bytes - Number of bytes to transfer
   * @param direction - Transfer direction ('upload' or 'download')
   * @param torrentId - Optional torrent ID for per-torrent limiting
   * @returns Promise that resolves when bandwidth is available
   */
  async request(
    bytes: number,
    direction: TransferDirection,
    torrentId?: string
  ): Promise<void> {
    if (bytes <= 0) {
      return;
    }

    // Get the relevant buckets
    const globalBucket =
      direction === 'download'
        ? this.globalDownloadBucket
        : this.globalUploadBucket;

    const torrentBucket = torrentId
      ? direction === 'download'
        ? this.torrentDownloadBuckets.get(torrentId)
        : this.torrentUploadBuckets.get(torrentId)
      : undefined;

    // Check if both buckets are unlimited
    const globalUnlimited = isUnlimited(globalBucket);
    const torrentUnlimited = !torrentBucket || isUnlimited(torrentBucket);

    if (globalUnlimited && torrentUnlimited) {
      // No rate limiting, allow immediately
      globalBucket.totalBytesGranted += bytes;
      if (torrentBucket) {
        torrentBucket.totalBytesGranted += bytes;
      }
      return;
    }

    // Try to acquire tokens immediately
    if (this.tryAcquire(bytes, globalBucket, torrentBucket)) {
      return;
    }

    // Queue the request and wait
    return this.queueRequest(bytes, direction, torrentId);
  }

  // ===========================================================================
  // Public Methods - Limit Configuration
  // ===========================================================================

  /**
   * Set global bandwidth limits
   *
   * @param download - Download rate in bytes/second (0 = unlimited)
   * @param upload - Upload rate in bytes/second (0 = unlimited)
   * @param downloadBurst - Optional download burst size
   * @param uploadBurst - Optional upload burst size
   */
  setGlobalLimits(
    download: number,
    upload: number,
    downloadBurst?: number,
    uploadBurst?: number
  ): void {
    // Update download bucket
    this.updateBucket(this.globalDownloadBucket, download, downloadBurst);

    // Update upload bucket
    this.updateBucket(this.globalUploadBucket, upload, uploadBurst);

    // Emit event
    this.emit('limitsChanged', {
      type: 'global',
      download,
      upload,
    });

    // Process any pending requests that might now be fulfillable
    this.processPendingRequests();
  }

  /**
   * Set per-torrent bandwidth limits
   *
   * Creates new buckets for the torrent if they don't exist.
   *
   * @param torrentId - Torrent info hash
   * @param download - Download rate in bytes/second (0 = unlimited)
   * @param upload - Upload rate in bytes/second (0 = unlimited)
   * @param downloadBurst - Optional download burst size
   * @param uploadBurst - Optional upload burst size
   */
  setTorrentLimits(
    torrentId: string,
    download: number,
    upload: number,
    downloadBurst?: number,
    uploadBurst?: number
  ): void {
    // Get or create download bucket
    let downloadBucket = this.torrentDownloadBuckets.get(torrentId);
    if (!downloadBucket) {
      downloadBucket = createBucket(download, downloadBurst);
      this.torrentDownloadBuckets.set(torrentId, downloadBucket);
    } else {
      this.updateBucket(downloadBucket, download, downloadBurst);
    }

    // Get or create upload bucket
    let uploadBucket = this.torrentUploadBuckets.get(torrentId);
    if (!uploadBucket) {
      uploadBucket = createBucket(upload, uploadBurst);
      this.torrentUploadBuckets.set(torrentId, uploadBucket);
    } else {
      this.updateBucket(uploadBucket, upload, uploadBurst);
    }

    // Emit event
    this.emit('torrentLimitsChanged', {
      type: 'torrent',
      torrentId,
      download,
      upload,
    });

    // Process any pending requests that might now be fulfillable
    this.processPendingRequests();
  }

  /**
   * Remove a torrent from bandwidth tracking
   *
   * Clears any pending requests for the torrent and removes its buckets.
   *
   * @param torrentId - Torrent info hash
   */
  removeTorrent(torrentId: string): void {
    // Remove download bucket
    const downloadBucket = this.torrentDownloadBuckets.get(torrentId);
    if (downloadBucket) {
      // Resolve any pending requests (they'll just proceed without per-torrent limiting)
      for (const request of downloadBucket.pendingQueue) {
        request.resolve();
      }
      this.torrentDownloadBuckets.delete(torrentId);
    }

    // Remove upload bucket
    const uploadBucket = this.torrentUploadBuckets.get(torrentId);
    if (uploadBucket) {
      // Resolve any pending requests
      for (const request of uploadBucket.pendingQueue) {
        request.resolve();
      }
      this.torrentUploadBuckets.delete(torrentId);
    }

    // Also clear pending requests from global buckets for this torrent
    this.clearTorrentFromGlobalQueues(torrentId);

    // Emit event
    this.emit('torrentRemoved', { torrentId });
  }

  // ===========================================================================
  // Public Methods - Statistics and Control
  // ===========================================================================

  /**
   * Get bandwidth statistics
   *
   * @returns Current bandwidth statistics
   */
  getStats(): BandwidthStats {
    // Calculate total pending requests
    let totalPendingRequests =
      this.globalDownloadBucket.pendingQueue.length +
      this.globalUploadBucket.pendingQueue.length;

    // Collect per-torrent stats
    const torrents: TorrentBandwidthStats[] = [];

    // Get all unique torrent IDs
    const torrentIds = new Set([
      ...this.torrentDownloadBuckets.keys(),
      ...this.torrentUploadBuckets.keys(),
    ]);

    for (const torrentId of torrentIds) {
      const downloadBucket = this.torrentDownloadBuckets.get(torrentId);
      const uploadBucket = this.torrentUploadBuckets.get(torrentId);

      // Create default stats for missing buckets
      const defaultStats: BucketStats = {
        availableTokens: 0,
        maxTokens: 0,
        rate: 0,
        pendingRequests: 0,
        totalBytesGranted: 0,
      };

      const downloadStats = downloadBucket
        ? getBucketStats(downloadBucket)
        : defaultStats;
      const uploadStats = uploadBucket
        ? getBucketStats(uploadBucket)
        : defaultStats;

      totalPendingRequests +=
        downloadStats.pendingRequests + uploadStats.pendingRequests;

      torrents.push({
        torrentId,
        download: downloadStats,
        upload: uploadStats,
      });
    }

    return {
      globalDownload: getBucketStats(this.globalDownloadBucket),
      globalUpload: getBucketStats(this.globalUploadBucket),
      torrents,
      totalPendingRequests,
      isRunning: this.running,
    };
  }

  /**
   * Start the bandwidth limiter
   *
   * Begins token replenishment. Called automatically in constructor.
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Start replenishment timer
    this.replenishTimer = setInterval(() => {
      this.replenishTokens();
      this.processPendingRequests();
    }, REPLENISH_INTERVAL);
  }

  /**
   * Stop the bandwidth limiter
   *
   * Stops token replenishment and resolves all pending requests.
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    // Stop replenishment timer
    if (this.replenishTimer) {
      clearInterval(this.replenishTimer);
      this.replenishTimer = null;
    }

    // Resolve all pending requests (allow them to proceed)
    this.resolveAllPending(this.globalDownloadBucket);
    this.resolveAllPending(this.globalUploadBucket);

    for (const bucket of this.torrentDownloadBuckets.values()) {
      this.resolveAllPending(bucket);
    }

    for (const bucket of this.torrentUploadBuckets.values()) {
      this.resolveAllPending(bucket);
    }
  }

  // ===========================================================================
  // Private Methods - Token Management
  // ===========================================================================

  /**
   * Try to acquire tokens from the buckets
   *
   * @param bytes - Number of bytes (tokens) to acquire
   * @param globalBucket - Global bucket
   * @param torrentBucket - Optional per-torrent bucket
   * @returns True if tokens were acquired
   */
  private tryAcquire(
    bytes: number,
    globalBucket: TokenBucket,
    torrentBucket?: TokenBucket
  ): boolean {
    const globalUnlimited = isUnlimited(globalBucket);
    const torrentUnlimited = !torrentBucket || isUnlimited(torrentBucket);

    // Check global bucket (if limited)
    if (!globalUnlimited && globalBucket.tokens < bytes) {
      return false;
    }

    // Check torrent bucket (if limited)
    if (!torrentUnlimited && torrentBucket && torrentBucket.tokens < bytes) {
      return false;
    }

    // Acquire tokens
    if (!globalUnlimited) {
      globalBucket.tokens -= bytes;
      globalBucket.totalBytesGranted += bytes;
    } else {
      globalBucket.totalBytesGranted += bytes;
    }

    if (!torrentUnlimited && torrentBucket) {
      torrentBucket.tokens -= bytes;
      torrentBucket.totalBytesGranted += bytes;
    } else if (torrentBucket) {
      torrentBucket.totalBytesGranted += bytes;
    }

    return true;
  }

  /**
   * Queue a bandwidth request
   *
   * @param bytes - Number of bytes requested
   * @param direction - Transfer direction
   * @param torrentId - Optional torrent ID
   * @returns Promise that resolves when bandwidth is available
   */
  private queueRequest(
    bytes: number,
    direction: TransferDirection,
    torrentId?: string
  ): Promise<void> {
    return new Promise((resolve) => {
      const request: PendingRequest = {
        bytes,
        timestamp: Date.now(),
        resolve,
        torrentId,
      };

      // Add to global queue
      const globalBucket =
        direction === 'download'
          ? this.globalDownloadBucket
          : this.globalUploadBucket;

      if (!isUnlimited(globalBucket)) {
        globalBucket.pendingQueue.push(request);
      }

      // Add to torrent queue if applicable
      if (torrentId) {
        const torrentBucket =
          direction === 'download'
            ? this.torrentDownloadBuckets.get(torrentId)
            : this.torrentUploadBuckets.get(torrentId);

        if (torrentBucket && !isUnlimited(torrentBucket)) {
          torrentBucket.pendingQueue.push(request);
        }
      }

      // Emit bandwidth exhausted event
      this.emit('bandwidthExhausted', {
        direction,
        torrentId,
        pendingBytes: bytes,
      });
    });
  }

  /**
   * Replenish tokens in all buckets
   */
  private replenishTokens(): void {
    const now = Date.now();

    // Replenish global buckets
    this.replenishBucket(this.globalDownloadBucket, now);
    this.replenishBucket(this.globalUploadBucket, now);

    // Replenish per-torrent buckets
    for (const bucket of this.torrentDownloadBuckets.values()) {
      this.replenishBucket(bucket, now);
    }

    for (const bucket of this.torrentUploadBuckets.values()) {
      this.replenishBucket(bucket, now);
    }
  }

  /**
   * Replenish tokens in a single bucket
   *
   * @param bucket - Bucket to replenish
   * @param now - Current timestamp
   */
  private replenishBucket(bucket: TokenBucket, now: number): void {
    if (isUnlimited(bucket)) {
      bucket.lastReplenish = now;
      return;
    }

    const elapsed = now - bucket.lastReplenish;
    const tokensToAdd = (bucket.rate * elapsed) / 1000;

    bucket.tokens = Math.min(bucket.tokens + tokensToAdd, bucket.maxTokens);
    bucket.lastReplenish = now;
  }

  /**
   * Process pending requests across all buckets
   *
   * Uses fair distribution by processing requests in timestamp order
   * and dividing available tokens among waiting requesters.
   */
  private processPendingRequests(): void {
    // Process global download queue
    this.processQueue(this.globalDownloadBucket, 'download');

    // Process global upload queue
    this.processQueue(this.globalUploadBucket, 'upload');

    // Process per-torrent queues
    for (const [torrentId, bucket] of this.torrentDownloadBuckets) {
      this.processQueue(bucket, 'download', torrentId);
    }

    for (const [torrentId, bucket] of this.torrentUploadBuckets) {
      this.processQueue(bucket, 'upload', torrentId);
    }
  }

  /**
   * Process a single bucket's pending request queue
   *
   * @param bucket - Bucket to process
   * @param direction - Transfer direction
   * @param torrentId - Optional torrent ID for per-torrent buckets
   */
  private processQueue(
    bucket: TokenBucket,
    direction: TransferDirection,
    torrentId?: string
  ): void {
    if (isUnlimited(bucket) || bucket.pendingQueue.length === 0) {
      return;
    }

    // Sort by timestamp for fair ordering
    bucket.pendingQueue.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate fair share for each requester
    const pendingCount = bucket.pendingQueue.length;
    const fairShare = Math.floor(bucket.tokens / pendingCount);

    // Process requests that can be fulfilled
    const fulfilled: PendingRequest[] = [];

    for (const request of bucket.pendingQueue) {
      // Check if we can fulfill this request
      // For fairness, grant if request size <= fair share OR if enough tokens exist
      const canFulfill =
        request.bytes <= fairShare || request.bytes <= bucket.tokens;

      if (canFulfill && bucket.tokens >= request.bytes) {
        // Check per-torrent bucket if this is a global queue
        if (!torrentId && request.torrentId) {
          const torrentBucket =
            direction === 'download'
              ? this.torrentDownloadBuckets.get(request.torrentId)
              : this.torrentUploadBuckets.get(request.torrentId);

          if (torrentBucket && !isUnlimited(torrentBucket)) {
            if (torrentBucket.tokens < request.bytes) {
              // Not enough tokens in per-torrent bucket
              continue;
            }
            // Consume from per-torrent bucket
            torrentBucket.tokens -= request.bytes;
            torrentBucket.totalBytesGranted += request.bytes;

            // Remove from per-torrent queue
            const torrentIdx = torrentBucket.pendingQueue.indexOf(request);
            if (torrentIdx !== -1) {
              torrentBucket.pendingQueue.splice(torrentIdx, 1);
            }
          }
        }

        // Consume tokens from this bucket
        bucket.tokens -= request.bytes;
        bucket.totalBytesGranted += request.bytes;

        // Mark as fulfilled
        fulfilled.push(request);

        // Resolve the promise
        request.resolve();
      }
    }

    // Remove fulfilled requests from queue
    for (const request of fulfilled) {
      const idx = bucket.pendingQueue.indexOf(request);
      if (idx !== -1) {
        bucket.pendingQueue.splice(idx, 1);
      }
    }
  }

  /**
   * Update a bucket's rate and burst size
   *
   * @param bucket - Bucket to update
   * @param rate - New rate in bytes/second
   * @param burst - Optional new burst size
   */
  private updateBucket(
    bucket: TokenBucket,
    rate: number,
    burst?: number
  ): void {
    const newMaxTokens =
      burst ?? Math.max(rate * DEFAULT_BURST_MULTIPLIER, MIN_GRANT_SIZE);

    // Preserve the ratio of current tokens to max tokens
    const ratio = bucket.maxTokens > 0 ? bucket.tokens / bucket.maxTokens : 1;

    bucket.rate = rate;
    bucket.maxTokens = newMaxTokens;
    bucket.tokens = Math.min(newMaxTokens * ratio, newMaxTokens);
    bucket.lastReplenish = Date.now();
  }

  /**
   * Clear a torrent's pending requests from global queues
   *
   * @param torrentId - Torrent ID to clear
   */
  private clearTorrentFromGlobalQueues(torrentId: string): void {
    // Clear from global download queue
    const downloadFiltered = this.globalDownloadBucket.pendingQueue.filter(
      (r) => r.torrentId !== torrentId
    );
    const downloadRemoved = this.globalDownloadBucket.pendingQueue.filter(
      (r) => r.torrentId === torrentId
    );

    this.globalDownloadBucket.pendingQueue = downloadFiltered;

    // Resolve removed requests
    for (const request of downloadRemoved) {
      request.resolve();
    }

    // Clear from global upload queue
    const uploadFiltered = this.globalUploadBucket.pendingQueue.filter(
      (r) => r.torrentId !== torrentId
    );
    const uploadRemoved = this.globalUploadBucket.pendingQueue.filter(
      (r) => r.torrentId === torrentId
    );

    this.globalUploadBucket.pendingQueue = uploadFiltered;

    // Resolve removed requests
    for (const request of uploadRemoved) {
      request.resolve();
    }
  }

  /**
   * Resolve all pending requests in a bucket
   *
   * @param bucket - Bucket to clear
   */
  private resolveAllPending(bucket: TokenBucket): void {
    for (const request of bucket.pendingQueue) {
      request.resolve();
    }
    bucket.pendingQueue = [];
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default BandwidthLimiter;
