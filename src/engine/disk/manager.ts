/**
 * Disk Manager for Torm BitTorrent Client
 *
 * Coordinates disk I/O operations with piece verification:
 * - Write queue management for orderly disk writes
 * - Read caching for piece uploads
 * - Integration with PieceManager for verified pieces
 * - Initial piece verification when resuming downloads
 *
 * @module engine/disk/manager
 */

import { createHash } from 'crypto';
import { TypedEventEmitter } from '../events.js';
import { DiskError, DiskFullError } from '../types.js';
import { TorrentMetadata, getPieceHash, getActualPieceLength } from '../torrent/parser.js';
import { DiskIO, DiskIOOptions } from './io.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Events emitted by the DiskManager
 */
export interface DiskManagerEvents {
  /** Emitted when a piece is successfully written to disk */
  pieceWritten: {
    pieceIndex: number;
  };

  /** Emitted when a piece write fails */
  writeFailed: {
    pieceIndex: number;
    error: Error;
  };

  /** Emitted when a piece is verified on disk (for resume) */
  pieceVerified: {
    pieceIndex: number;
  };

  /** Emitted when a piece fails verification (for resume) */
  pieceFailed: {
    pieceIndex: number;
  };

  /** Emitted when all files are allocated */
  filesAllocated: void;

  /** Emitted when initial verification is complete */
  verificationComplete: {
    completedPieces: number[];
    progress: number;
  };

  /** Emitted periodically during verification with progress */
  verificationProgress: {
    checked: number;
    total: number;
    progress: number;
  };

  /** Emitted when a disk error occurs */
  error: {
    error: Error;
    context: string;
  };

  /** Emitted when disk is full */
  diskFull: {
    /** The error that occurred */
    error: DiskFullError;
    /** Piece index that failed to write */
    pieceIndex: number;
    /** Required space in bytes */
    requiredBytes: number;
    /** Available space in bytes (if known) */
    availableBytes?: number;
    /** Number of writes queued for retry */
    queuedForRetry: number;
  };

  /** Emitted when space becomes available after disk full */
  spaceAvailable: {
    /** Available space in bytes */
    availableBytes: number;
    /** Number of queued writes being retried */
    retryingCount: number;
  };
}

/**
 * Options for DiskManager
 */
export interface DiskManagerOptions extends DiskIOOptions {
  /** Maximum number of pieces to cache for reading (default: 8) */
  readCacheSize?: number;

  /** Maximum write queue size before blocking (default: 32) */
  maxWriteQueueSize?: number;

  /** Whether to verify existing pieces on start (default: true) */
  verifyOnStart?: boolean;

  /** Number of pieces to verify in parallel (default: 4) */
  verificationConcurrency?: number;

  /** Whether to check disk space before large writes (default: true) */
  checkSpaceBeforeWrite?: boolean;

  /** Interval in ms to check for available space when disk is full (default: 30000) */
  spaceCheckInterval?: number;

  /** Maximum number of pieces to queue for retry when disk is full (default: 64) */
  maxRetryQueueSize?: number;
}

/**
 * Write queue entry
 */
interface WriteQueueEntry {
  pieceIndex: number;
  data: Buffer;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Read cache entry
 */
interface ReadCacheEntry {
  data: Buffer;
  lastAccess: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Default read cache size (pieces) - larger cache improves upload performance */
const DEFAULT_READ_CACHE_SIZE = 16;

/** Default maximum write queue size (pieces) - larger queue reduces stalls during verification */
const DEFAULT_MAX_WRITE_QUEUE_SIZE = 64;

/** Default verification concurrency - higher values utilize modern SSDs better */
const DEFAULT_VERIFICATION_CONCURRENCY = 8;

/** Default interval to check for available space when disk is full (30 seconds) */
const DEFAULT_SPACE_CHECK_INTERVAL = 30000;

/** Default maximum retry queue size */
const DEFAULT_MAX_RETRY_QUEUE_SIZE = 64;

// =============================================================================
// DiskManager Class
// =============================================================================

/**
 * Coordinates disk I/O operations for a torrent
 *
 * The DiskManager provides a high-level interface for reading and writing
 * pieces, managing a write queue for orderly disk access, and caching
 * recently read pieces for upload performance.
 *
 * @example
 * ```typescript
 * const diskManager = new DiskManager(metadata, {
 *   downloadPath: '/downloads',
 *   verifyOnStart: true,
 * });
 *
 * // Listen for events
 * diskManager.on('pieceWritten', ({ pieceIndex }) => {
 *   console.log(`Piece ${pieceIndex} written to disk`);
 * });
 *
 * // Start the manager
 * await diskManager.start();
 *
 * // Write a verified piece
 * await diskManager.writePiece(0, pieceData);
 *
 * // Read a piece for uploading
 * const data = await diskManager.readPiece(0);
 * ```
 */
export class DiskManager extends TypedEventEmitter<DiskManagerEvents> {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** Torrent metadata */
  private readonly metadata: TorrentMetadata;

  /** Low-level disk I/O */
  private readonly diskIO: DiskIO;

  /** Read cache */
  private readonly readCache: Map<number, ReadCacheEntry>;

  /** Maximum read cache size */
  private readonly readCacheSize: number;

  /** Write queue */
  private readonly writeQueue: WriteQueueEntry[];

  /** Maximum write queue size */
  private readonly maxWriteQueueSize: number;

  /** Whether write processing is active */
  private writeProcessing: boolean;

  /** Whether to verify on start */
  private readonly verifyOnStart: boolean;

  /** Verification concurrency */
  private readonly verificationConcurrency: number;

  /** Set of completed (verified) pieces */
  private readonly completedPieces: Set<number>;

  /** Whether manager is started */
  private started: boolean;

  /** Whether manager is stopped */
  private stopped: boolean;

  /** Whether to check space before writes */
  private readonly checkSpaceBeforeWrite: boolean;

  /** Interval to check for available space when disk is full */
  private readonly spaceCheckInterval: number;

  /** Maximum retry queue size */
  private readonly maxRetryQueueSize: number;

  /** Queue of writes waiting for disk space */
  private readonly retryQueue: WriteQueueEntry[];

  /** Whether disk is currently full */
  private diskFull: boolean;

  /** Timer for checking disk space */
  private spaceCheckTimer: ReturnType<typeof setTimeout> | null;

  /** Whether the manager is paused due to disk full */
  private pausedForDiskFull: boolean;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Create a new DiskManager
   *
   * @param metadata - Parsed torrent metadata
   * @param options - Manager options
   */
  constructor(metadata: TorrentMetadata, options: DiskManagerOptions) {
    super();

    this.metadata = metadata;
    this.diskIO = new DiskIO(metadata, options);
    this.readCache = new Map();
    this.readCacheSize = options.readCacheSize ?? DEFAULT_READ_CACHE_SIZE;
    this.writeQueue = [];
    this.maxWriteQueueSize = options.maxWriteQueueSize ?? DEFAULT_MAX_WRITE_QUEUE_SIZE;
    this.writeProcessing = false;
    this.verifyOnStart = options.verifyOnStart ?? true;
    this.verificationConcurrency = options.verificationConcurrency ?? DEFAULT_VERIFICATION_CONCURRENCY;
    this.completedPieces = new Set();
    this.started = false;
    this.stopped = false;

    // Disk full handling
    this.checkSpaceBeforeWrite = options.checkSpaceBeforeWrite ?? true;
    this.spaceCheckInterval = options.spaceCheckInterval ?? DEFAULT_SPACE_CHECK_INTERVAL;
    this.maxRetryQueueSize = options.maxRetryQueueSize ?? DEFAULT_MAX_RETRY_QUEUE_SIZE;
    this.retryQueue = [];
    this.diskFull = false;
    this.spaceCheckTimer = null;
    this.pausedForDiskFull = false;
  }

  // ===========================================================================
  // Public Properties
  // ===========================================================================

  /**
   * Number of completed pieces
   */
  get completedCount(): number {
    return this.completedPieces.size;
  }

  /**
   * Download progress (0-1)
   */
  get progress(): number {
    return this.completedPieces.size / this.metadata.pieceCount;
  }

  /**
   * Total number of pieces
   */
  get pieceCount(): number {
    return this.metadata.pieceCount;
  }

  /**
   * Whether all pieces are complete
   */
  get isComplete(): boolean {
    return this.completedPieces.size === this.metadata.pieceCount;
  }

  /**
   * Current write queue length
   */
  get writeQueueLength(): number {
    return this.writeQueue.length;
  }

  /**
   * Current read cache size
   */
  get readCacheLength(): number {
    return this.readCache.size;
  }

  /**
   * Whether disk is currently full
   */
  get isDiskFull(): boolean {
    return this.diskFull;
  }

  /**
   * Number of writes queued for retry due to disk full
   */
  get retryQueueLength(): number {
    return this.retryQueue.length;
  }

  /**
   * Whether the manager is paused due to disk full
   */
  get isPausedForDiskFull(): boolean {
    return this.pausedForDiskFull;
  }

  // ===========================================================================
  // Public Methods - Lifecycle
  // ===========================================================================

  /**
   * Start the disk manager
   *
   * Allocates files and optionally verifies existing pieces.
   *
   * @returns Array of completed piece indices
   */
  async start(): Promise<number[]> {
    if (this.started) {
      return Array.from(this.completedPieces);
    }

    this.started = true;
    this.stopped = false;

    // Allocate files
    await this.diskIO.allocateFiles();
    this.emit('filesAllocated');

    // Verify existing pieces if requested
    if (this.verifyOnStart) {
      await this.verifyExistingPieces();
    }

    return Array.from(this.completedPieces);
  }

  /**
   * Stop the disk manager
   *
   * Waits for pending writes and closes file handles.
   *
   * @param skipWriteQueue - If true, don't wait for pending writes (use when deleting files)
   */
  async stop(skipWriteQueue = false): Promise<void> {
    if (this.stopped) {
      return;
    }

    // Stop space check timer
    if (this.spaceCheckTimer) {
      clearTimeout(this.spaceCheckTimer);
      this.spaceCheckTimer = null;
    }

    // Wait for write queue to drain BEFORE setting stopped
    // This allows pending writes to complete
    // Skip this when deleting - no point waiting for writes we're about to delete
    if (!skipWriteQueue) {
      await this.waitForWriteQueue();
    }

    this.stopped = true;

    // Reject any pending retry queue entries
    const diskFullError = new DiskError('DiskManager stopped while waiting for space', 'stop');
    for (const entry of this.retryQueue) {
      entry.reject(diskFullError);
    }
    this.retryQueue.length = 0;

    // Close file handles
    await this.diskIO.closeAllHandles();

    // Clear caches
    this.readCache.clear();

    // Reset disk full state
    this.diskFull = false;
    this.pausedForDiskFull = false;

    this.started = false;
  }

  // ===========================================================================
  // Public Methods - Piece Operations
  // ===========================================================================

  /**
   * Write a piece to disk
   *
   * Queues the piece for writing and returns when complete.
   * The piece should already be verified before calling this.
   *
   * @param pieceIndex - Index of the piece
   * @param data - Verified piece data
   */
  async writePiece(pieceIndex: number, data: Buffer): Promise<void> {
    if (this.stopped) {
      throw new DiskError('DiskManager is stopped', 'writePiece');
    }

    // Validate piece data length
    const expectedLength = getActualPieceLength(this.metadata, pieceIndex);
    if (data.length !== expectedLength) {
      throw new DiskError(
        `Invalid piece data length: expected ${expectedLength}, got ${data.length}`,
        `piece ${pieceIndex}`
      );
    }

    // Add to write queue
    return new Promise((resolve, reject) => {
      this.writeQueue.push({
        pieceIndex,
        data,
        resolve,
        reject,
      });

      // Start processing if not already (on next tick to allow concurrency)
      if (!this.writeProcessing) {
        setImmediate(() => this.processWriteQueue());
      }
    });
  }

  /**
   * Read a piece from disk
   *
   * Uses the read cache if available.
   *
   * @param pieceIndex - Index of the piece
   * @returns Piece data
   * @throws DiskError if piece is not complete or read fails
   */
  async readPiece(pieceIndex: number): Promise<Buffer> {
    if (this.stopped) {
      throw new DiskError('DiskManager is stopped', 'readPiece');
    }

    // Check if we have this piece
    if (!this.completedPieces.has(pieceIndex)) {
      throw new DiskError(
        `Piece ${pieceIndex} is not complete`,
        `readPiece`
      );
    }

    // Check cache
    const cached = this.readCache.get(pieceIndex);
    if (cached) {
      cached.lastAccess = Date.now();
      return cached.data;
    }

    // Read from disk
    const result = await this.diskIO.readPiece(pieceIndex);
    if (!result.complete) {
      throw new DiskError(
        `Failed to read complete piece ${pieceIndex}`,
        `readPiece`
      );
    }

    // Add to cache
    this.addToCache(pieceIndex, result.data);

    return result.data;
  }

  /**
   * Read a specific block from a piece
   *
   * More efficient than reading the entire piece when only a block is needed.
   *
   * @param pieceIndex - Index of the piece
   * @param begin - Offset within the piece
   * @param length - Number of bytes to read
   * @returns Block data
   */
  async readBlock(pieceIndex: number, begin: number, length: number): Promise<Buffer> {
    if (this.stopped) {
      throw new DiskError('DiskManager is stopped', 'readBlock');
    }

    // Check if we have this piece
    if (!this.completedPieces.has(pieceIndex)) {
      throw new DiskError(
        `Piece ${pieceIndex} is not complete`,
        `readBlock`
      );
    }

    // Check if we have the piece cached
    const cached = this.readCache.get(pieceIndex);
    if (cached) {
      cached.lastAccess = Date.now();
      return cached.data.subarray(begin, begin + length);
    }

    // Read block directly from disk
    return this.diskIO.readBlock(pieceIndex, begin, length);
  }

  /**
   * Check if a piece is complete (on disk)
   *
   * @param pieceIndex - Index of the piece
   * @returns true if piece is complete
   */
  hasPiece(pieceIndex: number): boolean {
    return this.completedPieces.has(pieceIndex);
  }

  /**
   * Get array of completed piece indices
   *
   * @returns Array of piece indices
   */
  getCompletedPieces(): number[] {
    return Array.from(this.completedPieces);
  }

  /**
   * Mark a piece as complete (for external verification)
   *
   * @param pieceIndex - Index of the piece
   */
  markPieceComplete(pieceIndex: number): void {
    this.completedPieces.add(pieceIndex);
  }

  // ===========================================================================
  // Public Methods - Verification
  // ===========================================================================

  /**
   * Verify a single piece on disk
   *
   * @param pieceIndex - Index of the piece
   * @returns true if piece is valid
   */
  async verifyPiece(pieceIndex: number): Promise<boolean> {
    const result = await this.diskIO.readPiece(pieceIndex);
    if (!result.complete) {
      return false;
    }

    const expectedHash = getPieceHash(this.metadata, pieceIndex);
    const actualHash = createHash('sha1').update(result.data).digest();

    return expectedHash.equals(actualHash);
  }

  /**
   * Verify all existing pieces on disk
   *
   * Updates completedPieces set and emits progress events.
   */
  async verifyExistingPieces(): Promise<void> {
    const total = this.metadata.pieceCount;
    let checked = 0;

    // Process pieces in batches for concurrency
    const batchSize = this.verificationConcurrency;
    const completed: number[] = [];

    for (let start = 0; start < total; start += batchSize) {
      if (this.stopped) {
        break;
      }

      const end = Math.min(start + batchSize, total);
      const batch = [];

      for (let i = start; i < end; i++) {
        batch.push(this.verifyPieceWithTracking(i));
      }

      const results = await Promise.all(batch);

      for (let i = 0; i < results.length; i++) {
        const pieceIndex = start + i;
        if (results[i]) {
          this.completedPieces.add(pieceIndex);
          completed.push(pieceIndex);
          this.emit('pieceVerified', { pieceIndex });
        } else {
          this.emit('pieceFailed', { pieceIndex });
        }
      }

      checked += batch.length;

      this.emit('verificationProgress', {
        checked,
        total,
        progress: checked / total,
      });
    }

    this.emit('verificationComplete', {
      completedPieces: completed,
      progress: this.progress,
    });
  }

  // ===========================================================================
  // Public Methods - File Management
  // ===========================================================================

  /**
   * Delete all torrent files
   *
   * @param deleteDirectories - Whether to delete empty parent directories
   */
  async deleteFiles(deleteDirectories = false): Promise<void> {
    // Skip waiting for write queue - we're deleting the files anyway
    await this.stop(true);
    await this.diskIO.deleteFiles(deleteDirectories);
    this.completedPieces.clear();
  }

  /**
   * Get total bytes written to disk
   *
   * @returns Total bytes allocated
   */
  async getTotalAllocatedBytes(): Promise<number> {
    return this.diskIO.getTotalAllocatedBytes();
  }

  /**
   * Get the file path for a file
   *
   * @param fileIndex - Index of the file
   * @returns Absolute file path
   */
  getFilePath(fileIndex: number): string {
    if (fileIndex < 0 || fileIndex >= this.metadata.files.length) {
      throw new Error(`Invalid file index: ${fileIndex}`);
    }
    return this.diskIO.getFilePath(this.metadata.files[fileIndex]);
  }

  /**
   * Get the torrent root path
   *
   * @returns Absolute path
   */
  getTorrentPath(): string {
    return this.diskIO.getTorrentPath();
  }

  // ===========================================================================
  // Public Methods - Space Management
  // ===========================================================================

  /**
   * Get available disk space on the download path
   *
   * @returns Available space in bytes
   */
  async getAvailableSpace(): Promise<number> {
    return this.diskIO.getAvailableSpace();
  }

  /**
   * Get the total space required for this torrent
   *
   * @returns Required space in bytes
   */
  getRequiredSpace(): number {
    return this.metadata.totalLength;
  }

  /**
   * Get the remaining space required for this torrent
   *
   * This accounts for already downloaded pieces.
   *
   * @returns Remaining required space in bytes
   */
  getRemainingRequiredSpace(): number {
    const completedBytes = this.completedPieces.size * this.metadata.pieceLength;
    const remaining = this.metadata.totalLength - completedBytes;
    return Math.max(0, remaining);
  }

  /**
   * Check if there is enough available space for this torrent
   *
   * @returns true if enough space is available
   */
  async checkAvailableSpace(): Promise<boolean> {
    return this.diskIO.checkAvailableSpace(this.getRemainingRequiredSpace());
  }

  /**
   * Check if there is enough available space for a specific number of bytes
   *
   * @param requiredBytes - Number of bytes required
   * @returns true if enough space is available
   */
  async checkAvailableSpaceFor(requiredBytes: number): Promise<boolean> {
    return this.diskIO.checkAvailableSpace(requiredBytes);
  }

  /**
   * Manually trigger a retry of queued writes
   *
   * Call this when the user has freed up disk space.
   */
  async retryQueuedWrites(): Promise<void> {
    if (this.retryQueue.length === 0) {
      return;
    }

    // Force an immediate space check and retry
    this.stopSpaceChecking();
    await this.checkSpaceAndRetry();
  }

  // ===========================================================================
  // Private Methods - Write Queue
  // ===========================================================================

  /**
   * Process the write queue
   */
  private async processWriteQueue(): Promise<void> {
    if (this.writeProcessing) {
      return;
    }

    this.writeProcessing = true;

    try {
      while (this.writeQueue.length > 0 && !this.stopped && !this.diskFull) {
        const entry = this.writeQueue.shift()!;

        try {
          await this.diskIO.writePiece(entry.pieceIndex, entry.data);

          // Mark as complete
          this.completedPieces.add(entry.pieceIndex);

          // Add to cache
          this.addToCache(entry.pieceIndex, entry.data);

          // Emit event
          this.emit('pieceWritten', { pieceIndex: entry.pieceIndex });

          entry.resolve();
        } catch (err) {
          // Check if this is a disk full error
          if (err instanceof DiskFullError) {
            await this.handleDiskFull(entry, err);
            // Don't reject yet - the entry is queued for retry
            continue;
          }

          const error = err as Error;
          this.emit('writeFailed', {
            pieceIndex: entry.pieceIndex,
            error,
          });
          this.emit('error', {
            error,
            context: `writing piece ${entry.pieceIndex}`,
          });
          entry.reject(error);
        }
      }
    } finally {
      this.writeProcessing = false;
    }
  }

  /**
   * Wait for write queue to drain
   */
  private async waitForWriteQueue(): Promise<void> {
    while (this.writeQueue.length > 0 || this.writeProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  // ===========================================================================
  // Private Methods - Read Cache
  // ===========================================================================

  /**
   * Add a piece to the read cache
   */
  private addToCache(pieceIndex: number, data: Buffer): void {
    // Evict oldest entries if cache is full
    while (this.readCache.size >= this.readCacheSize) {
      this.evictOldestCacheEntry();
    }

    this.readCache.set(pieceIndex, {
      data,
      lastAccess: Date.now(),
    });
  }

  /**
   * Evict the oldest cache entry
   */
  private evictOldestCacheEntry(): void {
    let oldestKey: number | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.readCache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.readCache.delete(oldestKey);
    }
  }

  /**
   * Clear the read cache
   */
  clearCache(): void {
    this.readCache.clear();
  }

  // ===========================================================================
  // Private Methods - Disk Full Handling
  // ===========================================================================

  /**
   * Handle a disk full error
   */
  private async handleDiskFull(entry: WriteQueueEntry, error: DiskFullError): Promise<void> {
    this.diskFull = true;
    this.pausedForDiskFull = true;

    // Add to retry queue if there's room
    if (this.retryQueue.length < this.maxRetryQueueSize) {
      this.retryQueue.push(entry);
    } else {
      // Reject if retry queue is full
      entry.reject(error);
      this.emit('writeFailed', {
        pieceIndex: entry.pieceIndex,
        error,
      });
    }

    // Move remaining write queue to retry queue
    while (this.writeQueue.length > 0 && this.retryQueue.length < this.maxRetryQueueSize) {
      const nextEntry = this.writeQueue.shift()!;
      this.retryQueue.push(nextEntry);
    }

    // Reject any remaining entries that don't fit
    while (this.writeQueue.length > 0) {
      const nextEntry = this.writeQueue.shift()!;
      nextEntry.reject(error);
      this.emit('writeFailed', {
        pieceIndex: nextEntry.pieceIndex,
        error,
      });
    }

    // Emit disk full event
    this.emit('diskFull', {
      error,
      pieceIndex: entry.pieceIndex,
      requiredBytes: error.requiredBytes,
      availableBytes: error.availableBytes,
      queuedForRetry: this.retryQueue.length,
    });

    // Start periodic space checking
    this.startSpaceChecking();
  }

  /**
   * Start checking for available space periodically
   */
  private startSpaceChecking(): void {
    if (this.spaceCheckTimer) {
      return; // Already checking
    }

    this.spaceCheckTimer = setTimeout(() => this.checkSpaceAndRetry(), this.spaceCheckInterval);
  }

  /**
   * Stop checking for available space
   */
  private stopSpaceChecking(): void {
    if (this.spaceCheckTimer) {
      clearTimeout(this.spaceCheckTimer);
      this.spaceCheckTimer = null;
    }
  }

  /**
   * Check for available space and retry queued writes if space is available
   */
  private async checkSpaceAndRetry(): Promise<void> {
    this.spaceCheckTimer = null;

    if (this.stopped || this.retryQueue.length === 0) {
      this.diskFull = false;
      this.pausedForDiskFull = false;
      return;
    }

    try {
      const availableBytes = await this.diskIO.getAvailableSpace();

      // Estimate required space (use piece length as minimum)
      const requiredBytes = this.metadata.pieceLength;

      if (availableBytes >= requiredBytes) {
        // Space available! Resume writes
        this.diskFull = false;
        this.pausedForDiskFull = false;

        // Emit space available event
        this.emit('spaceAvailable', {
          availableBytes,
          retryingCount: this.retryQueue.length,
        });

        // Move retry queue back to write queue
        while (this.retryQueue.length > 0) {
          const entry = this.retryQueue.shift()!;
          this.writeQueue.push(entry);
        }

        // Resume processing
        if (!this.writeProcessing) {
          setImmediate(() => this.processWriteQueue());
        }
      } else {
        // Still not enough space, check again later
        this.spaceCheckTimer = setTimeout(() => this.checkSpaceAndRetry(), this.spaceCheckInterval);
      }
    } catch {
      // Error checking space, try again later
      this.spaceCheckTimer = setTimeout(() => this.checkSpaceAndRetry(), this.spaceCheckInterval);
    }
  }

  // ===========================================================================
  // Private Methods - Verification
  // ===========================================================================

  /**
   * Verify a piece with error handling
   */
  private async verifyPieceWithTracking(pieceIndex: number): Promise<boolean> {
    try {
      return await this.verifyPiece(pieceIndex);
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  DEFAULT_READ_CACHE_SIZE,
  DEFAULT_MAX_WRITE_QUEUE_SIZE,
  DEFAULT_VERIFICATION_CONCURRENCY,
  DEFAULT_SPACE_CHECK_INTERVAL,
  DEFAULT_MAX_RETRY_QUEUE_SIZE,
};
