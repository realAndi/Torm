/**
 * Torrent Session for Torm BitTorrent Client
 *
 * Orchestrates all components for a single torrent download/upload session,
 * managing the complete lifecycle from initialization to completion.
 *
 * Integrates:
 * - TorrentMetadata: Parsed torrent information
 * - PieceManager: Block request coordination and piece verification
 * - DiskManager: File I/O and piece persistence
 * - PeerManager: Peer connections and protocol messaging
 * - TrackerClient: Tracker announces and peer discovery
 * - BandwidthLimiter: Rate limiting for transfers
 * - ChokingAlgorithm: Upload slot management
 *
 * @module engine/session/session
 */

import { TypedEventEmitter } from '../events.js';
import { TorrentState, Peer, TorrentFile, FilePriority, TrackerInfo } from '../types.js';
import { TorrentMetadata } from '../torrent/parser.js';
import { PieceManager, PieceManagerEvents } from '../piece/manager.js';
import { DiskManager, DiskManagerOptions } from '../disk/manager.js';
import { AllocationStrategy } from '../disk/io.js';
import { PeerManager, PeerManagerEvents } from '../peer/manager.js';
import { TrackerClient, PeerInfo } from '../tracker/client.js';
import { BandwidthLimiter, BandwidthLimitConfig } from './bandwidth.js';
import { ChokingAlgorithm, PeerStats, PeerList } from './choking.js';

// =============================================================================
// Constants
// =============================================================================

/** Default progress event throttle interval in milliseconds */
const PROGRESS_THROTTLE_MS = 100;

/** Speed calculation window in milliseconds */
const SPEED_WINDOW_MS = 5000;

/** Number of speed samples to keep */
const SPEED_SAMPLE_COUNT = 5;

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Events emitted by TorrentSession
 */
export interface TorrentSessionEvents {
  /** Emitted when the session state changes */
  stateChanged: {
    previousState: TorrentState;
    newState: TorrentState;
  };

  /** Emitted periodically with progress information (throttled) */
  progress: {
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    downloaded: number;
    uploaded: number;
    peers: number;
    eta: number | null;
  };

  /** Emitted when the torrent download completes */
  completed: void;

  /** Emitted when an error occurs */
  error: {
    error: Error;
    context: string;
  };

  /** Emitted when a piece is verified and written to disk */
  pieceComplete: {
    pieceIndex: number;
  };

  /** Emitted when a piece fails verification */
  pieceFailed: {
    pieceIndex: number;
  };

  /** Emitted when a new peer connects */
  peerConnected: {
    peer: Peer;
  };

  /** Emitted when a peer disconnects */
  peerDisconnected: {
    peerId: string;
  };

  /** Emitted when peers are received from tracker */
  peersReceived: {
    count: number;
    tracker: string;
  };

  /** Emitted when verification progress updates */
  verificationProgress: {
    checked: number;
    total: number;
    progress: number;
  };

  /** Emitted when metadata is ready (for magnet links) */
  metadataReady: void;
}

/**
 * Options for creating a TorrentSession
 */
export interface TorrentSessionOptions {
  /** Directory to save downloaded files */
  downloadPath: string;

  /** Maximum connections for this torrent (default: 30) */
  maxConnections?: number;

  /** Per-torrent bandwidth limits */
  bandwidthLimits?: BandwidthLimitConfig;

  /** Whether to verify existing pieces on start (default: true) */
  verifyOnStart?: boolean;

  /** Whether to start in paused state (default: false) */
  startPaused?: boolean;

  /** File allocation strategy */
  allocationStrategy?: AllocationStrategy;
}

/**
 * Speed sample for averaging
 */
interface SpeedSample {
  bytes: number;
  timestamp: number;
}

/**
 * Peer state tracking for the session
 */
interface SessionPeerState {
  /** Peer's bitfield */
  bitfield: Buffer | null;

  /** Whether we're interested in the peer */
  amInterested: boolean;

  /** Whether the peer is choking us */
  peerChoking: boolean;

  /** Whether we're choking the peer */
  amChoking: boolean;

  /** Whether the peer is interested in us */
  peerInterested: boolean;

  /** Total downloaded from this peer */
  downloaded: number;

  /** Total uploaded to this peer */
  uploaded: number;
}

// =============================================================================
// PeerListAdapter
// =============================================================================

/**
 * Adapter to provide PeerList interface for ChokingAlgorithm
 */
class PeerListAdapter implements PeerList {
  constructor(
    private readonly session: TorrentSession,
    private readonly peerManager: PeerManager
  ) {}

  getPeerStats(): PeerStats[] {
    const peers = this.peerManager.getPeers(this.session.infoHash);
    const stats: PeerStats[] = [];

    for (const peer of peers) {
      const peerState = this.session.getPeerState(peer.id);
      if (peerState) {
        stats.push({
          peerId: peer.id,
          downloadRate: peer.downloadSpeed,
          uploadRate: peer.uploadSpeed,
          amChoking: peerState.amChoking,
          peerInterested: peerState.peerInterested,
          amInterested: peerState.amInterested,
          peerChoking: peerState.peerChoking,
        });
      }
    }

    return stats;
  }

  getPeerStat(peerId: string): PeerStats | undefined {
    const peers = this.peerManager.getPeers(this.session.infoHash);
    const peer = peers.find((p) => p.id === peerId);
    const peerState = this.session.getPeerState(peerId);

    if (!peer || !peerState) {
      return undefined;
    }

    return {
      peerId: peer.id,
      downloadRate: peer.downloadSpeed,
      uploadRate: peer.uploadSpeed,
      amChoking: peerState.amChoking,
      peerInterested: peerState.peerInterested,
      amInterested: peerState.amInterested,
      peerChoking: peerState.peerChoking,
    };
  }
}

// =============================================================================
// TorrentSession Class
// =============================================================================

/**
 * Orchestrates a single torrent download/upload session
 *
 * TorrentSession coordinates all the components needed to download and seed
 * a torrent, handling the complete lifecycle from initialization through
 * completion and seeding.
 *
 * @example
 * ```typescript
 * const session = new TorrentSession(
 *   metadata,
 *   peerManager,
 *   trackerClient,
 *   {
 *     downloadPath: '/downloads',
 *     maxConnections: 50,
 *   }
 * );
 *
 * session.on('progress', (stats) => {
 *   console.log(`Progress: ${(stats.progress * 100).toFixed(1)}%`);
 *   console.log(`Download: ${formatSpeed(stats.downloadSpeed)}`);
 *   console.log(`ETA: ${formatEta(stats.eta)}`);
 * });
 *
 * session.on('completed', () => {
 *   console.log('Download complete!');
 * });
 *
 * await session.start();
 * ```
 */
export class TorrentSession extends TypedEventEmitter<TorrentSessionEvents> {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** Torrent metadata */
  private readonly metadata: TorrentMetadata;

  /** Shared peer manager */
  private readonly peerManager: PeerManager;

  /** Shared tracker client */
  private readonly trackerClient: TrackerClient;

  /** Session options */
  private readonly options: Required<TorrentSessionOptions>;

  /** Piece manager for this session */
  private readonly pieceManager: PieceManager;

  /** Disk manager for this session */
  private readonly diskManager: DiskManager;

  /** Bandwidth limiter for this session */
  private readonly bandwidthLimiter: BandwidthLimiter;

  /** Choking algorithm for upload management */
  private readonly chokingAlgorithm: ChokingAlgorithm;

  /** Current session state */
  private _state: TorrentState = TorrentState.QUEUED;

  /** Total bytes downloaded */
  private _downloaded: number = 0;

  /** Total bytes uploaded */
  private _uploaded: number = 0;

  /** Download speed samples */
  private downloadSamples: SpeedSample[] = [];

  /** Upload speed samples */
  private uploadSamples: SpeedSample[] = [];

  /** Timestamp of session start */
  private startTime: number = 0;

  /** Last progress event emission time */
  private lastProgressEmit: number = 0;

  /** Progress event timer */
  private progressTimer: ReturnType<typeof setInterval> | null = null;

  /** Per-peer state tracking */
  private readonly peerStates: Map<string, SessionPeerState> = new Map();

  /** Error message if in error state */
  private _error?: string;

  /** Completion timestamp */
  private _completedAt?: Date;

  /** Added timestamp */
  private readonly _addedAt: Date;

  /** Bound event handlers for cleanup */
  private boundHandlers: {
    onPieceComplete: (data: PieceManagerEvents['pieceComplete']) => void;
    onPieceFailed: (data: PieceManagerEvents['pieceFailed']) => void;
    onDownloadComplete: () => void;
    onPieceWritten: (data: { pieceIndex: number }) => void;
    onPeerConnected: (data: PeerManagerEvents['peerConnected']) => void;
    onPeerDisconnected: (data: PeerManagerEvents['peerDisconnected']) => void;
    onPeerBitfield: (data: PeerManagerEvents['peerBitfield']) => void;
    onPeerHave: (data: PeerManagerEvents['peerHave']) => void;
    onPeerChoked: (data: PeerManagerEvents['peerChoked']) => void;
    onPeerUnchoked: (data: PeerManagerEvents['peerUnchoked']) => void;
    onPeerInterested: (data: PeerManagerEvents['peerInterested']) => void;
    onPeerNotInterested: (data: PeerManagerEvents['peerNotInterested']) => void;
    onPieceReceived: (data: PeerManagerEvents['pieceReceived']) => void;
    onRequestReceived: (data: PeerManagerEvents['requestReceived']) => void;
    onTrackerAnnounce: (data: { infoHash: string; tracker: TrackerInfo; peers: PeerInfo[] }) => void;
    onChoke: (data: { peerId: string }) => void;
    onUnchoke: (data: { peerId: string }) => void;
    onPexPeers: (data: PeerManagerEvents['pexPeers']) => void;
  };

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Create a new TorrentSession
   *
   * @param metadata - Parsed torrent metadata
   * @param peerManager - Shared peer manager instance
   * @param trackerClient - Shared tracker client instance
   * @param options - Session configuration options
   */
  constructor(
    metadata: TorrentMetadata,
    peerManager: PeerManager,
    trackerClient: TrackerClient,
    options: TorrentSessionOptions
  ) {
    super();

    this.metadata = metadata;
    this.peerManager = peerManager;
    this.trackerClient = trackerClient;
    this._addedAt = new Date();

    // Apply defaults to options
    this.options = {
      downloadPath: options.downloadPath,
      maxConnections: options.maxConnections ?? 30,
      bandwidthLimits: options.bandwidthLimits ?? { downloadRate: 0, uploadRate: 0 },
      verifyOnStart: options.verifyOnStart ?? true,
      startPaused: options.startPaused ?? false,
      allocationStrategy: options.allocationStrategy ?? AllocationStrategy.Sparse,
    };

    // Create piece manager
    this.pieceManager = new PieceManager({
      pieceCount: metadata.pieceCount,
      pieceLength: metadata.pieceLength,
      totalLength: metadata.totalLength,
      pieceHashes: metadata.pieces,
    });

    // Create disk manager
    const diskOptions: DiskManagerOptions = {
      downloadPath: this.options.downloadPath,
      verifyOnStart: this.options.verifyOnStart,
      allocationStrategy: this.options.allocationStrategy,
    };
    this.diskManager = new DiskManager(metadata, diskOptions);

    // Create bandwidth limiter
    this.bandwidthLimiter = new BandwidthLimiter(this.options.bandwidthLimits);

    // Create choking algorithm
    const peerListAdapter = new PeerListAdapter(this, peerManager);
    this.chokingAlgorithm = new ChokingAlgorithm(peerListAdapter);

    // Bind event handlers
    this.boundHandlers = {
      onPieceComplete: this.handlePieceComplete.bind(this),
      onPieceFailed: this.handlePieceFailed.bind(this),
      onDownloadComplete: this.handleDownloadComplete.bind(this),
      onPieceWritten: this.handlePieceWritten.bind(this),
      onPeerConnected: this.handlePeerConnected.bind(this),
      onPeerDisconnected: this.handlePeerDisconnected.bind(this),
      onPeerBitfield: this.handlePeerBitfield.bind(this),
      onPeerHave: this.handlePeerHave.bind(this),
      onPeerChoked: this.handlePeerChoked.bind(this),
      onPeerUnchoked: this.handlePeerUnchoked.bind(this),
      onPeerInterested: this.handlePeerInterested.bind(this),
      onPeerNotInterested: this.handlePeerNotInterested.bind(this),
      onPieceReceived: this.handlePieceReceived.bind(this),
      onRequestReceived: this.handleRequestReceived.bind(this),
      onTrackerAnnounce: this.handleTrackerAnnounce.bind(this),
      onChoke: this.handleChokingChoke.bind(this),
      onUnchoke: this.handleChokingUnchoke.bind(this),
      onPexPeers: this.handlePexPeers.bind(this),
    };

    // Setup event listeners
    this.setupEventListeners();
  }

  // ===========================================================================
  // Public Properties
  // ===========================================================================

  /**
   * Info hash as hex string
   */
  get infoHash(): string {
    return this.metadata.infoHashHex;
  }

  /**
   * Info hash as Buffer
   */
  get infoHashBuffer(): Buffer {
    return this.metadata.infoHash;
  }

  /**
   * Torrent name
   */
  get name(): string {
    return this.metadata.name;
  }

  /**
   * Current torrent state
   */
  get state(): TorrentState {
    return this._state;
  }

  /**
   * Download progress (0-1)
   */
  get progress(): number {
    return this.pieceManager.progress;
  }

  /**
   * Current download speed in bytes/second
   */
  get downloadSpeed(): number {
    return this.calculateSpeed(this.downloadSamples);
  }

  /**
   * Current upload speed in bytes/second
   */
  get uploadSpeed(): number {
    return this.calculateSpeed(this.uploadSamples);
  }

  /**
   * Estimated time to completion in seconds, or null if unknown
   */
  get eta(): number | null {
    const remaining = this.metadata.totalLength - this._downloaded;
    const speed = this.downloadSpeed;

    if (speed <= 0 || remaining <= 0) {
      return null;
    }

    return Math.ceil(remaining / speed);
  }

  /**
   * Total bytes downloaded
   */
  get downloaded(): number {
    return this._downloaded;
  }

  /**
   * Total bytes uploaded
   */
  get uploaded(): number {
    return this._uploaded;
  }

  /**
   * Number of connected peers
   */
  get peers(): number {
    return this.peerManager.getPeerCount(this.infoHash);
  }

  /**
   * Number of connected seeds (peers with 100% of the torrent)
   */
  get seeds(): number {
    const peers = this.peerManager.getPeers(this.infoHash);
    return peers.filter(p => p.progress >= 1).length;
  }

  /**
   * Total size in bytes
   */
  get size(): number {
    return this.metadata.totalLength;
  }

  /**
   * Total size in bytes (alias for size)
   */
  get totalSize(): number {
    return this.metadata.totalLength;
  }

  /**
   * Download path for this torrent
   */
  get downloadPath(): string {
    return this.options.downloadPath;
  }

  /**
   * Piece length in bytes
   */
  get pieceLength(): number {
    return this.metadata.pieceLength;
  }

  /**
   * Total number of pieces
   */
  get pieceCount(): number {
    return this.metadata.pieceCount;
  }

  /**
   * Error message if in error state
   */
  get error(): string | undefined {
    return this._error;
  }

  /**
   * Timestamp when torrent was added
   */
  get addedAt(): Date {
    return this._addedAt;
  }

  /**
   * Timestamp when download completed
   */
  get completedAt(): Date | undefined {
    return this._completedAt;
  }

  /**
   * Whether the download is complete
   */
  get isComplete(): boolean {
    return this.pieceManager.isComplete;
  }

  /**
   * Get file information
   */
  get files(): TorrentFile[] {
    return this.metadata.files.map((file, index) => ({
      path: file.path,
      size: file.length,
      downloaded: this.calculateFileDownloaded(index),
      priority: FilePriority.Normal,
      index,
    }));
  }

  /**
   * Get tracker information
   */
  get trackers(): TrackerInfo[] {
    return this.trackerClient.getTrackerInfo(this.infoHash);
  }

  // ===========================================================================
  // Public Methods - Lifecycle
  // ===========================================================================

  /**
   * Start the torrent session
   *
   * Initializes disk manager, verifies existing pieces, announces to trackers,
   * and begins downloading/seeding.
   */
  async start(): Promise<void> {
    if (this._state !== TorrentState.QUEUED && this._state !== TorrentState.PAUSED) {
      return;
    }

    try {
      // Transition to checking state
      this.setState(TorrentState.CHECKING);

      // Start disk manager and verify existing pieces
      const completedPieces = await this.diskManager.start();

      // Mark verified pieces as complete in piece manager
      for (const pieceIndex of completedPieces) {
        this.pieceManager.markPieceComplete(pieceIndex);
      }

      // Update downloaded bytes based on verified pieces
      this._downloaded = this.calculateDownloadedBytes();

      // Emit verification complete event
      this.emit('verificationProgress', {
        checked: this.metadata.pieceCount,
        total: this.metadata.pieceCount,
        progress: 1,
      });

      // Check if already complete
      if (this.pieceManager.isComplete) {
        this.setState(TorrentState.SEEDING);
        this._completedAt = new Date();
        this.chokingAlgorithm.setSeeding(true);
      } else {
        this.setState(TorrentState.DOWNLOADING);
      }

      // Start choking algorithm
      this.chokingAlgorithm.start();

      // Register with tracker and announce
      const trackers = this.metadata.announceList ?? [[this.metadata.announce]];

      this.trackerClient.addTorrent({
        infoHash: this.metadata.infoHash,
        downloaded: this._downloaded,
        uploaded: this._uploaded,
        left: this.metadata.totalLength - this._downloaded,
        trackers: trackers,
      });

      await this.trackerClient.announce(this.infoHash, 'started');

      // Start progress reporting
      this.startProgressReporting();
      this.startTime = Date.now();
    } catch (err) {
      this.handleError(err as Error, 'starting session');
    }
  }

  /**
   * Pause the torrent session
   *
   * Stops downloading/uploading but maintains peer connections and tracker state.
   */
  async pause(): Promise<void> {
    if (this._state !== TorrentState.DOWNLOADING && this._state !== TorrentState.SEEDING) {
      return;
    }

    this.setState(TorrentState.PAUSED);

    // Stop progress reporting
    this.stopProgressReporting();

    // Stop choking algorithm
    this.chokingAlgorithm.stop();
  }

  /**
   * Set torrent to queued state (used by SessionManager for queue management)
   */
  queue(): void {
    if (this._state === TorrentState.QUEUED) {
      return;
    }
    this.setState(TorrentState.QUEUED);
  }

  /**
   * Resume a paused torrent session
   */
  async resume(): Promise<void> {
    if (this._state !== TorrentState.PAUSED) {
      return;
    }

    // Determine target state
    if (this.pieceManager.isComplete) {
      this.setState(TorrentState.SEEDING);
      this.chokingAlgorithm.setSeeding(true);
    } else {
      this.setState(TorrentState.DOWNLOADING);
    }

    // Restart choking algorithm
    this.chokingAlgorithm.start();

    // Restart progress reporting
    this.startProgressReporting();

    // Request blocks from unchoked peers
    this.requestBlocksFromPeers();
  }

  /**
   * Stop the torrent session
   *
   * Announces 'stopped' to trackers, disconnects peers, and cleans up resources.
   */
  async stop(): Promise<void> {
    // Stop progress reporting
    this.stopProgressReporting();

    // Stop choking algorithm
    this.chokingAlgorithm.stop();

    // Announce stopped to tracker
    try {
      await this.trackerClient.announce(this.infoHash, 'stopped');
    } catch {
      // Ignore tracker errors on stop
    }

    // Remove from tracker client
    this.trackerClient.removeTorrent(this.infoHash);

    // Disconnect all peers for this torrent
    this.peerManager.disconnectAllPeers(this.infoHash);

    // Stop disk manager
    await this.diskManager.stop();

    // Stop bandwidth limiter
    this.bandwidthLimiter.stop();

    // Clean up event listeners
    this.removeEventListeners();

    // Clear peer states
    this.peerStates.clear();
  }

  // ===========================================================================
  // Public Methods - Peer State Access
  // ===========================================================================

  /**
   * Get peer state for a specific peer
   *
   * @param peerId - Peer ID
   * @returns Peer state or undefined
   */
  getPeerState(peerId: string): SessionPeerState | undefined {
    return this.peerStates.get(peerId);
  }

  /**
   * Get connected peer list
   *
   * @returns Array of connected peers
   */
  getConnectedPeers(): Peer[] {
    return this.peerManager.getPeers(this.infoHash);
  }

  /**
   * Delete downloaded files for this torrent
   *
   * Stops the disk manager and deletes all downloaded files.
   */
  async deleteFiles(): Promise<void> {
    await this.diskManager.deleteFiles(true);
  }

  /**
   * Force re-verification of all pieces on disk
   *
   * Re-checks all pieces and updates completion state.
   * Useful if the torrent appears stuck near completion.
   */
  async verify(): Promise<void> {
    // Re-verify all pieces on disk
    await this.diskManager.verifyExistingPieces();

    // Sync piece manager state with disk manager
    for (let i = 0; i < this.metadata.pieceCount; i++) {
      if (this.diskManager.hasPiece(i) && !this.pieceManager.hasPiece(i)) {
        this.pieceManager.markPieceComplete(i);
      }
    }

    // Check if now complete and transition to seeding
    if (this.pieceManager.isComplete && this._state === TorrentState.DOWNLOADING) {
      this.handleDownloadComplete();
    }
  }

  // ===========================================================================
  // Private Methods - Event Setup
  // ===========================================================================

  /**
   * Setup all event listeners
   */
  private setupEventListeners(): void {
    // Piece manager events
    this.pieceManager.on('pieceComplete', this.boundHandlers.onPieceComplete);
    this.pieceManager.on('pieceFailed', this.boundHandlers.onPieceFailed);
    this.pieceManager.on('downloadComplete', this.boundHandlers.onDownloadComplete);

    // Disk manager events
    this.diskManager.on('pieceWritten', this.boundHandlers.onPieceWritten);

    // Peer manager events (filtered by infoHash)
    this.peerManager.on('peerConnected', this.boundHandlers.onPeerConnected);
    this.peerManager.on('peerDisconnected', this.boundHandlers.onPeerDisconnected);
    this.peerManager.on('peerBitfield', this.boundHandlers.onPeerBitfield);
    this.peerManager.on('peerHave', this.boundHandlers.onPeerHave);
    this.peerManager.on('peerChoked', this.boundHandlers.onPeerChoked);
    this.peerManager.on('peerUnchoked', this.boundHandlers.onPeerUnchoked);
    this.peerManager.on('peerInterested', this.boundHandlers.onPeerInterested);
    this.peerManager.on('peerNotInterested', this.boundHandlers.onPeerNotInterested);
    this.peerManager.on('pieceReceived', this.boundHandlers.onPieceReceived);
    this.peerManager.on('requestReceived', this.boundHandlers.onRequestReceived);
    this.peerManager.on('pexPeers', this.boundHandlers.onPexPeers);

    // Tracker events (filtered by infoHash)
    this.trackerClient.on('announce', this.boundHandlers.onTrackerAnnounce);

    // Choking algorithm events
    this.chokingAlgorithm.on('choke', this.boundHandlers.onChoke);
    this.chokingAlgorithm.on('unchoke', this.boundHandlers.onUnchoke);
  }

  /**
   * Remove all event listeners
   */
  private removeEventListeners(): void {
    // Piece manager events
    this.pieceManager.off('pieceComplete', this.boundHandlers.onPieceComplete);
    this.pieceManager.off('pieceFailed', this.boundHandlers.onPieceFailed);
    this.pieceManager.off('downloadComplete', this.boundHandlers.onDownloadComplete);

    // Disk manager events
    this.diskManager.off('pieceWritten', this.boundHandlers.onPieceWritten);

    // Peer manager events
    this.peerManager.off('peerConnected', this.boundHandlers.onPeerConnected);
    this.peerManager.off('peerDisconnected', this.boundHandlers.onPeerDisconnected);
    this.peerManager.off('peerBitfield', this.boundHandlers.onPeerBitfield);
    this.peerManager.off('peerHave', this.boundHandlers.onPeerHave);
    this.peerManager.off('peerChoked', this.boundHandlers.onPeerChoked);
    this.peerManager.off('peerUnchoked', this.boundHandlers.onPeerUnchoked);
    this.peerManager.off('peerInterested', this.boundHandlers.onPeerInterested);
    this.peerManager.off('peerNotInterested', this.boundHandlers.onPeerNotInterested);
    this.peerManager.off('pieceReceived', this.boundHandlers.onPieceReceived);
    this.peerManager.off('requestReceived', this.boundHandlers.onRequestReceived);

    // Tracker events
    this.trackerClient.off('announce', this.boundHandlers.onTrackerAnnounce);

    // Choking algorithm events
    this.chokingAlgorithm.off('choke', this.boundHandlers.onChoke);
    this.chokingAlgorithm.off('unchoke', this.boundHandlers.onUnchoke);
  }

  // ===========================================================================
  // Private Methods - Event Handlers
  // ===========================================================================

  /**
   * Handle piece completion from piece manager
   */
  private handlePieceComplete(data: PieceManagerEvents['pieceComplete']): void {
    const { pieceIndex, data: pieceData } = data;

    // Write piece to disk
    this.diskManager.writePiece(pieceIndex, pieceData).catch((err) => {
      this.handleError(err as Error, `writing piece ${pieceIndex}`);
    });
  }

  /**
   * Handle piece verification failure
   */
  private handlePieceFailed(data: PieceManagerEvents['pieceFailed']): void {
    this.emit('pieceFailed', { pieceIndex: data.pieceIndex });
  }

  /**
   * Handle download completion
   */
  private handleDownloadComplete(): void {
    this.setState(TorrentState.SEEDING);
    this._completedAt = new Date();
    this.chokingAlgorithm.setSeeding(true);

    // Announce completion to tracker
    this.trackerClient.announce(this.infoHash, 'completed').catch((err) => {
      // Non-fatal error
      this.emit('error', {
        error: err as Error,
        context: 'announcing completion to tracker',
      });
    });

    this.emit('completed');
  }

  /**
   * Handle piece written to disk
   */
  private handlePieceWritten(data: { pieceIndex: number }): void {
    this.emit('pieceComplete', { pieceIndex: data.pieceIndex });

    // Broadcast 'have' to all connected peers
    this.broadcastHave(data.pieceIndex);
  }

  /**
   * Handle peer connected
   */
  private handlePeerConnected(data: PeerManagerEvents['peerConnected']): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const { peer } = data;

    // Initialize peer state
    this.peerStates.set(peer.id, {
      bitfield: null,
      amInterested: false,
      peerChoking: true,
      amChoking: true,
      peerInterested: false,
      downloaded: 0,
      uploaded: 0,
    });

    // Add to choking algorithm
    this.chokingAlgorithm.addPeer(peer.id);

    // Send our bitfield if we have pieces
    if (this.pieceManager.completedPieces > 0) {
      const bitfield = this.pieceManager.getBitfield();
      this.peerManager.sendBitfield(this.infoHash, peer.id, bitfield).catch(() => {
        // Peer may have disconnected
      });
    }

    this.emit('peerConnected', { peer });
  }

  /**
   * Handle peer disconnected
   */
  private handlePeerDisconnected(data: PeerManagerEvents['peerDisconnected']): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const { peerId } = data;

    // Remove from piece manager
    this.pieceManager.removePeer(peerId);

    // Remove from choking algorithm
    this.chokingAlgorithm.removePeer(peerId);

    // Remove peer state
    this.peerStates.delete(peerId);

    this.emit('peerDisconnected', { peerId });
  }

  /**
   * Handle peer bitfield received
   */
  private handlePeerBitfield(data: PeerManagerEvents['peerBitfield']): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const { peerId, bitfield } = data;
    const peerState = this.peerStates.get(peerId);

    if (peerState) {
      peerState.bitfield = bitfield;
    }

    // Add to piece manager
    this.pieceManager.addPeerBitfield(peerId, bitfield);

    // Check if we're interested
    this.updateInterestState(peerId, bitfield);
  }

  /**
   * Handle peer 'have' message
   */
  private handlePeerHave(data: PeerManagerEvents['peerHave']): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const { peerId, pieceIndex } = data;

    // Update piece manager
    this.pieceManager.handlePeerHave(peerId, pieceIndex);

    // Update interest if we don't have this piece
    if (!this.pieceManager.hasPiece(pieceIndex)) {
      const peerState = this.peerStates.get(peerId);
      if (peerState && !peerState.amInterested) {
        this.sendInterested(peerId);
      }
    }
  }

  /**
   * Handle peer choked us
   */
  private handlePeerChoked(data: PeerManagerEvents['peerChoked']): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const peerState = this.peerStates.get(data.peerId);
    if (peerState) {
      peerState.peerChoking = true;
    }
  }

  /**
   * Handle peer unchoked us
   */
  private handlePeerUnchoked(data: PeerManagerEvents['peerUnchoked']): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const { peerId } = data;
    const peerState = this.peerStates.get(peerId);

    if (peerState) {
      peerState.peerChoking = false;
    }

    // Request blocks if we're interested
    if (peerState?.amInterested && this._state === TorrentState.DOWNLOADING) {
      this.requestBlocksFromPeer(peerId);
    }
  }

  /**
   * Handle peer interested in us
   */
  private handlePeerInterested(data: PeerManagerEvents['peerInterested']): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const peerState = this.peerStates.get(data.peerId);
    if (peerState) {
      peerState.peerInterested = true;
    }
  }

  /**
   * Handle peer not interested in us
   */
  private handlePeerNotInterested(data: PeerManagerEvents['peerNotInterested']): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const peerState = this.peerStates.get(data.peerId);
    if (peerState) {
      peerState.peerInterested = false;
    }
  }

  /**
   * Handle piece block received from peer
   */
  private handlePieceReceived(data: PeerManagerEvents['pieceReceived']): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const { peerId, pieceIndex, begin, block } = data;

    // Update stats
    this._downloaded += block.length;
    this.addDownloadSample(block.length);

    // Update peer state
    const peerState = this.peerStates.get(peerId);
    if (peerState) {
      peerState.downloaded += block.length;
    }

    // Update choking algorithm activity
    this.chokingAlgorithm.updatePeerActivity(peerId);

    // Pass to piece manager
    this.pieceManager.handleBlock(peerId, pieceIndex, begin, block);

    // Request more blocks if appropriate
    if (this._state === TorrentState.DOWNLOADING && peerState && !peerState.peerChoking) {
      this.requestBlocksFromPeer(peerId);
    }
  }

  /**
   * Handle piece request from peer
   */
  private async handleRequestReceived(data: PeerManagerEvents['requestReceived']): Promise<void> {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const { peerId, pieceIndex, begin, length } = data;
    const peerState = this.peerStates.get(peerId);

    // Only serve if we're not choking the peer
    if (!peerState || peerState.amChoking) {
      return;
    }

    // Check if we have this piece
    if (!this.pieceManager.hasPiece(pieceIndex)) {
      return;
    }

    try {
      // Rate limit the upload
      await this.bandwidthLimiter.request(length, 'upload', this.infoHash);

      // Read the block from disk
      const block = await this.diskManager.readBlock(pieceIndex, begin, length);

      // Send to peer
      await this.peerManager.sendPiece(this.infoHash, peerId, pieceIndex, begin, block);

      // Update stats
      this._uploaded += block.length;
      this.addUploadSample(block.length);

      if (peerState) {
        peerState.uploaded += block.length;
      }
    } catch (err) {
      // Peer may have disconnected or disk error
      this.emit('error', {
        error: err as Error,
        context: `serving block ${pieceIndex}:${begin}:${length}`,
      });
    }
  }

  /**
   * Handle tracker announce response
   */
  private handleTrackerAnnounce(data: { infoHash: string; tracker: TrackerInfo; peers: PeerInfo[] }): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    const { tracker, peers } = data;

    // Add peers to peer manager
    this.peerManager.addPeers(this.infoHash, this.metadata.infoHash, peers);

    // Update tracker stats
    this.trackerClient.updateStats(
      this.infoHash,
      this._downloaded,
      this._uploaded,
      this.metadata.totalLength - this._downloaded
    );

    this.emit('peersReceived', {
      count: peers.length,
      tracker: tracker.url,
    });
  }

  /**
   * Handle PEX (Peer Exchange) peers received from a connected peer
   */
  private handlePexPeers(data: { infoHash: string; peerId: string; added: Array<{ ip: string; port: number }>; dropped: Array<{ ip: string; port: number }> }): void {
    if (data.infoHash !== this.infoHash) {
      return;
    }

    // Convert PEX peers to PeerInfo format and add to peer manager
    if (data.added.length > 0) {
      const peers = data.added.map(p => ({
        ip: p.ip,
        port: p.port,
      }));

      this.peerManager.addPeers(this.infoHash, this.metadata.infoHash, peers);

      this.emit('peersReceived', {
        count: peers.length,
        tracker: `PEX from ${data.peerId.substring(0, 8)}...`,
      });
    }
  }

  /**
   * Handle choking algorithm choke decision
   */
  private handleChokingChoke(data: { peerId: string }): void {
    const peerState = this.peerStates.get(data.peerId);
    if (peerState && !peerState.amChoking) {
      peerState.amChoking = true;
      this.peerManager.sendChoke(this.infoHash, data.peerId).catch(() => {
        // Peer may have disconnected
      });
    }
  }

  /**
   * Handle choking algorithm unchoke decision
   */
  private handleChokingUnchoke(data: { peerId: string }): void {
    const peerState = this.peerStates.get(data.peerId);
    if (peerState && peerState.amChoking) {
      peerState.amChoking = false;
      this.peerManager.sendUnchoke(this.infoHash, data.peerId).catch(() => {
        // Peer may have disconnected
      });
    }
  }

  // ===========================================================================
  // Private Methods - Peer Communication
  // ===========================================================================

  /**
   * Update interest state based on peer's bitfield
   */
  private updateInterestState(peerId: string, bitfield: Buffer): void {
    const peerState = this.peerStates.get(peerId);
    if (!peerState) {
      return;
    }

    // Check if peer has any pieces we need
    let interested = false;
    const ownBitfield = this.pieceManager.getBitfield();

    for (let i = 0; i < this.metadata.pieceCount; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = 7 - (i % 8);
      const peerHas = (bitfield[byteIndex] & (1 << bitIndex)) !== 0;
      const weHave = (ownBitfield[byteIndex] & (1 << bitIndex)) !== 0;

      if (peerHas && !weHave) {
        interested = true;
        break;
      }
    }

    if (interested && !peerState.amInterested) {
      this.sendInterested(peerId);
    } else if (!interested && peerState.amInterested) {
      this.sendNotInterested(peerId);
    }
  }

  /**
   * Send interested message to peer
   */
  private sendInterested(peerId: string): void {
    const peerState = this.peerStates.get(peerId);
    if (peerState) {
      peerState.amInterested = true;
      this.peerManager.sendInterested(this.infoHash, peerId).catch(() => {
        // Peer may have disconnected
      });
    }
  }

  /**
   * Send not interested message to peer
   */
  private sendNotInterested(peerId: string): void {
    const peerState = this.peerStates.get(peerId);
    if (peerState) {
      peerState.amInterested = false;
      this.peerManager.sendNotInterested(this.infoHash, peerId).catch(() => {
        // Peer may have disconnected
      });
    }
  }

  /**
   * Request blocks from all unchoked peers
   */
  private requestBlocksFromPeers(): void {
    for (const [peerId, peerState] of this.peerStates) {
      if (peerState.amInterested && !peerState.peerChoking && peerState.bitfield) {
        this.requestBlocksFromPeer(peerId);
      }
    }
  }

  /**
   * Request blocks from a specific peer
   */
  private async requestBlocksFromPeer(peerId: string): Promise<void> {
    const peerState = this.peerStates.get(peerId);
    if (!peerState?.bitfield || peerState.peerChoking) {
      return;
    }

    // Get block requests from piece manager
    const requests = this.pieceManager.getBlockRequests(peerId, peerState.bitfield);

    if (requests.length === 0) {
      return;
    }

    // Request bandwidth for all blocks at once (total bytes)
    const totalBytes = requests.reduce((sum, r) => sum + r.length, 0);
    try {
      await this.bandwidthLimiter.request(totalBytes, 'download', this.infoHash);
    } catch {
      // Rate limited, try again later
      return;
    }

    // Send all requests concurrently for maximum throughput
    await Promise.all(
      requests.map((request) =>
        this.peerManager
          .sendRequest(
            this.infoHash,
            peerId,
            request.pieceIndex,
            request.begin,
            request.length
          )
          .catch(() => {
            // Peer may have disconnected, ignore individual failures
          })
      )
    );
  }

  /**
   * Broadcast 'have' message to all connected peers
   */
  private broadcastHave(pieceIndex: number): void {
    const peers = this.peerManager.getPeers(this.infoHash);

    for (const peer of peers) {
      this.peerManager.sendHave(this.infoHash, peer.id, pieceIndex).catch(() => {
        // Peer may have disconnected
      });
    }
  }

  // ===========================================================================
  // Private Methods - State Management
  // ===========================================================================

  /**
   * Set the session state
   */
  private setState(newState: TorrentState): void {
    const previousState = this._state;
    if (previousState === newState) {
      return;
    }

    this._state = newState;
    this.emit('stateChanged', { previousState, newState });
  }

  /**
   * Handle an error
   */
  private handleError(error: Error, context: string): void {
    this._error = error.message;
    this.setState(TorrentState.ERROR);
    this.emit('error', { error, context });
  }

  // ===========================================================================
  // Private Methods - Progress Reporting
  // ===========================================================================

  /**
   * Start progress reporting timer
   */
  private startProgressReporting(): void {
    if (this.progressTimer) {
      return;
    }

    this.progressTimer = setInterval(() => {
      this.emitProgress();
      // Periodically retry requesting blocks to prevent stalls
      if (this._state === TorrentState.DOWNLOADING) {
        // Cancel stale requests so blocks can be re-requested
        this.pieceManager.cancelStaleRequests();
        // Try requesting blocks from all unchoked peers
        this.requestBlocksFromPeers();
      }
    }, PROGRESS_THROTTLE_MS);
  }

  /**
   * Stop progress reporting timer
   */
  private stopProgressReporting(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  /**
   * Emit progress event
   */
  private emitProgress(): void {
    const now = Date.now();
    if (now - this.lastProgressEmit < PROGRESS_THROTTLE_MS) {
      return;
    }

    this.lastProgressEmit = now;

    this.emit('progress', {
      progress: this.progress,
      downloadSpeed: this.downloadSpeed,
      uploadSpeed: this.uploadSpeed,
      downloaded: this._downloaded,
      uploaded: this._uploaded,
      peers: this.peers,
      eta: this.eta,
    });
  }

  // ===========================================================================
  // Private Methods - Speed Calculation
  // ===========================================================================

  /**
   * Add a download speed sample
   */
  private addDownloadSample(bytes: number): void {
    this.downloadSamples.push({
      bytes,
      timestamp: Date.now(),
    });
    this.pruneSpeedSamples(this.downloadSamples);
  }

  /**
   * Add an upload speed sample
   */
  private addUploadSample(bytes: number): void {
    this.uploadSamples.push({
      bytes,
      timestamp: Date.now(),
    });
    this.pruneSpeedSamples(this.uploadSamples);
  }

  /**
   * Prune old speed samples
   */
  private pruneSpeedSamples(samples: SpeedSample[]): void {
    const cutoff = Date.now() - SPEED_WINDOW_MS;
    while (samples.length > 0 && samples[0].timestamp < cutoff) {
      samples.shift();
    }
    // Also limit by count
    while (samples.length > SPEED_SAMPLE_COUNT) {
      samples.shift();
    }
  }

  /**
   * Calculate speed from samples with smooth decay
   */
  private calculateSpeed(samples: SpeedSample[]): number {
    if (samples.length === 0) {
      return 0;
    }

    const now = Date.now();
    const cutoff = now - SPEED_WINDOW_MS;

    // Filter to recent samples
    const recent = samples.filter((s) => s.timestamp >= cutoff);

    if (recent.length === 0) {
      // No recent samples - apply decay based on time since last sample
      // This prevents sudden jumps to 0 and creates a smooth fade out
      const lastSample = samples[samples.length - 1];
      const timeSinceLastSample = now - lastSample.timestamp;

      // If it's been more than 2x the window, definitely return 0
      if (timeSinceLastSample > SPEED_WINDOW_MS * 2) {
        return 0;
      }

      // Calculate what the speed would have been using all samples within extended window
      // then decay it based on how stale the data is
      const extendedCutoff = now - SPEED_WINDOW_MS * 2;
      const extendedRecent = samples.filter((s) => s.timestamp >= extendedCutoff);

      if (extendedRecent.length === 0) {
        return 0;
      }

      const totalBytes = extendedRecent.reduce((sum, s) => sum + s.bytes, 0);
      const oldestTimestamp = extendedRecent[0].timestamp;
      const timeSpan = now - oldestTimestamp;

      if (timeSpan <= 0) {
        return 0;
      }

      // Apply decay factor based on staleness (linear decay from 1 to 0 over the stale period)
      const decayFactor = Math.max(0, 1 - (timeSinceLastSample - SPEED_WINDOW_MS) / SPEED_WINDOW_MS);
      return Math.round((totalBytes * 1000 * decayFactor) / timeSpan);
    }

    // Sum bytes and calculate time span
    const totalBytes = recent.reduce((sum, s) => sum + s.bytes, 0);
    const timeSpan = now - recent[0].timestamp;

    if (timeSpan <= 0) {
      return 0;
    }

    return Math.round((totalBytes * 1000) / timeSpan);
  }

  // ===========================================================================
  // Private Methods - Utility
  // ===========================================================================

  /**
   * Calculate total downloaded bytes based on completed pieces
   */
  private calculateDownloadedBytes(): number {
    let downloaded = 0;

    for (let i = 0; i < this.metadata.pieceCount; i++) {
      if (this.pieceManager.hasPiece(i)) {
        if (i === this.metadata.pieceCount - 1) {
          // Last piece may be smaller
          const remainder = this.metadata.totalLength % this.metadata.pieceLength;
          downloaded += remainder === 0 ? this.metadata.pieceLength : remainder;
        } else {
          downloaded += this.metadata.pieceLength;
        }
      }
    }

    return downloaded;
  }

  /**
   * Calculate downloaded bytes for a specific file
   */
  private calculateFileDownloaded(fileIndex: number): number {
    // Simplified calculation - would need piece-to-file mapping for accuracy
    const file = this.metadata.files[fileIndex];
    return Math.round(file.length * this.progress);
  }
}

// =============================================================================
// Exports
// =============================================================================

export default TorrentSession;
