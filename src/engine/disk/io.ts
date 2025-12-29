/**
 * Disk I/O Layer for Torm BitTorrent Client
 *
 * Handles low-level file operations for torrent data:
 * - File allocation and pre-allocation strategies
 * - Reading/writing pieces to correct file offsets
 * - Handling pieces that span multiple files
 * - Sparse file support for partial downloads
 *
 * @module engine/disk/io
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { $ } from 'bun';
import { DiskError, DiskFullError } from '../types.js';
import { TorrentFileInfo, getFilesForPiece, getActualPieceLength, TorrentMetadata } from '../torrent/parser.js';

// =============================================================================
// Types
// =============================================================================

/**
 * File allocation strategy
 */
export enum AllocationStrategy {
  /** Allocate files only as data is written (sparse) */
  Sparse = 'sparse',

  /** Pre-allocate full file size with zeros */
  Full = 'full',

  /** Pre-allocate using fallocate/sparse if supported, fallback to sparse */
  Compact = 'compact',
}

/**
 * Options for DiskIO operations
 */
export interface DiskIOOptions {
  /** Base directory for downloaded files */
  downloadPath: string;

  /** File allocation strategy */
  allocationStrategy?: AllocationStrategy;

  /** Whether to create parent directories as needed */
  createDirectories?: boolean;
}

/**
 * Result of a piece read operation
 */
export interface PieceReadResult {
  /** The piece data */
  data: Buffer;

  /** Whether the read was complete (all bytes available) */
  complete: boolean;
}

/**
 * Information about a file segment within a piece
 */
interface FileSegment {
  /** Absolute file path */
  filePath: string;

  /** Offset within the file to start reading/writing */
  fileOffset: number;

  /** Offset within the piece buffer */
  pieceOffset: number;

  /** Number of bytes to read/write */
  length: number;

  /** Original file info */
  fileInfo: TorrentFileInfo;
}

// =============================================================================
// DiskIO Class
// =============================================================================

/**
 * Low-level disk I/O operations for torrent data
 *
 * Handles the mapping between torrent pieces and actual files on disk.
 * Pieces can span multiple files, and this class handles that complexity.
 *
 * @example
 * ```typescript
 * const diskIO = new DiskIO(metadata, {
 *   downloadPath: '/downloads',
 *   allocationStrategy: AllocationStrategy.Sparse,
 * });
 *
 * // Write a piece
 * await diskIO.writePiece(0, pieceData);
 *
 * // Read a piece
 * const { data, complete } = await diskIO.readPiece(0);
 * ```
 */
export class DiskIO {
  /** Torrent metadata */
  private readonly metadata: TorrentMetadata;

  /** Download directory */
  private readonly downloadPath: string;

  /** Allocation strategy */
  private readonly allocationStrategy: AllocationStrategy;

  /** Whether to create directories */
  private readonly createDirectories: boolean;

  /** Set of files that have been allocated */
  private readonly allocatedFiles: Set<string>;

  /** File handle cache for performance */
  private readonly fileHandles: Map<string, fs.FileHandle>;

  /**
   * Create a new DiskIO instance
   *
   * @param metadata - Parsed torrent metadata
   * @param options - I/O options
   */
  constructor(metadata: TorrentMetadata, options: DiskIOOptions) {
    this.metadata = metadata;
    this.downloadPath = options.downloadPath;
    this.allocationStrategy = options.allocationStrategy ?? AllocationStrategy.Sparse;
    this.createDirectories = options.createDirectories ?? true;
    this.allocatedFiles = new Set();
    this.fileHandles = new Map();
  }

  // ===========================================================================
  // Public Methods - Core I/O
  // ===========================================================================

  /**
   * Write a piece to disk
   *
   * Handles pieces that span multiple files by writing to each file
   * at the correct offset.
   *
   * @param pieceIndex - Index of the piece
   * @param data - Piece data to write
   * @throws DiskError if write fails
   */
  async writePiece(pieceIndex: number, data: Buffer): Promise<void> {
    const expectedLength = getActualPieceLength(this.metadata, pieceIndex);
    if (data.length !== expectedLength) {
      throw new DiskError(
        `Invalid piece data length: expected ${expectedLength}, got ${data.length}`,
        `piece ${pieceIndex}`
      );
    }

    const segments = this.getFileSegments(pieceIndex);

    for (const segment of segments) {
      await this.writeSegment(segment, data);
    }
  }

  /**
   * Read a piece from disk
   *
   * Handles pieces that span multiple files by reading from each file
   * and concatenating the data.
   *
   * @param pieceIndex - Index of the piece
   * @returns Piece data and completion status
   * @throws DiskError if read fails
   */
  async readPiece(pieceIndex: number): Promise<PieceReadResult> {
    const pieceLength = getActualPieceLength(this.metadata, pieceIndex);
    const data = Buffer.alloc(pieceLength);
    let complete = true;

    const segments = this.getFileSegments(pieceIndex);

    for (const segment of segments) {
      const segmentComplete = await this.readSegment(segment, data);
      if (!segmentComplete) {
        complete = false;
      }
    }

    return { data, complete };
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
   * @throws DiskError if read fails
   */
  async readBlock(pieceIndex: number, begin: number, length: number): Promise<Buffer> {
    const pieceLength = getActualPieceLength(this.metadata, pieceIndex);
    if (begin < 0 || begin + length > pieceLength) {
      throw new DiskError(
        `Invalid block range: begin=${begin}, length=${length}, pieceLength=${pieceLength}`,
        `piece ${pieceIndex}`
      );
    }

    const data = Buffer.alloc(length);
    const pieceStart = pieceIndex * this.metadata.pieceLength;

    // Calculate absolute byte range
    const absoluteStart = pieceStart + begin;
    const absoluteEnd = absoluteStart + length;

    // Find files that contain this block
    for (const file of this.metadata.files) {
      const fileStart = file.offset;
      const fileEnd = file.offset + file.length;

      // Check if block overlaps with this file
      if (absoluteStart < fileEnd && absoluteEnd > fileStart) {
        const overlapStart = Math.max(absoluteStart, fileStart);
        const overlapEnd = Math.min(absoluteEnd, fileEnd);
        const overlapLength = overlapEnd - overlapStart;

        const fileOffset = overlapStart - fileStart;
        const bufferOffset = overlapStart - absoluteStart;

        const filePath = this.getFilePath(file);

        try {
          const handle = await this.openFile(filePath, 'r');
          await handle.read(data, bufferOffset, overlapLength, fileOffset);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            // File doesn't exist yet, leave as zeros
            continue;
          }
          throw new DiskError(
            `Failed to read block: ${(err as Error).message}`,
            filePath
          );
        }
      }
    }

    return data;
  }

  // ===========================================================================
  // Public Methods - File Management
  // ===========================================================================

  /**
   * Allocate all files for the torrent
   *
   * Creates the directory structure and optionally pre-allocates files
   * depending on the allocation strategy.
   */
  async allocateFiles(): Promise<void> {
    for (const file of this.metadata.files) {
      await this.allocateFile(file);
    }
  }

  /**
   * Allocate a single file
   *
   * @param file - File info
   */
  async allocateFile(file: TorrentFileInfo): Promise<void> {
    const filePath = this.getFilePath(file);

    if (this.allocatedFiles.has(filePath)) {
      return;
    }

    // Create parent directories
    if (this.createDirectories) {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
    }

    // Allocate based on strategy
    switch (this.allocationStrategy) {
      case AllocationStrategy.Full:
        await this.allocateFullFile(filePath, file.length);
        break;
      case AllocationStrategy.Compact:
        await this.allocateCompactFile(filePath, file.length);
        break;
      case AllocationStrategy.Sparse:
      default:
        await this.allocateSparseFile(filePath, file.length);
        break;
    }

    this.allocatedFiles.add(filePath);
  }

  /**
   * Check if a file exists on disk
   *
   * @param file - File info
   * @returns true if file exists
   */
  async fileExists(file: TorrentFileInfo): Promise<boolean> {
    const filePath = this.getFilePath(file);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the size of a file on disk
   *
   * @param file - File info
   * @returns File size in bytes, or 0 if file doesn't exist
   */
  async getFileSize(file: TorrentFileInfo): Promise<number> {
    const filePath = this.getFilePath(file);
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Check if all files exist and have correct sizes
   *
   * @returns Array of files that are missing or incomplete
   */
  async verifyFiles(): Promise<TorrentFileInfo[]> {
    const incomplete: TorrentFileInfo[] = [];

    for (const file of this.metadata.files) {
      const exists = await this.fileExists(file);
      if (!exists) {
        incomplete.push(file);
        continue;
      }

      const size = await this.getFileSize(file);
      if (size < file.length) {
        incomplete.push(file);
      }
    }

    return incomplete;
  }

  /**
   * Delete all torrent files
   *
   * Uses Bun Shell's native rm command for fast cross-platform deletion.
   * Bun Shell implements rm natively (not via system shell) for performance.
   *
   * @param _deleteDirectories - Deprecated, directories are always deleted with recursive removal
   */
  async deleteFiles(_deleteDirectories = false): Promise<void> {
    // Close all file handles first
    await this.closeAllHandles();

    const torrentPath = this.getTorrentPath();
    try {
      // Bun Shell's rm is natively implemented and cross-platform (macOS, Linux, Windows)
      // Much faster than Node's fs.rm for large directory trees
      await $`rm -rf ${torrentPath}`.quiet();
    } catch (err) {
      // Bun shell throws on non-zero exit, but rm -f shouldn't fail on missing files
      // Only throw if it's not an ENOENT-like situation
      const message = (err as Error).message || '';
      if (!message.includes('No such file') && !message.includes('ENOENT')) {
        throw new DiskError(
          `Failed to delete torrent files: ${message}`,
          torrentPath
        );
      }
    }

    this.allocatedFiles.clear();
  }

  /**
   * Close all open file handles
   */
  async closeAllHandles(): Promise<void> {
    for (const handle of this.fileHandles.values()) {
      try {
        await handle.close();
      } catch {
        // Ignore close errors
      }
    }
    this.fileHandles.clear();
  }

  // ===========================================================================
  // Public Methods - Utilities
  // ===========================================================================

  /**
   * Get the full path for a file
   *
   * @param file - File info
   * @returns Absolute file path
   */
  getFilePath(file: TorrentFileInfo): string {
    return path.join(this.downloadPath, file.path);
  }

  /**
   * Get the root directory for the torrent
   *
   * @returns Torrent root directory path
   */
  getTorrentPath(): string {
    return path.join(this.downloadPath, this.metadata.name);
  }

  /**
   * Get total bytes written to disk (allocated)
   *
   * @returns Total allocated bytes
   */
  async getTotalAllocatedBytes(): Promise<number> {
    let total = 0;

    for (const file of this.metadata.files) {
      const size = await this.getFileSize(file);
      total += size;
    }

    return total;
  }

  /**
   * Get available disk space on the download path
   *
   * Uses fs.statfs on Node.js 18+ or falls back to platform-specific methods.
   *
   * @returns Available space in bytes
   * @throws DiskError if space cannot be determined
   */
  async getAvailableSpace(): Promise<number> {
    try {
      // Node.js 18.15+ has fs.statfs
      if ('statfs' in fs) {
        const stats = await (fs as any).statfs(this.downloadPath);
        // bavail is blocks available to unprivileged users (more accurate)
        // bfree is total free blocks (includes reserved for root)
        const availableBlocks = stats.bavail ?? stats.bfree;
        return availableBlocks * stats.bsize;
      }

      // Fallback: return Infinity to indicate unknown
      // (caller should handle this case)
      return Infinity;
    } catch (err) {
      throw new DiskError(
        `Failed to get available space: ${(err as Error).message}`,
        this.downloadPath
      );
    }
  }

  /**
   * Check if there is enough available disk space
   *
   * @param requiredBytes - Number of bytes required
   * @returns true if enough space is available, false otherwise
   */
  async checkAvailableSpace(requiredBytes: number): Promise<boolean> {
    try {
      const available = await this.getAvailableSpace();

      // If we got Infinity, we couldn't determine space, assume ok
      if (available === Infinity) {
        return true;
      }

      return available >= requiredBytes;
    } catch {
      // If we can't check, assume ok (will fail on write if not)
      return true;
    }
  }

  /**
   * Get the download path for this DiskIO instance
   *
   * @returns Download directory path
   */
  getDownloadPath(): string {
    return this.downloadPath;
  }

  // ===========================================================================
  // Private Methods - Segment Operations
  // ===========================================================================

  /**
   * Get file segments for a piece
   *
   * Calculates which parts of which files correspond to a given piece.
   */
  private getFileSegments(pieceIndex: number): FileSegment[] {
    const fileRanges = getFilesForPiece(this.metadata, pieceIndex);
    const segments: FileSegment[] = [];

    let pieceOffset = 0;

    for (const range of fileRanges) {
      segments.push({
        filePath: this.getFilePath(range.file),
        fileOffset: range.fileOffset,
        pieceOffset,
        length: range.length,
        fileInfo: range.file,
      });

      pieceOffset += range.length;
    }

    return segments;
  }

  /**
   * Write a segment to a file
   */
  private async writeSegment(segment: FileSegment, pieceData: Buffer): Promise<void> {
    // Ensure file is allocated
    await this.allocateFile(segment.fileInfo);

    const handle = await this.openFile(segment.filePath, 'r+');

    try {
      const segmentData = pieceData.subarray(
        segment.pieceOffset,
        segment.pieceOffset + segment.length
      );

      await handle.write(segmentData, 0, segment.length, segment.fileOffset);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;

      // Check for disk full error (ENOSPC)
      if (nodeErr.code === 'ENOSPC') {
        const availableBytes = await this.getAvailableSpace().catch(() => undefined);
        throw new DiskFullError(
          `Disk full: cannot write ${segment.length} bytes to ${segment.filePath}`,
          segment.filePath,
          segment.length,
          availableBytes
        );
      }

      throw new DiskError(
        `Failed to write segment: ${(err as Error).message}`,
        segment.filePath
      );
    }
  }

  /**
   * Read a segment from a file
   *
   * @returns true if segment was fully read, false if file doesn't exist or is too small
   */
  private async readSegment(segment: FileSegment, pieceData: Buffer): Promise<boolean> {
    // Try to get cached handle first
    const cacheKey = `${segment.filePath}:r`;
    let handle = this.fileHandles.get(cacheKey);

    if (!handle) {
      // Open file directly to properly handle ENOENT
      try {
        handle = await fs.open(segment.filePath, 'r');
        this.fileHandles.set(cacheKey, handle);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          // File doesn't exist - leave buffer as zeros
          return false;
        }
        throw new DiskError(
          `Failed to read segment: ${(err as Error).message}`,
          segment.filePath
        );
      }
    }

    try {
      const { bytesRead } = await handle.read(
        pieceData,
        segment.pieceOffset,
        segment.length,
        segment.fileOffset
      );

      return bytesRead === segment.length;
    } catch (err) {
      throw new DiskError(
        `Failed to read segment: ${(err as Error).message}`,
        segment.filePath
      );
    }
  }

  // ===========================================================================
  // Private Methods - File Allocation
  // ===========================================================================

  /**
   * Allocate a sparse file (creates file but doesn't write data)
   */
  private async allocateSparseFile(filePath: string, length: number): Promise<void> {
    try {
      // Create file if it doesn't exist
      const handle = await fs.open(filePath, 'a');
      await handle.close();
    } catch (err) {
      throw new DiskError(
        `Failed to create sparse file: ${(err as Error).message}`,
        filePath
      );
    }
  }

  /**
   * Allocate a full file (pre-allocate with zeros)
   */
  private async allocateFullFile(filePath: string, length: number): Promise<void> {
    try {
      // Check if file already exists with correct size
      try {
        const stats = await fs.stat(filePath);
        if (stats.size >= length) {
          return;
        }
      } catch {
        // File doesn't exist, continue with allocation
      }

      // Create and write zeros
      const handle = await fs.open(filePath, 'w');

      try {
        // Write in chunks to avoid memory issues
        const chunkSize = 1024 * 1024; // 1 MB chunks
        const zeroChunk = Buffer.alloc(chunkSize);

        let remaining = length;
        let offset = 0;

        while (remaining > 0) {
          const writeSize = Math.min(remaining, chunkSize);
          await handle.write(zeroChunk, 0, writeSize, offset);
          offset += writeSize;
          remaining -= writeSize;
        }
      } finally {
        await handle.close();
      }
    } catch (err) {
      throw new DiskError(
        `Failed to allocate full file: ${(err as Error).message}`,
        filePath
      );
    }
  }

  /**
   * Allocate a compact file (use fallocate if available, otherwise sparse)
   */
  private async allocateCompactFile(filePath: string, length: number): Promise<void> {
    try {
      // Try to use truncate for efficient allocation
      const handle = await fs.open(filePath, 'w');

      try {
        await handle.truncate(length);
      } finally {
        await handle.close();
      }
    } catch (err) {
      // Fallback to sparse allocation
      await this.allocateSparseFile(filePath, length);
    }
  }

  // ===========================================================================
  // Private Methods - File Handle Management
  // ===========================================================================

  /**
   * Open a file handle (cached)
   */
  private async openFile(filePath: string, flags: string): Promise<fs.FileHandle> {
    const cacheKey = `${filePath}:${flags}`;

    let handle = this.fileHandles.get(cacheKey);
    if (handle) {
      return handle;
    }

    try {
      handle = await fs.open(filePath, flags);
      this.fileHandles.set(cacheKey, handle);
      return handle;
    } catch (err) {
      throw new DiskError(
        `Failed to open file: ${(err as Error).message}`,
        filePath
      );
    }
  }

  /**
   * Delete empty directories up to the download path
   */
  private async deleteEmptyDirectories(): Promise<void> {
    // Get all unique directories
    const directories = new Set<string>();

    for (const file of this.metadata.files) {
      const filePath = this.getFilePath(file);
      let dir = path.dirname(filePath);

      while (dir !== this.downloadPath && dir.startsWith(this.downloadPath)) {
        directories.add(dir);
        dir = path.dirname(dir);
      }
    }

    // Sort by depth (deepest first)
    const sortedDirs = Array.from(directories).sort(
      (a, b) => b.split(path.sep).length - a.split(path.sep).length
    );

    for (const dir of sortedDirs) {
      try {
        await fs.rmdir(dir);
      } catch {
        // Directory not empty or doesn't exist, skip
      }
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate disk space needed for a torrent
 *
 * @param metadata - Torrent metadata
 * @returns Required disk space in bytes
 */
export function calculateRequiredSpace(metadata: TorrentMetadata): number {
  return metadata.totalLength;
}

/**
 * Check if there's enough disk space
 *
 * @param path - Path to check
 * @param requiredBytes - Required space in bytes
 * @returns true if enough space is available
 */
export async function hasEnoughSpace(dirPath: string, requiredBytes: number): Promise<boolean> {
  try {
    // Use statfs if available (Node.js 18+)
    if ('statfs' in fs) {
      const stats = await (fs as any).statfs(dirPath);
      const availableBytes = stats.bfree * stats.bsize;
      return availableBytes >= requiredBytes;
    }

    // Fallback: assume there's enough space
    return true;
  } catch {
    // Can't check, assume there's enough
    return true;
  }
}

/**
 * Normalize a file path for the current platform
 *
 * @param filePath - Path to normalize
 * @returns Normalized path
 */
export function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/');
}
