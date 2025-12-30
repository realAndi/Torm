/**
 * State Persistence for Torm BitTorrent Client
 *
 * Handles saving and loading torrent state to/from disk for resume capability.
 * Stores per-torrent state in JSON format in the data directory.
 *
 * File format: ~/.torm/torrents/{infoHash}.json
 *
 * @module engine/session/persistence
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { TorrentState } from '../types.js';
import { expandPath } from '../../utils/platform.js';

// =============================================================================
// Constants
// =============================================================================

/** Directory name for storing torrent state files */
const TORRENTS_DIR = 'torrents';

/** File extension for torrent state files */
const STATE_FILE_EXT = '.json';

/** Current state file format version */
const STATE_VERSION = 1;

/** Default auto-save interval in milliseconds (30 seconds) */
export const DEFAULT_AUTO_SAVE_INTERVAL = 30000;

// =============================================================================
// Types
// =============================================================================

/**
 * Persisted torrent state stored on disk
 */
export interface PersistedTorrentState {
  /** Format version for future migrations */
  version: number;

  /** 40-character hex info hash */
  infoHash: string;

  /** Torrent display name */
  name: string;

  /** Torrent state at time of save */
  state: TorrentState;

  /** Directory where files are downloaded */
  downloadPath: string;

  /** Base64-encoded bitfield of completed pieces */
  completedPiecesBitfield: string;

  /** Total bytes downloaded */
  downloaded: number;

  /** Total bytes uploaded */
  uploaded: number;

  /** Total torrent size in bytes */
  totalSize: number;

  /** Piece length in bytes */
  pieceLength: number;

  /** Total number of pieces */
  pieceCount: number;

  /** Timestamp when torrent was added */
  addedAt: string;

  /** Timestamp when download completed, if applicable */
  completedAt?: string;

  /** Error message if state is ERROR */
  error?: string;

  /** Timestamp when state was last saved */
  savedAt: string;

  /** Original .torrent file data as base64 (if available) */
  torrentData?: string;

  /** Magnet URI (if added via magnet) */
  magnetUri?: string;
}

/**
 * Minimal torrent info needed for persistence
 */
export interface TorrentPersistenceInfo {
  infoHash: string;
  name: string;
  state: TorrentState;
  downloadPath: string;
  downloaded: number;
  uploaded: number;
  totalSize: number;
  pieceLength: number;
  pieceCount: number;
  addedAt: Date;
  completedAt?: Date;
  error?: string;
  torrentData?: Buffer;
  magnetUri?: string;
}

/**
 * Result of loading torrent state
 */
export interface LoadedTorrentState extends PersistedTorrentState {
  /** Decoded bitfield as Buffer */
  bitfield: Buffer;
}

// =============================================================================
// Persistence Functions
// =============================================================================

/**
 * Ensures the torrents directory exists
 *
 * @param dataDir - Base data directory (e.g., ~/.torm)
 * @returns Path to torrents directory
 */
async function ensureTorrentsDir(dataDir: string): Promise<string> {
  const resolvedDataDir = expandPath(dataDir);
  const torrentsDir = path.join(resolvedDataDir, TORRENTS_DIR);

  try {
    await fs.mkdir(torrentsDir, { recursive: true });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'EEXIST') {
      throw new Error(`Failed to create torrents directory: ${error.message}`);
    }
  }

  return torrentsDir;
}

/**
 * Gets the state file path for a torrent
 *
 * @param dataDir - Base data directory
 * @param infoHash - Torrent info hash
 * @returns Path to state file
 */
function getStateFilePath(dataDir: string, infoHash: string): string {
  const resolvedDataDir = expandPath(dataDir);
  return path.join(
    resolvedDataDir,
    TORRENTS_DIR,
    `${infoHash}${STATE_FILE_EXT}`
  );
}

/**
 * Creates a bitfield from completed piece indices
 *
 * @param completedPieces - Array of completed piece indices
 * @param pieceCount - Total number of pieces
 * @returns Bitfield buffer
 */
export function createBitfield(
  completedPieces: number[],
  pieceCount: number
): Buffer {
  const byteCount = Math.ceil(pieceCount / 8);
  const bitfield = Buffer.alloc(byteCount, 0);

  for (const pieceIndex of completedPieces) {
    if (pieceIndex >= 0 && pieceIndex < pieceCount) {
      const byteIndex = Math.floor(pieceIndex / 8);
      const bitIndex = 7 - (pieceIndex % 8);
      bitfield[byteIndex] |= 1 << bitIndex;
    }
  }

  return bitfield;
}

/**
 * Extracts completed piece indices from a bitfield
 *
 * @param bitfield - Bitfield buffer
 * @param pieceCount - Total number of pieces
 * @returns Array of completed piece indices
 */
export function extractCompletedPieces(
  bitfield: Buffer,
  pieceCount: number
): number[] {
  const completedPieces: number[] = [];

  for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex++) {
    const byteIndex = Math.floor(pieceIndex / 8);
    const bitIndex = 7 - (pieceIndex % 8);

    if (
      byteIndex < bitfield.length &&
      (bitfield[byteIndex] & (1 << bitIndex)) !== 0
    ) {
      completedPieces.push(pieceIndex);
    }
  }

  return completedPieces;
}

/**
 * Saves torrent state to disk
 *
 * @param torrent - Torrent info to persist
 * @param completedPieces - Array of completed piece indices
 * @param dataDir - Base data directory
 */
export async function saveTorrentState(
  torrent: TorrentPersistenceInfo,
  completedPieces: number[],
  dataDir: string
): Promise<void> {
  await ensureTorrentsDir(dataDir);

  const bitfield = createBitfield(completedPieces, torrent.pieceCount);

  const state: PersistedTorrentState = {
    version: STATE_VERSION,
    infoHash: torrent.infoHash,
    name: torrent.name,
    state: torrent.state,
    downloadPath: torrent.downloadPath,
    completedPiecesBitfield: bitfield.toString('base64'),
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    totalSize: torrent.totalSize,
    pieceLength: torrent.pieceLength,
    pieceCount: torrent.pieceCount,
    addedAt: torrent.addedAt.toISOString(),
    completedAt: torrent.completedAt?.toISOString(),
    error: torrent.error,
    savedAt: new Date().toISOString(),
    torrentData: torrent.torrentData?.toString('base64'),
    magnetUri: torrent.magnetUri,
  };

  const filePath = getStateFilePath(dataDir, torrent.infoHash);
  const tempPath = `${filePath}.tmp`;

  try {
    // Write to temp file first for atomic operation
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');

    // Rename to final path (atomic on most file systems)
    await fs.rename(tempPath, filePath);
  } catch (err) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(`Failed to save torrent state: ${(err as Error).message}`);
  }
}

/**
 * Loads torrent state from disk
 *
 * @param infoHash - Torrent info hash
 * @param dataDir - Base data directory
 * @returns Loaded torrent state or null if not found
 */
export async function loadTorrentState(
  infoHash: string,
  dataDir: string
): Promise<LoadedTorrentState | null> {
  const filePath = getStateFilePath(dataDir, infoHash);

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const state = JSON.parse(data) as PersistedTorrentState;

    // Validate version
    if (state.version !== STATE_VERSION) {
      console.warn(
        `Torrent state version mismatch for ${infoHash}: expected ${STATE_VERSION}, got ${state.version}`
      );
      // Future: Add migration logic here
    }

    // Validate required fields
    if (!state.infoHash || !state.name) {
      throw new Error('Invalid state file: missing required fields');
    }

    // Decode bitfield
    const bitfield = Buffer.from(state.completedPiecesBitfield, 'base64');

    return {
      ...state,
      bitfield,
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return null; // File doesn't exist
    }
    throw new Error(`Failed to load torrent state: ${error.message}`);
  }
}

/**
 * Loads all saved torrent states from disk
 *
 * @param dataDir - Base data directory
 * @returns Array of loaded torrent states
 */
export async function loadAllTorrentStates(
  dataDir: string
): Promise<LoadedTorrentState[]> {
  const torrentsDir = await ensureTorrentsDir(dataDir);
  const states: LoadedTorrentState[] = [];

  try {
    const files = await fs.readdir(torrentsDir);

    for (const file of files) {
      if (!file.endsWith(STATE_FILE_EXT)) {
        continue;
      }

      const infoHash = file.slice(0, -STATE_FILE_EXT.length);

      try {
        const state = await loadTorrentState(infoHash, dataDir);
        if (state) {
          states.push(state);
        }
      } catch (err) {
        console.error(
          `Failed to load torrent state for ${infoHash}:`,
          (err as Error).message
        );
        // Continue loading other torrents
      }
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      throw new Error(`Failed to read torrents directory: ${error.message}`);
    }
  }

  return states;
}

/**
 * Deletes torrent state from disk
 *
 * @param infoHash - Torrent info hash
 * @param dataDir - Base data directory
 */
export async function deleteTorrentState(
  infoHash: string,
  dataDir: string
): Promise<void> {
  const filePath = getStateFilePath(dataDir, infoHash);

  try {
    await fs.unlink(filePath);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      throw new Error(`Failed to delete torrent state: ${error.message}`);
    }
    // Ignore if file doesn't exist
  }
}

/**
 * Checks if torrent state exists on disk
 *
 * @param infoHash - Torrent info hash
 * @param dataDir - Base data directory
 * @returns true if state file exists
 */
export async function torrentStateExists(
  infoHash: string,
  dataDir: string
): Promise<boolean> {
  const filePath = getStateFilePath(dataDir, infoHash);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Config Persistence
// =============================================================================

/** Config file name */
const CONFIG_FILE = 'config.json';

/**
 * Saves engine configuration to disk
 *
 * @param config - Configuration to save (partial, only user-modified values)
 * @param dataDir - Base data directory
 */
export async function saveConfig(
  config: Record<string, unknown>,
  dataDir: string
): Promise<void> {
  const resolvedDataDir = expandPath(dataDir);
  const configPath = path.join(resolvedDataDir, CONFIG_FILE);

  // Ensure data directory exists
  await fs.mkdir(resolvedDataDir, { recursive: true });

  const tempPath = `${configPath}.tmp`;

  try {
    await fs.writeFile(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    await fs.rename(tempPath, configPath);
  } catch (err) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Loads engine configuration from disk
 *
 * @param dataDir - Base data directory
 * @returns Loaded configuration or null if not found
 */
export async function loadConfig(
  dataDir: string
): Promise<Record<string, unknown> | null> {
  const resolvedDataDir = expandPath(dataDir);
  const configPath = path.join(resolvedDataDir, CONFIG_FILE);

  try {
    const data = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return null; // Config file doesn't exist yet
    }
    throw err;
  }
}

// =============================================================================
// Auto-Save Manager
// =============================================================================

/**
 * Callback for getting current torrent state
 */
export type GetTorrentStateCallback = () => {
  torrents: Array<{
    info: TorrentPersistenceInfo;
    completedPieces: number[];
  }>;
};

/**
 * Auto-save manager for periodic state persistence
 */
export class AutoSaveManager {
  private readonly dataDir: string;
  private readonly interval: number;
  private readonly getState: GetTorrentStateCallback;
  private timer: ReturnType<typeof setInterval> | null = null;
  private saving: boolean = false;
  private lastSavedDownloaded: Map<string, number> = new Map();

  /**
   * Creates a new AutoSaveManager
   *
   * @param dataDir - Base data directory
   * @param getState - Callback to get current torrent states
   * @param interval - Auto-save interval in milliseconds (default: 30 seconds)
   */
  constructor(
    dataDir: string,
    getState: GetTorrentStateCallback,
    interval: number = DEFAULT_AUTO_SAVE_INTERVAL
  ) {
    this.dataDir = dataDir;
    this.getState = getState;
    this.interval = interval;
  }

  /**
   * Starts the auto-save timer
   */
  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.saveIfNeeded().catch((err) => {
        console.error('Auto-save failed:', (err as Error).message);
      });
    }, this.interval);
  }

  /**
   * Stops the auto-save timer
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Forces an immediate save of all torrents
   */
  async saveAll(): Promise<void> {
    if (this.saving) {
      return;
    }

    this.saving = true;

    try {
      const { torrents } = this.getState();

      for (const { info, completedPieces } of torrents) {
        try {
          await saveTorrentState(info, completedPieces, this.dataDir);
          this.lastSavedDownloaded.set(info.infoHash, info.downloaded);
        } catch (err) {
          console.error(
            `Failed to save state for ${info.infoHash}:`,
            (err as Error).message
          );
        }
      }
    } finally {
      this.saving = false;
    }
  }

  /**
   * Saves only torrents that have made progress since last save
   */
  private async saveIfNeeded(): Promise<void> {
    if (this.saving) {
      return;
    }

    this.saving = true;

    try {
      const { torrents } = this.getState();

      for (const { info, completedPieces } of torrents) {
        const lastDownloaded = this.lastSavedDownloaded.get(info.infoHash) ?? 0;

        // Save if there's significant progress (at least 1 piece worth)
        const progressDiff = info.downloaded - lastDownloaded;
        if (
          progressDiff >= info.pieceLength ||
          info.state !== TorrentState.DOWNLOADING
        ) {
          try {
            await saveTorrentState(info, completedPieces, this.dataDir);
            this.lastSavedDownloaded.set(info.infoHash, info.downloaded);
          } catch (err) {
            console.error(
              `Failed to auto-save state for ${info.infoHash}:`,
              (err as Error).message
            );
          }
        }
      }
    } finally {
      this.saving = false;
    }
  }

  /**
   * Clears tracking for a removed torrent
   *
   * @param infoHash - Torrent info hash
   */
  clearTracking(infoHash: string): void {
    this.lastSavedDownloaded.delete(infoHash);
  }
}

// =============================================================================
// Exports
// =============================================================================

export { TORRENTS_DIR, STATE_FILE_EXT, STATE_VERSION, getStateFilePath };

// Re-export expandPath from platform utils for backward compatibility
export { expandPath } from '../../utils/platform.js';
