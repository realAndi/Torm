/**
 * TormEngine - Main public API for the Torm BitTorrent client.
 *
 * This class provides the primary interface for all torrent operations,
 * including adding/removing torrents, controlling downloads, and
 * subscribing to engine events.
 *
 * @module engine/TormEngine
 *
 * @example
 * ```typescript
 * import { TormEngine } from '@torm/engine';
 *
 * const engine = new TormEngine({
 *   downloadPath: '~/Downloads',
 *   maxConnections: 100,
 * });
 *
 * await engine.start();
 *
 * engine.on('torrent:added', ({ torrent }) => {
 *   console.log(`Added: ${torrent.name}`);
 * });
 *
 * const torrent = await engine.addTorrent('magnet:?xt=urn:btih:...');
 * console.log(`Downloading: ${torrent.name}`);
 *
 * await engine.stop();
 * ```
 */

import { readFile } from 'fs/promises';
import { unlinkSync } from 'fs';
import {
  TypedEventEmitter,
  TormEvents,
  type TormEventEmitter,
  Torrent as EventTorrent,
  FilePriority as EventFilePriority,
} from './events.js';
import { initializeGeoIP } from './geoip.js';
import {
  type Torrent,
  type EngineConfig,
  type EngineStats,
  type PartialEngineConfig,
  type TorrentSource,
  type AddTorrentOptions,
  TorrentState,
  FilePriority,
} from './types.js';
import { mergeWithDefaults } from './config/defaults.js';
import {
  AutoSaveManager,
  saveTorrentState,
  loadAllTorrentStates,
  extractCompletedPieces,
  saveConfig,
  loadConfig,
  getStateFilePath,
  type TorrentPersistenceInfo,
} from './session/persistence.js';
import {
  SessionManager,
  type TorrentSession,
  type SessionManagerOptions,
} from './session/manager.js';
import {
  parseTorrent,
  parseMagnetUri,
  type TorrentMetadata,
} from './torrent/parser.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate estimated time to completion
 */
function calculateEta(session: TorrentSession): number | null {
  if (session.state !== TorrentState.DOWNLOADING) {
    return null;
  }

  const remaining = session.totalSize - session.downloaded;
  const speed = session.downloadSpeed;

  if (speed <= 0 || remaining <= 0) {
    return null;
  }

  return Math.ceil(remaining / speed);
}

/**
 * Convert a TorrentSession to the public Torrent interface
 */
function sessionToTorrent(
  session: TorrentSession,
  labels: string[] = []
): Torrent {
  return {
    infoHash: session.infoHash,
    name: session.name,
    state: session.state,
    progress: session.progress,
    downloadSpeed: session.downloadSpeed,
    uploadSpeed: session.uploadSpeed,
    downloaded: session.downloaded,
    uploaded: session.uploaded,
    size: session.totalSize,
    pieceLength: session.metadata.pieceLength,
    pieceCount: session.metadata.pieceCount,
    peers: session.peers,
    seeds: session.seeds,
    eta: calculateEta(session),
    files: session.metadata.files.map((file, index) => ({
      path: file.path,
      size: file.length,
      downloaded: Math.round(file.length * session.progress),
      priority: FilePriority.Normal,
      index,
    })),
    trackers: session.trackers,
    addedAt: session.addedAt,
    completedAt: session.completedAt,
    error: session.error,
    labels,
  };
}

/**
 * Convert Torrent to the event Torrent type
 */
function torrentToEventTorrent(torrent: Torrent): EventTorrent {
  return {
    infoHash: torrent.infoHash,
    name: torrent.name,
    totalSize: torrent.size,
    pieceLength: torrent.pieceLength,
    pieceCount: torrent.pieceCount,
    files: torrent.files.map((f) => ({
      path: f.path,
      size: f.size,
      progress: f.size > 0 ? f.downloaded / f.size : 0,
      priority: f.priority as unknown as EventFilePriority,
    })),
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    progress: torrent.progress,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    peers: torrent.peers,
    seeds: torrent.seeds,
    state: torrent.state as unknown as EventTorrent['state'],
    error: torrent.error,
    addedAt: torrent.addedAt,
    completedAt: torrent.completedAt,
  };
}

// =============================================================================
// TormEngine Class
// =============================================================================

/**
 * The main entry point for all Torm torrent operations.
 *
 * TormEngine manages the lifecycle of torrents, handles peer connections,
 * and provides a unified API for torrent operations. It extends a typed
 * event emitter to provide type-safe event subscriptions.
 *
 * @remarks
 * - All async methods return Promises that resolve on success or reject with errors
 * - Event subscriptions are type-safe with full TypeScript support
 * - The engine must be started before adding or managing torrents
 * - Configuration can be partially specified; missing values use sensible defaults
 */
export class TormEngine {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** Internal event emitter for type-safe event handling */
  private readonly events: TormEventEmitter;

  /** Map of active torrents indexed by info hash */
  private readonly torrents: Map<string, Torrent>;

  /** Map of torrent labels indexed by info hash */
  private readonly labelsMap: Map<string, string[]>;

  /** Map of completed pieces per torrent (for persistence) */
  private readonly completedPiecesMap: Map<string, number[]>;

  /** Map of raw torrent data per torrent (for persistence) */
  private readonly torrentDataMap: Map<string, Buffer>;

  /** Current engine configuration */
  private config: EngineConfig;

  /** Whether the engine is currently running */
  private running: boolean;

  /** Session statistics tracking */
  private stats: EngineStats;

  /** Auto-save manager for periodic state persistence */
  private autoSaveManager: AutoSaveManager | null = null;

  /** Session manager for coordinating all subsystems */
  private sessionManager: SessionManager | null = null;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Creates a new TormEngine instance.
   *
   * @param config - Optional partial configuration. Missing values use defaults.
   *
   * @example
   * ```typescript
   * // Use all defaults
   * const engine = new TormEngine();
   *
   * // Override specific settings
   * const engine = new TormEngine({
   *   downloadPath: '/custom/downloads',
   *   maxConnections: 100,
   *   dhtEnabled: false,
   * });
   * ```
   */
  constructor(config?: PartialEngineConfig) {
    this.events = new TypedEventEmitter<TormEvents>();
    this.torrents = new Map();
    this.labelsMap = new Map();
    this.completedPiecesMap = new Map();
    this.torrentDataMap = new Map();
    this.config = mergeWithDefaults(config);
    this.running = false;
    this.stats = {
      totalDownloadSpeed: 0,
      totalUploadSpeed: 0,
      activeTorrents: 0,
      totalPeers: 0,
      sessionDownloaded: 0,
      sessionUploaded: 0,
    };
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Starts the engine and initializes all subsystems.
   *
   * This method initializes the network layer, DHT (if enabled),
   * and prepares the engine to accept torrent operations.
   *
   * @throws {Error} If the engine is already running
   * @throws {Error} If initialization fails
   *
   * @example
   * ```typescript
   * const engine = new TormEngine();
   * await engine.start();
   * console.log('Engine started');
   * ```
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Engine is already running');
    }

    // Load persisted config from disk and merge with current config
    const savedConfig = await loadConfig(this.config.dataDir);
    if (savedConfig) {
      this.config = {
        ...this.config,
        ...savedConfig,
        // Ensure portRange is a proper tuple
        portRange: Array.isArray(savedConfig.portRange)
          ? ([...savedConfig.portRange] as [number, number])
          : this.config.portRange,
      };
    }

    // Initialize GeoIP service for peer country lookups
    await initializeGeoIP();

    // Create session manager with engine configuration
    const sessionOptions: SessionManagerOptions = {
      downloadPath: this.config.downloadPath,
      maxConnections: this.config.maxConnections,
      maxConnectionsPerTorrent: this.config.maxConnectionsPerTorrent,
      maxDownloadSpeed: this.config.maxDownloadSpeed,
      maxUploadSpeed: this.config.maxUploadSpeed,
      port: this.config.port,
      startOnAdd: this.config.startOnAdd,
    };

    this.sessionManager = new SessionManager(sessionOptions);

    // Set up event forwarding from session manager
    this.setupEventForwarding();

    // Start the session manager
    await this.sessionManager.start();

    // Load persisted torrents from dataDir
    await this.loadPersistedTorrents();

    // Initialize auto-save manager
    this.autoSaveManager = new AutoSaveManager(this.config.dataDir, () =>
      this.getPersistenceState()
    );
    this.autoSaveManager.start();

    this.running = true;
    this.events.emit('engine:started');
  }

  /**
   * Stops the engine and cleans up all resources.
   *
   * This method gracefully disconnects all peers, saves torrent state,
   * and releases all system resources.
   *
   * @throws {Error} If the engine is not running
   *
   * @example
   * ```typescript
   * await engine.stop();
   * console.log('Engine stopped');
   * ```
   */
  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    // Stop auto-save manager
    if (this.autoSaveManager) {
      this.autoSaveManager.stop();
    }

    // Save all torrent states before stopping
    await this.saveAllTorrentStates();

    // Stop the session manager (which stops all subsystems)
    if (this.sessionManager) {
      await this.sessionManager.stop();
      this.sessionManager = null;
    }

    // Clear local state
    this.torrents.clear();
    this.labelsMap.clear();
    this.completedPiecesMap.clear();
    this.stats = {
      totalDownloadSpeed: 0,
      totalUploadSpeed: 0,
      activeTorrents: 0,
      totalPeers: 0,
      sessionDownloaded: 0,
      sessionUploaded: 0,
    };

    this.autoSaveManager = null;
    this.running = false;
    this.events.emit('engine:stopped');
  }

  // ===========================================================================
  // Torrent Management Methods
  // ===========================================================================

  /**
   * Adds a new torrent to the engine.
   *
   * The source can be:
   * - A magnet URI string (e.g., "magnet:?xt=urn:btih:...")
   * - A path to a .torrent file
   * - A Buffer containing raw .torrent file data
   *
   * @param source - Magnet URI, .torrent file path, or Buffer
   * @param options - Optional settings for this torrent
   * @returns The newly created Torrent object
   *
   * @throws {Error} If the engine is not running
   * @throws {MetadataError} If the torrent source is invalid
   * @throws {Error} If a torrent with the same info hash already exists
   *
   * @example
   * ```typescript
   * // Add from magnet URI
   * const torrent = await engine.addTorrent('magnet:?xt=urn:btih:...');
   *
   * // Add from file path
   * const torrent = await engine.addTorrent('/path/to/file.torrent');
   *
   * // Add with options
   * const torrent = await engine.addTorrent(magnetUri, {
   *   downloadPath: '/custom/path',
   *   startImmediately: false,
   * });
   * ```
   */
  async addTorrent(
    source: TorrentSource,
    options?: AddTorrentOptions
  ): Promise<Torrent> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    if (!this.sessionManager) {
      throw new Error('Session manager not initialized');
    }

    // Parse the torrent source to get metadata first for duplicate check
    let metadata: TorrentMetadata;
    let rawTorrentData: Buffer | undefined;

    if (typeof source === 'string') {
      if (source.startsWith('magnet:')) {
        // Parse the magnet URI
        const magnetData = parseMagnetUri(source);

        // Check if already exists before fetching
        if (this.torrents.has(magnetData.infoHashHex)) {
          throw new Error(`Torrent already exists: ${magnetData.infoHashHex}`);
        }

        // Try to fetch .torrent from exact source URL if available
        if (magnetData.exactSource) {
          try {
            const response = await fetch(magnetData.exactSource);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            rawTorrentData = Buffer.from(await response.arrayBuffer());
            metadata = parseTorrent(rawTorrentData);
          } catch (fetchError) {
            throw new Error(
              `Failed to fetch .torrent from ${magnetData.exactSource}: ${(fetchError as Error).message}. ` +
                `Full magnet URI support (metadata from peers) is not yet implemented.`
            );
          }
        } else {
          // No exact source - we need to fetch metadata from peers
          // This requires implementing BEP 9 (metadata extension)
          throw new Error(
            `This magnet URI has no exact source (xs=) for fetching the .torrent file. ` +
              `Full magnet URI support (fetching metadata from peers via BEP 9) is not yet implemented. ` +
              `Try using a magnet link that includes an xs= parameter pointing to a .torrent file.`
          );
        }
      } else {
        // File path - read and parse
        rawTorrentData = await readFile(source);
        metadata = parseTorrent(rawTorrentData);
      }
    } else if (Buffer.isBuffer(source)) {
      rawTorrentData = source;
      metadata = parseTorrent(source);
    } else {
      throw new Error('Invalid torrent source');
    }

    // Check if already exists
    if (this.torrents.has(metadata.infoHashHex)) {
      throw new Error(`Torrent already exists: ${metadata.infoHashHex}`);
    }

    // Add via session manager (pass metadata directly)
    const session = await this.sessionManager.addTorrent(metadata, {
      downloadPath: options?.downloadPath,
      startImmediately: options?.startImmediately,
    });

    // Initialize labels for this torrent
    this.labelsMap.set(session.infoHash, []);

    // Store raw torrent data for persistence
    if (rawTorrentData) {
      this.torrentDataMap.set(session.infoHash, rawTorrentData);
    }

    // Convert to public Torrent interface
    const torrent = sessionToTorrent(session, []);

    // Store in local map
    this.torrents.set(torrent.infoHash, torrent);

    // Emit event
    this.events.emit('torrent:added', {
      torrent: torrentToEventTorrent(torrent),
    });

    return torrent;
  }

  /**
   * Removes a torrent from the engine.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   * @param deleteFiles - Whether to also delete downloaded files (default: false)
   *
   * @throws {Error} If the engine is not running
   * @throws {Error} If no torrent with the given info hash exists
   *
   * @example
   * ```typescript
   * // Remove torrent but keep files
   * await engine.removeTorrent('a1b2c3d4...');
   *
   * // Remove torrent and delete files
   * await engine.removeTorrent('a1b2c3d4...', true);
   * ```
   */
  async removeTorrent(infoHash: string, deleteFiles = false): Promise<void> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    // Remove from internal maps FIRST to allow immediate re-add
    // This prevents "torrent already exists" errors if user re-adds quickly
    this.torrents.delete(infoHash);
    this.labelsMap.delete(infoHash);
    this.completedPiecesMap.delete(infoHash);
    this.torrentDataMap.delete(infoHash);

    // Emit event early so UI updates immediately
    this.events.emit('torrent:removed', { infoHash });

    // Clear tracking in auto-save manager
    if (this.autoSaveManager) {
      this.autoSaveManager.clearTracking(infoHash);
    }

    // Delete persisted state FIRST (synchronously) to ensure removal even if session cleanup fails
    // This prevents the torrent from reappearing on restart if file deletion takes too long or fails
    try {
      const stateFilePath = getStateFilePath(this.config.dataDir, infoHash);
      unlinkSync(stateFilePath);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        console.error(
          `Failed to delete persisted state for ${infoHash}:`,
          error.message
        );
      }
    }

    // Remove via session manager (may involve file I/O for downloaded files)
    if (this.sessionManager) {
      try {
        await this.sessionManager.removeTorrent(infoHash, deleteFiles);
      } catch (err) {
        // Log but don't fail - state file is already deleted
        console.error(
          `Session manager cleanup failed for ${infoHash}:`,
          (err as Error).message
        );
      }
    }
  }

  // ===========================================================================
  // Torrent Control Methods
  // ===========================================================================

  /**
   * Starts a queued or paused torrent.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   *
   * @throws {Error} If the engine is not running
   * @throws {Error} If no torrent with the given info hash exists
   * @throws {Error} If the torrent is already active
   *
   * @example
   * ```typescript
   * await engine.startTorrent('a1b2c3d4...');
   * ```
   */
  async startTorrent(infoHash: string): Promise<void> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    if (
      torrent.state === TorrentState.DOWNLOADING ||
      torrent.state === TorrentState.SEEDING
    ) {
      throw new Error('Torrent is already active');
    }

    // Start via session manager
    if (this.sessionManager) {
      await this.sessionManager.startTorrent(infoHash);
    }

    // Refresh local state from session
    this.refreshTorrentState(infoHash);

    // Emit event
    this.events.emit('torrent:started', { infoHash });
  }

  /**
   * Pauses an active torrent.
   *
   * Disconnects all peers and stops downloading/uploading,
   * but retains the torrent in the engine for later resumption.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   *
   * @throws {Error} If the engine is not running
   * @throws {Error} If no torrent with the given info hash exists
   * @throws {Error} If the torrent is already paused
   *
   * @example
   * ```typescript
   * await engine.pauseTorrent('a1b2c3d4...');
   * ```
   */
  async pauseTorrent(infoHash: string): Promise<void> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    if (torrent.state === TorrentState.PAUSED) {
      throw new Error('Torrent is already paused');
    }

    // Pause via session manager
    if (this.sessionManager) {
      await this.sessionManager.pauseTorrent(infoHash);
    }

    // Refresh local state from session
    this.refreshTorrentState(infoHash);

    // Emit event
    this.events.emit('torrent:paused', { infoHash });
  }

  /**
   * Resumes a paused torrent.
   *
   * Reconnects to peers and resumes downloading/uploading.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   *
   * @throws {Error} If the engine is not running
   * @throws {Error} If no torrent with the given info hash exists
   * @throws {Error} If the torrent is not paused
   *
   * @example
   * ```typescript
   * await engine.resumeTorrent('a1b2c3d4...');
   * ```
   */
  async resumeTorrent(infoHash: string): Promise<void> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    if (torrent.state !== TorrentState.PAUSED) {
      throw new Error('Torrent is not paused');
    }

    // Resume via session manager (uses startTorrent for paused torrents)
    if (this.sessionManager) {
      await this.sessionManager.startTorrent(infoHash);
    }

    // Refresh local state from session
    this.refreshTorrentState(infoHash);

    // Emit event
    this.events.emit('torrent:resumed', { infoHash });
  }

  /**
   * Force re-verification of a torrent's pieces.
   *
   * Re-checks all pieces on disk and updates state. If all pieces
   * are verified, transitions to seeding state.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   */
  async verifyTorrent(infoHash: string): Promise<void> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    if (!this.sessionManager) {
      throw new Error('Session manager not initialized');
    }

    const session = this.sessionManager.getTorrent(infoHash);
    if (!session) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    await session.verify();

    // Refresh local state
    this.refreshTorrentState(infoHash);
  }

  // ===========================================================================
  // Label Management Methods
  // ===========================================================================

  /**
   * Adds a label to a torrent.
   *
   * Labels are simple strings used to categorize torrents (e.g., "movies", "music").
   * If the label already exists on the torrent, this is a no-op.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   * @param label - The label to add (will be trimmed and lowercased)
   *
   * @throws {Error} If the engine is not running
   * @throws {Error} If no torrent with the given info hash exists
   *
   * @example
   * ```typescript
   * await engine.addLabel('a1b2c3d4...', 'movies');
   * await engine.addLabel('a1b2c3d4...', 'hd');
   * ```
   */
  async addLabel(infoHash: string, label: string): Promise<void> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    const normalizedLabel = label.trim().toLowerCase();
    if (normalizedLabel.length === 0) {
      return; // Ignore empty labels
    }

    const labels = this.labelsMap.get(infoHash) ?? [];
    if (!labels.includes(normalizedLabel)) {
      labels.push(normalizedLabel);
      this.labelsMap.set(infoHash, labels);
      torrent.labels = labels;
    }
  }

  /**
   * Removes a label from a torrent.
   *
   * If the label does not exist on the torrent, this is a no-op.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   * @param label - The label to remove
   *
   * @throws {Error} If the engine is not running
   * @throws {Error} If no torrent with the given info hash exists
   *
   * @example
   * ```typescript
   * await engine.removeLabel('a1b2c3d4...', 'movies');
   * ```
   */
  async removeLabel(infoHash: string, label: string): Promise<void> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    const normalizedLabel = label.trim().toLowerCase();
    const labels = this.labelsMap.get(infoHash) ?? [];
    const index = labels.indexOf(normalizedLabel);
    if (index !== -1) {
      labels.splice(index, 1);
      this.labelsMap.set(infoHash, labels);
      torrent.labels = labels;
    }
  }

  /**
   * Gets all unique labels across all torrents.
   *
   * @returns Array of unique label strings, sorted alphabetically
   *
   * @example
   * ```typescript
   * const labels = engine.getLabels();
   * console.log(`Available labels: ${labels.join(', ')}`);
   * // Output: "games, movies, music, tv"
   * ```
   */
  getLabels(): string[] {
    const labelSet = new Set<string>();
    for (const labels of this.labelsMap.values()) {
      for (const label of labels) {
        labelSet.add(label);
      }
    }
    return Array.from(labelSet).sort();
  }

  /**
   * Sets all labels for a torrent, replacing any existing labels.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   * @param labels - Array of labels to set
   *
   * @throws {Error} If the engine is not running
   * @throws {Error} If no torrent with the given info hash exists
   *
   * @example
   * ```typescript
   * await engine.setLabels('a1b2c3d4...', ['movies', 'hd', '2024']);
   * ```
   */
  async setLabels(infoHash: string, labels: string[]): Promise<void> {
    if (!this.running) {
      throw new Error('Engine is not running');
    }

    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    // Normalize and deduplicate labels
    const normalizedLabels = [
      ...new Set(
        labels.map((l) => l.trim().toLowerCase()).filter((l) => l.length > 0)
      ),
    ];

    this.labelsMap.set(infoHash, normalizedLabels);
    torrent.labels = normalizedLabels;
  }

  // ===========================================================================
  // Getter Methods
  // ===========================================================================

  /**
   * Gets a torrent by its info hash.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   * @returns The Torrent object, or undefined if not found
   *
   * @example
   * ```typescript
   * const torrent = engine.getTorrent('a1b2c3d4...');
   * if (torrent) {
   *   console.log(`Progress: ${torrent.progress * 100}%`);
   * }
   * ```
   */
  getTorrent(infoHash: string): Torrent | undefined {
    // Refresh from session manager for up-to-date data
    this.refreshTorrentState(infoHash);
    return this.torrents.get(infoHash);
  }

  /**
   * Gets connected peers for a torrent.
   *
   * @param infoHash - The 40-character hex info hash of the torrent
   * @returns Array of connected Peer objects, or empty array if torrent not found
   *
   * @example
   * ```typescript
   * const peers = engine.getPeers('a1b2c3d4...');
   * for (const peer of peers) {
   *   console.log(`${peer.ip}:${peer.port} - ${peer.client}`);
   * }
   * ```
   */
  getPeers(infoHash: string): import('./types.js').Peer[] {
    if (!this.sessionManager) {
      return [];
    }

    const session = this.sessionManager.getTorrent(infoHash);
    if (!session) {
      return [];
    }

    return session.getConnectedPeers();
  }

  /**
   * Gets all torrents currently managed by the engine.
   *
   * @returns Array of all Torrent objects
   *
   * @example
   * ```typescript
   * const torrents = engine.getAllTorrents();
   * console.log(`Managing ${torrents.length} torrents`);
   *
   * for (const torrent of torrents) {
   *   console.log(`${torrent.name}: ${torrent.state}`);
   * }
   * ```
   */
  getAllTorrents(): Torrent[] {
    // Refresh all torrents from session manager
    if (this.sessionManager) {
      const sessions = this.sessionManager.getAllTorrents();
      for (const session of sessions) {
        const labels = this.labelsMap.get(session.infoHash) ?? [];
        const updatedTorrent = sessionToTorrent(session, labels);
        this.torrents.set(session.infoHash, updatedTorrent);
      }
    }
    return Array.from(this.torrents.values());
  }

  /**
   * Gets aggregate statistics for the engine.
   *
   * @returns Current engine statistics
   *
   * @example
   * ```typescript
   * const stats = engine.getStats();
   * console.log(`Download: ${stats.totalDownloadSpeed} B/s`);
   * console.log(`Upload: ${stats.totalUploadSpeed} B/s`);
   * console.log(`Peers: ${stats.totalPeers}`);
   * ```
   */
  getStats(): EngineStats {
    // Get fresh stats from session manager if available
    if (this.sessionManager) {
      this.stats = this.sessionManager.getStats();
    }
    return { ...this.stats };
  }

  /**
   * Gets the current engine configuration.
   *
   * @returns A copy of the current configuration
   *
   * @example
   * ```typescript
   * const config = engine.getConfig();
   * console.log(`Download path: ${config.downloadPath}`);
   * console.log(`Max connections: ${config.maxConnections}`);
   * ```
   */
  getConfig(): EngineConfig {
    return {
      ...this.config,
      portRange: [...this.config.portRange] as [number, number],
    };
  }

  /**
   * Updates the engine configuration.
   *
   * Only the provided fields will be updated; other fields retain their current values.
   * Some configuration changes (like bandwidth limits) take effect immediately,
   * while others (like connection limits) may require an engine restart.
   *
   * @param config - Partial configuration with values to update
   *
   * @example
   * ```typescript
   * // Update download speed limit
   * await engine.updateConfig({ maxDownloadSpeed: 1024 * 1024 }); // 1 MB/s
   *
   * // Update multiple settings
   * await engine.updateConfig({
   *   maxConnections: 100,
   *   dhtEnabled: false,
   * });
   * ```
   */
  async updateConfig(config: PartialEngineConfig): Promise<void> {
    // Merge new config with existing
    this.config = {
      ...this.config,
      ...config,
      // Handle portRange specially to ensure it's a proper tuple
      portRange: config.portRange
        ? ([...config.portRange] as [number, number])
        : this.config.portRange,
    };

    // Update session manager if running (for settings that can be changed at runtime)
    if (this.sessionManager && this.running) {
      await this.sessionManager.updateConfig(config);
    }

    // Persist config to disk (save only user-modifiable settings)
    const persistedConfig: Record<string, unknown> = {
      downloadPath: this.config.downloadPath,
      maxConnections: this.config.maxConnections,
      maxConnectionsPerTorrent: this.config.maxConnectionsPerTorrent,
      maxDownloadSpeed: this.config.maxDownloadSpeed,
      maxUploadSpeed: this.config.maxUploadSpeed,
      maxActiveTorrents: this.config.maxActiveTorrents,
      dhtEnabled: this.config.dhtEnabled,
      pexEnabled: this.config.pexEnabled,
      portRange: this.config.portRange,
      startOnAdd: this.config.startOnAdd,
    };
    await saveConfig(persistedConfig, this.config.dataDir);
  }

  /**
   * Checks if the engine is currently running.
   *
   * @returns true if the engine is running, false otherwise
   *
   * @example
   * ```typescript
   * if (engine.isRunning()) {
   *   await engine.addTorrent(magnetUri);
   * }
   * ```
   */
  isRunning(): boolean {
    return this.running;
  }

  // ===========================================================================
  // Event Methods
  // ===========================================================================

  /**
   * Subscribes to an engine event.
   *
   * @param event - The event name to subscribe to
   * @param listener - Callback function invoked when the event is emitted
   * @returns this for method chaining
   *
   * @example
   * ```typescript
   * engine.on('torrent:added', ({ torrent }) => {
   *   console.log(`Added: ${torrent.name}`);
   * });
   *
   * engine.on('torrent:progress', ({ infoHash, progress }) => {
   *   console.log(`${infoHash}: ${(progress * 100).toFixed(1)}%`);
   * });
   * ```
   */
  on<K extends keyof TormEvents>(
    event: K,
    listener: TormEvents[K] extends void
      ? () => void
      : (payload: TormEvents[K]) => void
  ): this {
    this.events.on(event, listener);
    return this;
  }

  /**
   * Subscribes to an engine event once.
   *
   * The listener is automatically removed after the first invocation.
   *
   * @param event - The event name to subscribe to
   * @param listener - Callback function invoked when the event is emitted
   * @returns this for method chaining
   *
   * @example
   * ```typescript
   * engine.once('torrent:completed', ({ torrent }) => {
   *   console.log(`Completed: ${torrent.name}`);
   * });
   * ```
   */
  once<K extends keyof TormEvents>(
    event: K,
    listener: TormEvents[K] extends void
      ? () => void
      : (payload: TormEvents[K]) => void
  ): this {
    this.events.once(event, listener);
    return this;
  }

  /**
   * Unsubscribes from an engine event.
   *
   * @param event - The event name to unsubscribe from
   * @param listener - The listener function to remove
   * @returns this for method chaining
   *
   * @example
   * ```typescript
   * const handler = ({ torrent }) => console.log(torrent.name);
   * engine.on('torrent:added', handler);
   *
   * // Later...
   * engine.off('torrent:added', handler);
   * ```
   */
  off<K extends keyof TormEvents>(
    event: K,
    listener: TormEvents[K] extends void
      ? () => void
      : (payload: TormEvents[K]) => void
  ): this {
    this.events.off(event, listener);
    return this;
  }

  /**
   * Waits for an event to be emitted.
   *
   * Returns a promise that resolves with the event payload
   * when the event is next emitted.
   *
   * @param event - The event name to wait for
   * @returns Promise resolving to the event payload
   *
   * @example
   * ```typescript
   * // Wait for engine to start
   * await engine.waitFor('engine:started');
   *
   * // Wait for a specific torrent to complete
   * const { torrent } = await engine.waitFor('torrent:completed');
   * console.log(`Completed: ${torrent.name}`);
   * ```
   */
  waitFor<K extends keyof TormEvents>(event: K): Promise<TormEvents[K]> {
    return this.events.waitFor(event);
  }

  // ===========================================================================
  // Persistence Methods
  // ===========================================================================

  /**
   * Saves state for a specific torrent.
   *
   * Called automatically on significant progress changes and engine stop.
   * Can also be called manually for immediate persistence.
   *
   * @param infoHash - The torrent info hash
   */
  async saveTorrentState(infoHash: string): Promise<void> {
    const torrent = this.torrents.get(infoHash);
    if (!torrent) {
      return;
    }

    const completedPieces = this.completedPiecesMap.get(infoHash) ?? [];
    const info = this.torrentToPersistenceInfo(torrent);

    try {
      await saveTorrentState(info, completedPieces, this.config.dataDir);
    } catch (err) {
      console.error(
        `Failed to save torrent state for ${infoHash}:`,
        (err as Error).message
      );
    }
  }

  /**
   * Forces an immediate save of all torrent states.
   *
   * Useful before performing operations that might fail or for
   * ensuring state is persisted at a specific point.
   */
  async saveAllTorrentStates(): Promise<void> {
    if (this.autoSaveManager) {
      await this.autoSaveManager.saveAll();
    } else {
      // Fallback if auto-save manager not available
      for (const infoHash of this.torrents.keys()) {
        await this.saveTorrentState(infoHash);
      }
    }
  }

  /**
   * Updates the completed pieces for a torrent.
   *
   * Should be called when pieces are verified/completed during download.
   *
   * @param infoHash - The torrent info hash
   * @param completedPieces - Array of completed piece indices
   */
  updateCompletedPieces(infoHash: string, completedPieces: number[]): void {
    this.completedPiecesMap.set(infoHash, [...completedPieces]);
  }

  /**
   * Gets the completed pieces for a torrent.
   *
   * @param infoHash - The torrent info hash
   * @returns Array of completed piece indices, or empty array if not found
   */
  getCompletedPieces(infoHash: string): number[] {
    return this.completedPiecesMap.get(infoHash) ?? [];
  }

  // ===========================================================================
  // Private Methods - Event Forwarding
  // ===========================================================================

  /**
   * Set up event forwarding from session manager to engine events
   */
  private setupEventForwarding(): void {
    if (!this.sessionManager) {
      return;
    }

    // Forward torrent state changed events
    this.sessionManager.on('torrentStateChanged', ({ infoHash, state }) => {
      this.refreshTorrentState(infoHash);

      const torrent = this.torrents.get(infoHash);
      if (torrent) {
        // Emit completion event when transitioning to seeding with full progress
        if (state === TorrentState.SEEDING && torrent.progress >= 1) {
          this.events.emit('torrent:completed', {
            torrent: torrentToEventTorrent(torrent),
          });
        }
      }
    });

    // Forward stats updates to keep local stats current
    this.sessionManager.on('statsUpdated', ({ stats }) => {
      this.stats = { ...stats };
    });

    // Forward errors
    this.sessionManager.on('error', ({ error }) => {
      this.events.emit('engine:error', { error });
    });

    // Forward progress updates
    this.sessionManager.on('torrentProgress', (data) => {
      // Also refresh the local torrent state
      this.refreshTorrentState(data.infoHash);

      this.events.emit('torrent:progress', {
        infoHash: data.infoHash,
        progress: data.progress,
        downloadSpeed: data.downloadSpeed,
        uploadSpeed: data.uploadSpeed,
        peers: data.peers,
      });
    });

    // Track completed pieces for persistence
    this.sessionManager.on('pieceComplete', ({ infoHash, pieceIndex }) => {
      const completedPieces = this.completedPiecesMap.get(infoHash) ?? [];
      if (!completedPieces.includes(pieceIndex)) {
        completedPieces.push(pieceIndex);
        this.completedPiecesMap.set(infoHash, completedPieces);
      }
    });
  }

  /**
   * Refresh torrent state from session manager
   */
  private refreshTorrentState(infoHash: string): void {
    if (!this.sessionManager) {
      return;
    }

    const session = this.sessionManager.getTorrent(infoHash);
    if (session) {
      const labels = this.labelsMap.get(infoHash) ?? [];
      const updatedTorrent = sessionToTorrent(session, labels);
      this.torrents.set(infoHash, updatedTorrent);
    }
  }

  // ===========================================================================
  // Private Persistence Methods
  // ===========================================================================

  /**
   * Loads all persisted torrents from disk.
   *
   * Called during engine start.
   */
  private async loadPersistedTorrents(): Promise<void> {
    if (!this.sessionManager) {
      return;
    }

    try {
      const savedStates = await loadAllTorrentStates(this.config.dataDir);

      for (const state of savedStates) {
        try {
          // Skip if torrent data is not available (can't re-add without metadata)
          if (!state.torrentData) {
            console.warn(
              `Skipping persisted torrent ${state.infoHash}: no torrent data available`
            );
            continue;
          }

          // Parse the stored torrent data
          const torrentBuffer = Buffer.from(state.torrentData, 'base64');
          const metadata = parseTorrent(torrentBuffer);

          // Check if already exists (might have been added via session manager)
          if (this.torrents.has(metadata.infoHashHex)) {
            continue;
          }

          // Determine if torrent should auto-start based on saved state
          const wasActive =
            state.state === TorrentState.DOWNLOADING ||
            state.state === TorrentState.SEEDING;

          // Add to session manager
          const session = await this.sessionManager.addTorrent(metadata, {
            downloadPath: state.downloadPath,
            startImmediately: wasActive,
          });

          // Extract completed pieces from persisted bitfield
          const completedPieces = extractCompletedPieces(
            state.bitfield,
            state.pieceCount
          );
          this.completedPiecesMap.set(session.infoHash, completedPieces);

          // Store raw torrent data for future persistence
          this.torrentDataMap.set(session.infoHash, torrentBuffer);

          // Initialize labels (empty for now - could be persisted in state file)
          this.labelsMap.set(session.infoHash, []);

          // Create the Torrent from session
          const torrent = sessionToTorrent(session, []);

          // Restore some state from persisted data
          torrent.downloaded = state.downloaded;
          torrent.uploaded = state.uploaded;

          this.torrents.set(torrent.infoHash, torrent);
        } catch (err) {
          console.error(
            `Failed to restore torrent ${state.infoHash}:`,
            (err as Error).message
          );
        }
      }

      if (savedStates.length > 0) {
        console.log(`Loaded ${savedStates.length} persisted torrent(s)`);
      }
    } catch (err) {
      console.error(
        'Failed to load persisted torrents:',
        (err as Error).message
      );
    }
  }

  /**
   * Gets the current state for persistence.
   *
   * Used by the AutoSaveManager callback.
   */
  private getPersistenceState(): {
    torrents: Array<{
      info: TorrentPersistenceInfo;
      completedPieces: number[];
    }>;
  } {
    const torrents: Array<{
      info: TorrentPersistenceInfo;
      completedPieces: number[];
    }> = [];

    for (const [infoHash, torrent] of this.torrents) {
      torrents.push({
        info: this.torrentToPersistenceInfo(torrent),
        completedPieces: this.completedPiecesMap.get(infoHash) ?? [],
      });
    }

    return { torrents };
  }

  /**
   * Converts a Torrent to TorrentPersistenceInfo.
   */
  private torrentToPersistenceInfo(torrent: Torrent): TorrentPersistenceInfo {
    return {
      infoHash: torrent.infoHash,
      name: torrent.name,
      state: torrent.state,
      downloadPath: this.config.downloadPath,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      totalSize: torrent.size,
      pieceLength: torrent.pieceLength,
      pieceCount: torrent.pieceCount,
      addedAt: torrent.addedAt,
      completedAt: torrent.completedAt,
      error: torrent.error,
      torrentData: this.torrentDataMap.get(torrent.infoHash),
    };
  }
}
