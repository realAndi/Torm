/**
 * Session Manager for Torm Engine
 *
 * Manages multiple TorrentSession instances, enforcing global connection limits,
 * queue management, bandwidth limiting, and aggregate statistics.
 *
 * @module engine/session/manager
 */

import { TypedEventEmitter } from '../events.js';
import {
  EngineConfig,
  EngineStats,
  TorrentState,
  AddTorrentOptions,
  TormError,
} from '../types.js';
import { DEFAULT_CONFIG, mergeWithDefaults } from '../config/defaults.js';
import { BandwidthLimiter } from './bandwidth.js';
import { TorrentSession as TorrentSessionFull, TorrentSessionOptions } from './session.js';
import { TorrentMetadata, parseTorrent } from '../torrent/parser.js';
import { PeerManager, PeerManagerOptions } from '../peer/manager.js';
import { TrackerClient, TrackerClientOptions, TrackerInfo } from '../tracker/client.js';
import { readFile, rm } from 'fs/promises';
import { randomBytes } from 'crypto';
import { join, dirname } from 'path';

// =============================================================================
// Constants
// =============================================================================

/** Interval for updating aggregate statistics in milliseconds */
const STATS_UPDATE_INTERVAL = 1000;

/** Default maximum number of active torrents */
const DEFAULT_MAX_ACTIVE_TORRENTS = 5;

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Options for configuring the SessionManager
 */
export interface SessionManagerOptions extends Partial<EngineConfig> {
  /** Maximum number of torrents that can be active (downloading/seeding) simultaneously */
  maxActiveTorrents?: number;

  /** Our 20-byte peer ID (auto-generated if not provided) */
  peerId?: Buffer;
}

/**
 * Events emitted by the SessionManager
 */
export interface SessionManagerEvents {
  /** Emitted when a torrent session is added */
  torrentAdded: { session: TorrentSession };

  /** Emitted when a torrent session is removed */
  torrentRemoved: { infoHash: string };

  /** Emitted when a torrent's state changes */
  torrentStateChanged: { infoHash: string; state: TorrentState };

  /** Emitted when torrent progress updates */
  torrentProgress: {
    infoHash: string;
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    downloaded: number;
    uploaded: number;
    peers: number;
  };

  /** Emitted when aggregate statistics are updated */
  statsUpdated: { stats: EngineStats };

  /** Emitted when an error occurs */
  error: { error: Error };

  /** Emitted when a piece is completed */
  pieceComplete: { infoHash: string; pieceIndex: number };
}

/**
 * Represents a single torrent session
 *
 * This interface defines the contract for individual torrent sessions
 * that are managed by the SessionManager.
 */
export interface TorrentSession {
  /** Unique identifier (info hash hex string) */
  readonly infoHash: string;

  /** Torrent name */
  readonly name: string;

  /** Current state of the torrent */
  state: TorrentState;

  /** Torrent metadata */
  readonly metadata: TorrentMetadata;

  /** Download progress (0-1) */
  progress: number;

  /** Current download speed in bytes/second */
  downloadSpeed: number;

  /** Current upload speed in bytes/second */
  uploadSpeed: number;

  /** Total bytes downloaded */
  downloaded: number;

  /** Total bytes uploaded */
  uploaded: number;

  /** Total size in bytes */
  readonly totalSize: number;

  /** Number of connected peers */
  readonly peers: number;

  /** Number of connected seeds */
  readonly seeds: number;

  /** Timestamp when the torrent was added */
  readonly addedAt: Date;

  /** Timestamp when the torrent completed, or undefined */
  completedAt?: Date;

  /** Error message if state is ERROR */
  error?: string;

  /** Download path for this torrent */
  downloadPath: string;

  /** List of trackers for this torrent */
  readonly trackers: TrackerInfo[];

  /** Start downloading/seeding */
  start(): Promise<void>;

  /** Pause the torrent */
  pause(): Promise<void>;

  /** Stop and cleanup */
  stop(): Promise<void>;

  /** Verify downloaded data */
  verify(): Promise<void>;

  /** Subscribe to session events */
  on(event: string, listener: (...args: unknown[]) => void): void;

  /** Unsubscribe from session events */
  off(event: string, listener: (...args: unknown[]) => void): void;

  /** Get connected peers for this torrent */
  getConnectedPeers(): import('../types.js').Peer[];

  /** Delete downloaded files for this torrent */
  deleteFiles(): Promise<void>;
}

/**
 * Internal representation of a managed torrent
 */
interface ManagedTorrent {
  session: TorrentSession;
  stateListener: (state: TorrentState) => void;
  completedListener: () => void;
  errorListener: (error: Error) => void;
  progressListener: (data: {
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    downloaded: number;
    uploaded: number;
  }) => void;
  pieceCompleteListener: (data: { pieceIndex: number }) => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a peer ID following Azureus style
 *
 * Format: -TR3000-xxxxxxxxxxxx
 * Where TR = Torm, 3000 = version, x = random bytes
 *
 * @returns 20-byte peer ID Buffer
 */
function generatePeerId(): Buffer {
  const prefix = Buffer.from('-TR0100-', 'ascii'); // Torm version 0.1.0.0
  const suffix = randomBytes(12);
  return Buffer.concat([prefix, suffix]);
}

/**
 * Check if a torrent is in an active state (downloading or seeding)
 *
 * @param state - Torrent state
 * @returns True if active
 */
function isActiveState(state: TorrentState): boolean {
  return state === TorrentState.DOWNLOADING || state === TorrentState.SEEDING;
}

/**
 * Check if a torrent can be started
 *
 * @param state - Torrent state
 * @returns True if the torrent can transition to active
 */
function canStart(state: TorrentState): boolean {
  return (
    state === TorrentState.QUEUED ||
    state === TorrentState.PAUSED ||
    state === TorrentState.ERROR
  );
}

// =============================================================================
// TorrentSessionImpl Class
// =============================================================================

/**
 * Basic implementation of TorrentSession interface
 *
 * This provides a minimal implementation that can be extended or replaced
 * by a full-featured TorrentSession class.
 */
class TorrentSessionImpl implements TorrentSession {
  readonly infoHash: string;
  readonly name: string;
  readonly metadata: TorrentMetadata;
  readonly totalSize: number;
  readonly addedAt: Date;

  state: TorrentState;
  progress: number = 0;
  downloadSpeed: number = 0;
  uploadSpeed: number = 0;
  downloaded: number = 0;
  uploaded: number = 0;
  peers: number = 0;
  seeds: number = 0;
  completedAt?: Date;
  error?: string;
  downloadPath: string;

  get trackers(): TrackerInfo[] {
    return this.trackerClient.getTrackerInfo(this.infoHash);
  }

  private readonly events: TypedEventEmitter<{
    stateChanged: TorrentState;
    completed: void;
    error: Error;
    progress: { progress: number; downloadSpeed: number; uploadSpeed: number };
  }>;

  private readonly peerManager: PeerManager;
  private readonly trackerClient: TrackerClient;
  private readonly bandwidthLimiter: BandwidthLimiter;

  constructor(
    metadata: TorrentMetadata,
    downloadPath: string,
    peerManager: PeerManager,
    trackerClient: TrackerClient,
    bandwidthLimiter: BandwidthLimiter,
    startImmediately: boolean = false
  ) {
    this.events = new TypedEventEmitter();
    this.metadata = metadata;
    this.infoHash = metadata.infoHashHex;
    this.name = metadata.name;
    this.totalSize = metadata.totalLength;
    this.downloadPath = downloadPath;
    this.addedAt = new Date();
    this.state = startImmediately ? TorrentState.CHECKING : TorrentState.QUEUED;

    this.peerManager = peerManager;
    this.trackerClient = trackerClient;
    this.bandwidthLimiter = bandwidthLimiter;
  }

  async start(): Promise<void> {
    if (!canStart(this.state)) {
      throw new TormError(`Cannot start torrent in state: ${this.state}`);
    }

    const previousState = this.state;
    this.state = TorrentState.CHECKING;
    this.emitStateChange(previousState);

    // Transition to downloading
    this.state = TorrentState.DOWNLOADING;
    this.emitStateChange(TorrentState.CHECKING);

    // Register with tracker client
    const trackers = this.metadata.announceList ?? [[this.metadata.announce]];

    this.trackerClient.addTorrent({
      infoHash: this.metadata.infoHash,
      downloaded: this.downloaded,
      uploaded: this.uploaded,
      left: this.metadata.totalLength - this.downloaded,
      trackers: trackers,
    });

    // Announce to trackers (fire and forget - don't block)
    this.trackerClient.announce(this.infoHash, 'started').catch(() => {
      // Errors handled by tracker client events
    });
  }

  async pause(): Promise<void> {
    if (this.state === TorrentState.PAUSED) {
      return;
    }

    if (!isActiveState(this.state) && this.state !== TorrentState.CHECKING) {
      throw new TormError(`Cannot pause torrent in state: ${this.state}`);
    }

    const previousState = this.state;
    this.state = TorrentState.PAUSED;
    this.emitStateChange(previousState);

    // Disconnect peers for this torrent
    this.peerManager.disconnectAllPeers(this.infoHash);
  }

  async stop(): Promise<void> {
    const previousState = this.state;

    // Disconnect all peers
    this.peerManager.disconnectAllPeers(this.infoHash);

    // Remove from tracker
    this.trackerClient.removeTorrent(this.infoHash);

    // Remove from bandwidth limiter
    this.bandwidthLimiter.removeTorrent(this.infoHash);

    this.state = TorrentState.PAUSED;
    if (previousState !== TorrentState.PAUSED) {
      this.emitStateChange(previousState);
    }
  }

  async verify(): Promise<void> {
    const previousState = this.state;
    this.state = TorrentState.CHECKING;
    this.emitStateChange(previousState);

    // TODO: Implement piece verification
    // - Read existing files
    // - Hash each piece
    // - Update piece availability

    // For now, just mark as verified and transition back
    if (this.progress >= 1) {
      this.state = TorrentState.SEEDING;
    } else if (this.progress > 0) {
      this.state = TorrentState.DOWNLOADING;
    } else {
      this.state = TorrentState.QUEUED;
    }
    this.emitStateChange(TorrentState.CHECKING);
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    (this.events as unknown as { on: (e: string, l: (...args: unknown[]) => void) => void }).on(
      event,
      listener
    );
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    (this.events as unknown as { off: (e: string, l: (...args: unknown[]) => void) => void }).off(
      event,
      listener
    );
  }

  /**
   * Get connected peers for this torrent
   */
  getConnectedPeers(): import('../types.js').Peer[] {
    return this.peerManager.getPeers(this.infoHash);
  }

  /**
   * Delete downloaded files for this torrent
   */
  async deleteFiles(): Promise<void> {
    const files = this.metadata.files;

    // Multi-file torrent: delete the entire directory at once (fastest)
    if (files.length > 1 || (files.length === 1 && files[0].path.includes('/'))) {
      const torrentDir = join(this.downloadPath, this.metadata.name);
      await rm(torrentDir, { recursive: true, force: true });
      return;
    }

    // Single file: use Bun's native file deletion
    const filePath = join(this.downloadPath, files[0].path);
    await Bun.file(filePath).delete();
  }

  /**
   * Mark torrent as completed
   */
  complete(): void {
    if (this.state !== TorrentState.DOWNLOADING) {
      return;
    }

    const previousState = this.state;
    this.state = TorrentState.SEEDING;
    this.progress = 1;
    this.completedAt = new Date();
    this.emitStateChange(previousState);
    this.events.emit('completed');
  }

  /**
   * Mark torrent as errored
   *
   * @param errorMessage - Error description
   */
  setError(errorMessage: string): void {
    const previousState = this.state;
    this.state = TorrentState.ERROR;
    this.error = errorMessage;
    this.emitStateChange(previousState);
    this.events.emit('error', new Error(errorMessage));
  }

  /**
   * Update state to queued
   */
  queue(): void {
    if (this.state === TorrentState.QUEUED) {
      return;
    }

    const previousState = this.state;
    this.state = TorrentState.QUEUED;
    this.emitStateChange(previousState);
  }

  private emitStateChange(previousState: TorrentState): void {
    if (previousState !== this.state) {
      this.events.emit('stateChanged', this.state);
    }
  }
}

// =============================================================================
// SessionManager Class
// =============================================================================

/**
 * Session Manager
 *
 * Central manager for all torrent sessions in the engine. Provides:
 * - Multi-torrent management with unified interface
 * - Global connection limits across all sessions
 * - Queue management for respecting maxActiveTorrents
 * - Aggregate statistics across all torrents
 * - Shared PeerManager and TrackerClient for all sessions
 * - Global bandwidth limiting via BandwidthLimiter
 *
 * @example
 * ```typescript
 * const manager = new SessionManager({
 *   downloadPath: '~/Downloads',
 *   maxConnections: 100,
 *   maxActiveTorrents: 5,
 * });
 *
 * await manager.start();
 *
 * manager.on('torrentAdded', ({ session }) => {
 *   console.log(`Added: ${session.name}`);
 * });
 *
 * manager.on('statsUpdated', ({ stats }) => {
 *   console.log(`Speed: ${stats.totalDownloadSpeed} B/s`);
 * });
 *
 * const session = await manager.addTorrent('/path/to/file.torrent');
 * console.log(`Downloading: ${session.name}`);
 *
 * await manager.stop();
 * ```
 */
export class SessionManager extends TypedEventEmitter<SessionManagerEvents> {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** Engine configuration */
  private readonly config: EngineConfig;

  /** Maximum number of active torrents */
  private readonly maxActiveTorrents: number;

  /** Our peer ID */
  private readonly peerId: Buffer;

  /** Map of info hash to managed torrent */
  private readonly torrents: Map<string, ManagedTorrent> = new Map();

  /** Queue of torrents waiting to become active */
  private readonly queue: string[] = [];

  /** Shared peer manager for all sessions */
  private peerManager: PeerManager | null = null;

  /** Shared tracker client for all sessions */
  private trackerClient: TrackerClient | null = null;

  /** Global bandwidth limiter */
  private bandwidthLimiter: BandwidthLimiter | null = null;

  /** Timer for updating statistics */
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether the manager is running */
  private running: boolean = false;

  /** Cached aggregate statistics */
  private cachedStats: EngineStats = {
    totalDownloadSpeed: 0,
    totalUploadSpeed: 0,
    activeTorrents: 0,
    totalPeers: 0,
    sessionDownloaded: 0,
    sessionUploaded: 0,
  };

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Create a new SessionManager
   *
   * @param options - Manager configuration options
   */
  constructor(options?: SessionManagerOptions) {
    super();

    this.config = mergeWithDefaults(options);
    this.maxActiveTorrents = options?.maxActiveTorrents ?? DEFAULT_MAX_ACTIVE_TORRENTS;
    this.peerId = options?.peerId ?? generatePeerId();
  }

  // ===========================================================================
  // Public Properties
  // ===========================================================================

  /**
   * Number of currently active (downloading/seeding) torrents
   */
  get activeTorrents(): number {
    let count = 0;
    for (const { session } of this.torrents.values()) {
      if (isActiveState(session.state)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Total number of connected peers across all torrents
   */
  get totalPeers(): number {
    return this.peerManager?.getTotalPeerCount() ?? 0;
  }

  /**
   * Total download speed across all torrents in bytes/second
   */
  get totalDownloadSpeed(): number {
    let total = 0;
    for (const { session } of this.torrents.values()) {
      total += session.downloadSpeed;
    }
    return total;
  }

  /**
   * Total upload speed across all torrents in bytes/second
   */
  get totalUploadSpeed(): number {
    let total = 0;
    for (const { session } of this.torrents.values()) {
      total += session.uploadSpeed;
    }
    return total;
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Start the session manager
   *
   * Initializes shared resources (PeerManager, TrackerClient, BandwidthLimiter)
   * and begins statistics updates.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new TormError('SessionManager is already running');
    }

    // Initialize bandwidth limiter
    this.bandwidthLimiter = new BandwidthLimiter({
      downloadRate: this.config.maxDownloadSpeed,
      uploadRate: this.config.maxUploadSpeed,
    });

    // Initialize peer manager
    const peerManagerOptions: PeerManagerOptions = {
      peerId: this.peerId,
      maxConnections: this.config.maxConnections,
      maxConnectionsPerTorrent: this.config.maxConnectionsPerTorrent,
    };
    this.peerManager = new PeerManager(peerManagerOptions);

    // Initialize tracker client
    const trackerClientOptions: TrackerClientOptions = {
      peerId: this.peerId,
      port: this.config.port,
    };
    this.trackerClient = new TrackerClient(trackerClientOptions);

    // Set up tracker event forwarding
    this.setupTrackerEvents();

    // Set up peer event forwarding
    this.setupPeerEvents();

    // Start statistics update timer
    this.statsTimer = setInterval(() => {
      this.updateStats();
    }, STATS_UPDATE_INTERVAL);

    this.running = true;
  }

  /**
   * Stop the session manager
   *
   * Stops all torrents, cleans up resources, and disconnects all peers.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      throw new TormError('SessionManager is not running');
    }

    // Stop statistics timer
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    // Stop all torrent sessions
    const stopPromises: Promise<void>[] = [];
    for (const { session } of this.torrents.values()) {
      stopPromises.push(session.stop().catch(() => {}));
    }
    await Promise.allSettled(stopPromises);

    // Stop tracker client
    if (this.trackerClient) {
      await this.trackerClient.stop();
      this.trackerClient = null;
    }

    // Stop peer manager
    if (this.peerManager) {
      await this.peerManager.stop();
      this.peerManager = null;
    }

    // Stop bandwidth limiter
    if (this.bandwidthLimiter) {
      this.bandwidthLimiter.stop();
      this.bandwidthLimiter = null;
    }

    // Clear all state
    this.torrents.clear();
    this.queue.length = 0;

    this.running = false;
  }

  // ===========================================================================
  // Torrent Management Methods
  // ===========================================================================

  /**
   * Add a torrent to the manager
   *
   * @param source - TorrentMetadata, Buffer of .torrent file, or path to .torrent file
   * @param options - Optional settings for this torrent
   * @returns The created TorrentSession
   */
  async addTorrent(
    source: TorrentMetadata | Buffer | string,
    options?: AddTorrentOptions
  ): Promise<TorrentSession> {
    if (!this.running) {
      throw new TormError('SessionManager is not running');
    }

    // Parse metadata from source
    let metadata: TorrentMetadata;

    if (typeof source === 'string') {
      // Check if it's a magnet URI or file path
      if (source.startsWith('magnet:')) {
        throw new TormError('Magnet URI support not yet implemented');
      }
      // Assume it's a file path
      const fileData = await readFile(source);
      metadata = parseTorrent(fileData);
    } else if (Buffer.isBuffer(source)) {
      metadata = parseTorrent(source);
    } else {
      metadata = source;
    }

    // Check if torrent already exists
    if (this.torrents.has(metadata.infoHashHex)) {
      throw new TormError(`Torrent already exists: ${metadata.infoHashHex}`);
    }

    // Determine download path
    const downloadPath = options?.downloadPath ?? this.config.downloadPath;

    // Determine if we should start immediately
    const startImmediately = options?.startImmediately ?? this.config.startOnAdd;

    // Create session options
    const sessionOptions: TorrentSessionOptions = {
      downloadPath,
      maxConnections: this.config.maxConnectionsPerTorrent,
      startPaused: !startImmediately,
    };

    // Create the session using the full implementation
    const session = new TorrentSessionFull(
      metadata,
      this.peerManager!,
      this.trackerClient!,
      sessionOptions
    );

    // Set up event listeners
    const stateListener = (state: TorrentState) => {
      this.handleStateChange(session.infoHash, state);
    };

    const completedListener = () => {
      this.handleTorrentCompleted(session.infoHash);
    };

    const errorListener = (error: Error) => {
      this.emit('error', { error });
    };

    const progressListener = (data: {
      progress: number;
      downloadSpeed: number;
      uploadSpeed: number;
      downloaded: number;
      uploaded: number;
    }) => {
      this.emit('torrentProgress', {
        infoHash: session.infoHash,
        progress: data.progress,
        downloadSpeed: data.downloadSpeed,
        uploadSpeed: data.uploadSpeed,
        downloaded: data.downloaded,
        uploaded: data.uploaded,
        peers: session.peers,
      });
    };

    const pieceCompleteListener = (data: { pieceIndex: number }) => {
      this.emit('pieceComplete', {
        infoHash: session.infoHash,
        pieceIndex: data.pieceIndex,
      });
    };

    session.on('stateChanged', stateListener as (...args: unknown[]) => void);
    session.on('completed', completedListener as (...args: unknown[]) => void);
    session.on('error', errorListener as (...args: unknown[]) => void);
    session.on('progress', progressListener as (...args: unknown[]) => void);
    session.on('pieceComplete', pieceCompleteListener as (...args: unknown[]) => void);

    // Store the managed torrent
    const managedTorrent: ManagedTorrent = {
      session,
      stateListener,
      completedListener,
      errorListener,
      progressListener,
      pieceCompleteListener,
    };
    this.torrents.set(metadata.infoHashHex, managedTorrent);

    // Note: Tracker registration is handled by TorrentSession.start()

    // Emit event
    this.emit('torrentAdded', { session });

    // Start if requested and under active limit (don't await - let UI update immediately)
    if (startImmediately) {
      if (this.activeTorrents < this.maxActiveTorrents) {
        // Fire and forget - don't block on start
        session.start().catch((err) => {
          this.emit('error', { error: err instanceof Error ? err : new Error(String(err)) });
        });
      } else {
        // Queue the torrent
        this.queue.push(metadata.infoHashHex);
        (session as TorrentSessionImpl).queue();
      }
    }

    return session;
  }

  /**
   * Remove a torrent from the manager
   *
   * @param infoHash - Info hash of the torrent to remove
   * @param deleteFiles - Whether to delete downloaded files (default: false)
   */
  async removeTorrent(infoHash: string, deleteFiles: boolean = false): Promise<void> {
    if (!this.running) {
      throw new TormError('SessionManager is not running');
    }

    const managedTorrent = this.torrents.get(infoHash);
    if (!managedTorrent) {
      throw new TormError(`Torrent not found: ${infoHash}`);
    }

    const { session, stateListener, completedListener, errorListener } = managedTorrent;

    // Remove from map FIRST to prevent race condition with getAllTorrents() polling
    // during the async operations below (stop/deleteFiles)
    this.torrents.delete(infoHash);

    // Remove from queue if queued
    const queueIndex = this.queue.indexOf(infoHash);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    // Remove event listeners
    session.off('stateChanged', stateListener as (...args: unknown[]) => void);
    session.off('completed', completedListener as (...args: unknown[]) => void);
    session.off('error', errorListener as (...args: unknown[]) => void);

    // Delete files FIRST if requested (this is what the user cares about being fast)
    // deleteFiles() internally stops the disk manager before deleting
    if (deleteFiles) {
      try {
        await session.deleteFiles();
      } catch (err) {
        console.error(`Failed to delete files for ${infoHash}:`, (err as Error).message);
      }
    }

    // Stop the session in background - don't await the slow tracker announce
    // The disk manager stop is idempotent so it's fine if deleteFiles already stopped it
    session.stop().catch((err) => {
      console.error(`Failed to stop session for ${infoHash}:`, (err as Error).message);
    });

    // Emit event
    this.emit('torrentRemoved', { infoHash });

    // Start next queued torrent if available
    this.processQueue();
  }

  /**
   * Start a torrent
   *
   * @param infoHash - Info hash of the torrent to start
   */
  async startTorrent(infoHash: string): Promise<void> {
    if (!this.running) {
      throw new TormError('SessionManager is not running');
    }

    const managedTorrent = this.torrents.get(infoHash);
    if (!managedTorrent) {
      throw new TormError(`Torrent not found: ${infoHash}`);
    }

    const { session } = managedTorrent;

    // Check if we're under the active limit
    if (this.activeTorrents >= this.maxActiveTorrents && !isActiveState(session.state)) {
      // Add to queue instead
      if (!this.queue.includes(infoHash)) {
        this.queue.push(infoHash);
      }
      (session as TorrentSessionImpl).queue();
      return;
    }

    // Remove from queue if present
    const queueIndex = this.queue.indexOf(infoHash);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    await session.start();
  }

  /**
   * Pause a torrent
   *
   * @param infoHash - Info hash of the torrent to pause
   */
  async pauseTorrent(infoHash: string): Promise<void> {
    if (!this.running) {
      throw new TormError('SessionManager is not running');
    }

    const managedTorrent = this.torrents.get(infoHash);
    if (!managedTorrent) {
      throw new TormError(`Torrent not found: ${infoHash}`);
    }

    await managedTorrent.session.pause();

    // Remove from queue if present
    const queueIndex = this.queue.indexOf(infoHash);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    // Start next queued torrent
    this.processQueue();
  }

  /**
   * Get a torrent session by info hash
   *
   * @param infoHash - Info hash of the torrent
   * @returns The TorrentSession or undefined if not found
   */
  getTorrent(infoHash: string): TorrentSession | undefined {
    return this.torrents.get(infoHash)?.session;
  }

  /**
   * Get all torrent sessions
   *
   * @returns Array of all TorrentSession instances
   */
  getAllTorrents(): TorrentSession[] {
    return Array.from(this.torrents.values()).map(({ session }) => session);
  }

  /**
   * Get aggregate statistics
   *
   * @returns Current EngineStats
   */
  getStats(): EngineStats {
    return { ...this.cachedStats };
  }

  /**
   * Update configuration options
   *
   * Updates the session manager configuration. Some changes take effect
   * immediately (like bandwidth limits), while others may only apply
   * to new torrents (like connection limits which require restart).
   *
   * @param config - Partial configuration to update
   */
  async updateConfig(config: Partial<EngineConfig>): Promise<void> {
    // Update internal config
    Object.assign(this.config, config);

    // Update bandwidth limiter if limits changed
    if (this.bandwidthLimiter) {
      if (config.maxDownloadSpeed !== undefined || config.maxUploadSpeed !== undefined) {
        this.bandwidthLimiter.setGlobalLimits(
          config.maxDownloadSpeed ?? this.config.maxDownloadSpeed,
          config.maxUploadSpeed ?? this.config.maxUploadSpeed
        );
      }
    }

    // Note: Connection limits (maxConnections, maxConnectionsPerTorrent) are set at construction
    // and require a restart to change. The new values will be used on next start().
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Set up tracker client event forwarding
   */
  private setupTrackerEvents(): void {
    if (!this.trackerClient) return;

    this.trackerClient.on('announce', ({ infoHash, peers }) => {
      // Add discovered peers to the peer manager
      const managedTorrent = this.torrents.get(infoHash);
      if (managedTorrent && this.peerManager) {
        this.peerManager.addPeers(
          infoHash,
          managedTorrent.session.metadata.infoHash,
          peers
        );
      }
    });

    this.trackerClient.on('error', ({ error }) => {
      this.emit('error', { error });
    });
  }

  /**
   * Set up peer manager event forwarding
   */
  private setupPeerEvents(): void {
    if (!this.peerManager) return;

    // Note: peer count is managed by the full TorrentSession via its getter
    // No need to manually update peers here

    this.peerManager.on('peerError', ({ error }) => {
      this.emit('error', { error });
    });
  }

  /**
   * Handle state change for a torrent
   *
   * @param infoHash - Info hash of the torrent
   * @param state - New state
   */
  private handleStateChange(infoHash: string, state: TorrentState): void {
    this.emit('torrentStateChanged', { infoHash, state });

    // If a torrent became inactive, try to start a queued one
    if (state === TorrentState.PAUSED || state === TorrentState.ERROR) {
      this.processQueue();
    }
  }

  /**
   * Handle torrent completion
   *
   * @param infoHash - Info hash of the completed torrent
   */
  private handleTorrentCompleted(infoHash: string): void {
    // The torrent is now seeding, which is still "active"
    // So we don't need to process the queue
    // But we might want to emit an event or update stats
    this.updateStats();
  }

  /**
   * Process the queue to start waiting torrents
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.activeTorrents < this.maxActiveTorrents) {
      const infoHash = this.queue.shift()!;
      const managedTorrent = this.torrents.get(infoHash);

      if (managedTorrent && canStart(managedTorrent.session.state)) {
        // Start the torrent (don't await, let it happen in background)
        managedTorrent.session.start().catch((error) => {
          this.emit('error', { error });
        });
      }
    }
  }

  /**
   * Update aggregate statistics
   */
  private updateStats(): void {
    let totalDownloadSpeed = 0;
    let totalUploadSpeed = 0;
    let activeTorrents = 0;
    let sessionDownloaded = 0;
    let sessionUploaded = 0;

    for (const { session } of this.torrents.values()) {
      totalDownloadSpeed += session.downloadSpeed;
      totalUploadSpeed += session.uploadSpeed;
      sessionDownloaded += session.downloaded;
      sessionUploaded += session.uploaded;

      if (isActiveState(session.state)) {
        activeTorrents++;
      }
    }

    const totalPeers = this.peerManager?.getTotalPeerCount() ?? 0;

    this.cachedStats = {
      totalDownloadSpeed,
      totalUploadSpeed,
      activeTorrents,
      totalPeers,
      sessionDownloaded,
      sessionUploaded,
    };

    this.emit('statsUpdated', { stats: this.cachedStats });
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default SessionManager;
