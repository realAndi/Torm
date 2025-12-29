/**
 * Core type definitions for the Torm engine.
 *
 * These types define the fundamental data structures used throughout the
 * torrent engine, including torrent state, file information, peer connections,
 * tracker communication, and engine configuration.
 *
 * @module engine/types
 */

// =============================================================================
// Enums
// =============================================================================

/**
 * Represents the current state of a torrent in its lifecycle.
 *
 * State transitions:
 *   (new) -> QUEUED -> CHECKING -> DOWNLOADING -> SEEDING
 *                          |           |            |
 *                        ERROR <--- PAUSED <--------
 */
export enum TorrentState {
  /** Torrent is queued and waiting to start */
  QUEUED = 'queued',

  /** Torrent is verifying existing data on disk */
  CHECKING = 'checking',

  /** Torrent is actively downloading pieces */
  DOWNLOADING = 'downloading',

  /** Torrent has completed and is seeding to peers */
  SEEDING = 'seeding',

  /** Torrent is paused by user or system */
  PAUSED = 'paused',

  /** Torrent encountered an error and stopped */
  ERROR = 'error',
}

/**
 * Priority levels for individual files within a torrent.
 * Higher values indicate higher download priority.
 */
export enum FilePriority {
  /** File will not be downloaded */
  Skip = 0,

  /** Low priority - downloaded after normal and high priority files */
  Low = 1,

  /** Normal priority - default for all files */
  Normal = 2,

  /** High priority - downloaded before normal and low priority files */
  High = 3,
}

/**
 * Status of a tracker connection.
 */
export enum TrackerStatus {
  /** Tracker is idle, not currently announcing */
  Idle = 'idle',

  /** Currently sending an announce request to the tracker */
  Announcing = 'announcing',

  /** Tracker responded successfully and is working */
  Working = 'working',

  /** Tracker encountered an error */
  Error = 'error',
}

// =============================================================================
// Core Interfaces
// =============================================================================

/**
 * Represents a single file within a torrent.
 *
 * Multi-file torrents contain multiple TorrentFile entries,
 * while single-file torrents contain exactly one.
 */
export interface TorrentFile {
  /** Relative path of the file within the torrent directory */
  path: string;

  /** Total size of the file in bytes */
  size: number;

  /** Number of bytes downloaded for this file */
  downloaded: number;

  /** Download priority for this file */
  priority: FilePriority;

  /** Zero-based index of this file within the torrent */
  index: number;
}

/**
 * Represents a connected peer in the swarm.
 *
 * Peers are other BitTorrent clients that we exchange
 * pieces with during download/upload.
 */
export interface Peer {
  /** Unique peer identifier (20-byte peer ID as hex string) */
  id: string;

  /** IP address of the peer */
  ip: string;

  /** Port number the peer is listening on */
  port: number;

  /** Client software name (parsed from peer ID, e.g., "qBittorrent 4.5.0") */
  client: string;

  /** Current download speed from this peer in bytes/second */
  downloadSpeed: number;

  /** Current upload speed to this peer in bytes/second */
  uploadSpeed: number;

  /** Peer's download progress as a ratio (0-1) */
  progress: number;

  /**
   * Peer connection state flags.
   * These flags indicate the choking and interest state of the connection.
   */
  flags: PeerFlags;

  /** Two-letter country code (ISO 3166-1 alpha-2) based on IP geolocation */
  country?: string;
}

/**
 * Flags representing the state of a peer connection.
 *
 * BitTorrent uses a choking mechanism to manage bandwidth:
 * - Choking: Not willing to send data to the other party
 * - Interested: Wants data that the other party has
 */
export interface PeerFlags {
  /** Whether we are interested in pieces the peer has */
  amInterested: boolean;

  /** Whether we are choking the peer (not sending data) */
  amChoking: boolean;

  /** Whether the peer is interested in pieces we have */
  peerInterested: boolean;

  /** Whether the peer is choking us (not sending data) */
  peerChoking: boolean;
}

/**
 * Information about a tracker associated with a torrent.
 *
 * Trackers help peers discover each other by maintaining
 * a list of peers for each torrent.
 */
export interface TrackerInfo {
  /** Full URL of the tracker */
  url: string;

  /** Current status of the tracker connection */
  status: TrackerStatus;

  /** Number of peers reported by the tracker in the last announce */
  peers: number;

  /** Number of seeders reported by the tracker in the last announce */
  seeds: number;

  /** Number of leechers reported by the tracker in the last announce */
  leeches: number;

  /** Timestamp of the last successful announce, or undefined if never announced */
  lastAnnounce: Date | null;

  /** Timestamp of the next scheduled announce, or undefined if not scheduled */
  nextAnnounce: Date | null;

  /** Error message if status is Error, undefined otherwise */
  errorMessage?: string;
}

/**
 * Represents a complete torrent with all its metadata and state.
 *
 * This is the primary interface for interacting with torrents
 * through the engine API.
 */
export interface Torrent {
  /** 40-character lowercase hex string uniquely identifying this torrent */
  infoHash: string;

  /** Display name of the torrent */
  name: string;

  /** Current state of the torrent */
  state: TorrentState;

  /** Download progress as a ratio (0-1, where 1 = 100% complete) */
  progress: number;

  /** Current download speed in bytes/second */
  downloadSpeed: number;

  /** Current upload speed in bytes/second */
  uploadSpeed: number;

  /** Total bytes downloaded so far */
  downloaded: number;

  /** Total bytes uploaded so far */
  uploaded: number;

  /** Total size of all files in bytes */
  size: number;

  /** Size of each piece in bytes */
  pieceLength: number;

  /** Total number of pieces */
  pieceCount: number;

  /** Number of connected peers (downloading or uploading) */
  peers: number;

  /** Number of connected seeds (peers with complete files) */
  seeds: number;

  /** Estimated time to completion in seconds, or null if unknown/not applicable */
  eta: number | null;

  /** List of files in this torrent */
  files: TorrentFile[];

  /** List of trackers for this torrent */
  trackers: TrackerInfo[];

  /** Timestamp when the torrent was added to the engine */
  addedAt: Date;

  /** Timestamp when the torrent completed downloading, or undefined if not complete */
  completedAt?: Date;

  /** Error message if state is ERROR, undefined otherwise */
  error?: string;

  /** Labels/categories assigned to this torrent */
  labels: string[];
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration options for the Torm engine.
 *
 * All speeds are in bytes/second. Use 0 for unlimited.
 */
export interface EngineConfig {
  /** Directory for storing application data (default: ~/.torm) */
  dataDir: string;

  /** Directory where downloaded files are saved (default: ~/.torm/downloads) */
  downloadPath: string;

  /** Maximum number of peer connections across all torrents (default: 50) */
  maxConnections: number;

  /** Maximum number of peer connections per torrent (default: 30) */
  maxConnectionsPerTorrent: number;

  /** Maximum upload speed in bytes/second (0 = unlimited, default: 0) */
  maxUploadSpeed: number;

  /** Maximum download speed in bytes/second (0 = unlimited, default: 0) */
  maxDownloadSpeed: number;

  /** Whether to enable DHT (Distributed Hash Table) for peer discovery (default: true) */
  dhtEnabled: boolean;

  /** Whether to enable PEX (Peer Exchange) for peer discovery (default: true) */
  pexEnabled: boolean;

  /** Port range for incoming connections [start, end] (default: [6881, 6889]) */
  portRange: [number, number];

  /** Preferred port for incoming connections within the range */
  port: number;

  /** Whether to verify existing data when adding a torrent (default: true) */
  verifyOnAdd: boolean;

  /** Whether to start downloading immediately when adding a torrent (default: true) */
  startOnAdd: boolean;

  /** Daemon configuration options */
  daemon: DaemonConfig;

  /**
   * Encryption mode for peer connections (MSE/PE)
   * - 'prefer': Try encrypted connection first, fall back to plaintext (default)
   * - 'require': Only accept encrypted connections
   * - 'disabled': Only use plaintext connections
   */
  encryptionMode: 'prefer' | 'require' | 'disabled';

  /** UI/TUI display configuration options */
  ui: UIConfig;
}

/**
 * Configuration options for the daemon process.
 */
export interface DaemonConfig {
  /** Enable background daemon mode (torrents continue after TUI exits) */
  enabled: boolean;

  /** Unix socket path for daemon IPC (default: /tmp/torm.sock) */
  socketPath: string;

  /** Auto-start daemon when TUI launches if not running */
  autoStart: boolean;

  /** Path to daemon log file */
  logFile: string;

  /** Path to daemon PID file */
  pidFile: string;
}

/**
 * Configuration options for the TUI display.
 */
export interface UIConfig {
  /** Minimum number of torrents visible in the scroll list (default: 8) */
  minVisibleTorrents: number;
}

/**
 * Global statistics for the engine.
 *
 * Provides aggregate information about all active torrents.
 */
export interface EngineStats {
  /** Total download speed across all torrents in bytes/second */
  totalDownloadSpeed: number;

  /** Total upload speed across all torrents in bytes/second */
  totalUploadSpeed: number;

  /** Number of torrents currently active (downloading or seeding) */
  activeTorrents: number;

  /** Total number of connected peers across all torrents */
  totalPeers: number;

  /** Total bytes downloaded across all torrents since engine start */
  sessionDownloaded: number;

  /** Total bytes uploaded across all torrents since engine start */
  sessionUploaded: number;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event map for the Torm engine.
 *
 * Subscribe to these events to receive notifications about
 * engine state changes, torrent progress, and peer activity.
 */
export interface TormEvents {
  // Engine lifecycle events
  /** Emitted when the engine has started successfully */
  'engine:started': () => void;

  /** Emitted when the engine has stopped */
  'engine:stopped': () => void;

  /** Emitted when the engine encounters a critical error */
  'engine:error': (error: Error) => void;

  // Torrent lifecycle events
  /** Emitted when a new torrent is added */
  'torrent:added': (torrent: Torrent) => void;

  /** Emitted when a torrent is removed */
  'torrent:removed': (infoHash: string) => void;

  /** Emitted when a torrent starts downloading */
  'torrent:started': (torrent: Torrent) => void;

  /** Emitted when a torrent is paused */
  'torrent:paused': (torrent: Torrent) => void;

  /** Emitted when a torrent completes downloading */
  'torrent:completed': (torrent: Torrent) => void;

  /** Emitted when a torrent encounters an error */
  'torrent:error': (torrent: Torrent, error: Error) => void;

  // Progress events (throttled to max 1/second per torrent)
  /** Emitted periodically with updated torrent progress */
  'torrent:progress': (torrent: Torrent) => void;

  // Piece events
  /** Emitted when a piece is successfully verified */
  'piece:verified': (infoHash: string, pieceIndex: number) => void;

  /** Emitted when a piece fails verification */
  'piece:failed': (infoHash: string, pieceIndex: number) => void;

  // Peer events
  /** Emitted when a new peer connects */
  'peer:connected': (infoHash: string, peer: Peer) => void;

  /** Emitted when a peer disconnects */
  'peer:disconnected': (infoHash: string, peer: Peer) => void;

  // Tracker events
  /** Emitted after a tracker announce */
  'tracker:announce': (infoHash: string, tracker: TrackerInfo) => void;

  /** Emitted when a tracker encounters an error */
  'tracker:error': (infoHash: string, tracker: TrackerInfo) => void;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Base error class for all Torm-specific errors.
 */
export class TormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TormError';
  }
}

/**
 * Error thrown when torrent metadata is invalid or cannot be parsed.
 */
export class MetadataError extends TormError {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataError';
  }
}

/**
 * Error thrown when tracker communication fails.
 */
export class TrackerError extends TormError {
  /** The tracker URL that failed */
  readonly trackerUrl: string;

  constructor(message: string, trackerUrl: string) {
    super(message);
    this.name = 'TrackerError';
    this.trackerUrl = trackerUrl;
  }
}

/**
 * Error thrown when a peer violates the BitTorrent protocol.
 */
export class PeerError extends TormError {
  /** The peer that caused the error */
  readonly peerId: string;

  constructor(message: string, peerId: string) {
    super(message);
    this.name = 'PeerError';
    this.peerId = peerId;
  }
}

/**
 * Error thrown when disk I/O operations fail.
 */
export class DiskError extends TormError {
  /** The file path that caused the error */
  readonly filePath: string;

  constructor(message: string, filePath: string) {
    super(message);
    this.name = 'DiskError';
    this.filePath = filePath;
  }
}

/**
 * Error thrown when disk is full (ENOSPC).
 */
export class DiskFullError extends DiskError {
  /** Required space in bytes */
  readonly requiredBytes: number;

  /** Available space in bytes (if known) */
  readonly availableBytes?: number;

  constructor(
    message: string,
    filePath: string,
    requiredBytes: number,
    availableBytes?: number
  ) {
    super(message, filePath);
    this.name = 'DiskFullError';
    this.requiredBytes = requiredBytes;
    this.availableBytes = availableBytes;
  }
}

/**
 * Error thrown when network/socket operations fail.
 */
export class NetworkError extends TormError {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Partial configuration for engine initialization.
 * All fields are optional with sensible defaults applied.
 */
export type PartialEngineConfig = Partial<EngineConfig>;

/**
 * Options for adding a torrent.
 */
export interface AddTorrentOptions {
  /** Override the default download path for this torrent */
  downloadPath?: string;

  /** Whether to start the torrent immediately (overrides engine config) */
  startImmediately?: boolean;

  /** Initial file priorities (indexed by file index) */
  filePriorities?: Map<number, FilePriority>;
}

/**
 * Source for adding a torrent - can be a magnet URI, .torrent file path,
 * or raw .torrent file contents as a Buffer.
 */
export type TorrentSource = string | Buffer;
