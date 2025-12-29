import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { encode } from '../../../src/engine/bencode.js';
import { parseTorrent, TorrentMetadata, getPieceHash } from '../../../src/engine/torrent/parser.js';
import {
  DiskManager,
  DiskManagerOptions,
  DEFAULT_READ_CACHE_SIZE,
  DEFAULT_MAX_WRITE_QUEUE_SIZE,
  DEFAULT_VERIFICATION_CONCURRENCY,
} from '../../../src/engine/disk/manager.js';
import { AllocationStrategy } from '../../../src/engine/disk/io.js';
import { DiskError } from '../../../src/engine/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

let testDir: string;
let testCounter = 0;

/**
 * Create a unique temporary directory for each test
 */
async function createTestDir(): Promise<string> {
  testCounter++;
  const dir = path.join(os.tmpdir(), `torm-manager-test-${Date.now()}-${testCounter}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Clean up test directory
 */
async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a SHA-1 hash
 */
function sha1(data: Buffer | string): Buffer {
  return createHash('sha1')
    .update(typeof data === 'string' ? Buffer.from(data) : data)
    .digest();
}

/**
 * Create test piece data with deterministic content
 */
function createPieceData(pieceIndex: number, length: number): Buffer {
  const data = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    data[i] = (pieceIndex * 17 + i) % 256;
  }
  return data;
}

/**
 * Create piece hashes from piece data
 */
function createPieceHashes(pieceCount: number, pieceLength: number, totalLength: number): Buffer {
  const hashes: Buffer[] = [];
  for (let i = 0; i < pieceCount; i++) {
    const isLastPiece = i === pieceCount - 1;
    const length = isLastPiece
      ? totalLength - (pieceCount - 1) * pieceLength
      : pieceLength;
    const data = createPieceData(i, length);
    hashes.push(sha1(data));
  }
  return Buffer.concat(hashes);
}

/**
 * Create a single-file torrent metadata with proper hashes
 */
function createSingleFileMetadata(options: {
  name?: string;
  pieceLength?: number;
  totalLength?: number;
} = {}): TorrentMetadata {
  const name = options.name ?? 'test.txt';
  const pieceLength = options.pieceLength ?? 16384;
  const totalLength = options.totalLength ?? 1000;
  const announce = 'http://tracker.example.com/announce';

  const pieceCount = Math.ceil(totalLength / pieceLength);
  const pieces = createPieceHashes(pieceCount, pieceLength, totalLength);

  const info = {
    name: Buffer.from(name),
    'piece length': pieceLength,
    pieces,
    length: totalLength,
  };

  const torrent = {
    info,
    announce: Buffer.from(announce),
  };

  return parseTorrent(encode(torrent as any));
}

/**
 * Create a multi-file torrent metadata
 */
function createMultiFileMetadata(options: {
  name?: string;
  pieceLength?: number;
  files?: Array<{ path: string[]; length: number }>;
} = {}): TorrentMetadata {
  const name = options.name ?? 'test-folder';
  const pieceLength = options.pieceLength ?? 16384;
  const files = options.files ?? [
    { path: ['file1.txt'], length: 500 },
    { path: ['file2.txt'], length: 750 },
  ];

  const totalLength = files.reduce((sum, f) => sum + f.length, 0);
  const pieceCount = Math.ceil(totalLength / pieceLength);
  const pieces = createPieceHashes(pieceCount, pieceLength, totalLength);

  const info = {
    name: Buffer.from(name),
    'piece length': pieceLength,
    pieces,
    files: files.map((f) => ({
      path: f.path.map((p) => Buffer.from(p)),
      length: f.length,
    })),
  };

  const torrent = {
    info,
    announce: Buffer.from('http://tracker.example.com/announce'),
  };

  return parseTorrent(encode(torrent as any));
}

/**
 * Create default manager options
 */
function createManagerOptions(downloadPath: string): DiskManagerOptions {
  return {
    downloadPath,
    allocationStrategy: AllocationStrategy.Sparse,
    verifyOnStart: false,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Constants', () => {
  it('DEFAULT_READ_CACHE_SIZE should be 16', () => {
    expect(DEFAULT_READ_CACHE_SIZE).toBe(16);
  });

  it('DEFAULT_MAX_WRITE_QUEUE_SIZE should be 64', () => {
    expect(DEFAULT_MAX_WRITE_QUEUE_SIZE).toBe(64);
  });

  it('DEFAULT_VERIFICATION_CONCURRENCY should be 8', () => {
    expect(DEFAULT_VERIFICATION_CONCURRENCY).toBe(8);
  });
});

describe('DiskManager', () => {
  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create DiskManager with default options', () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      expect(manager).toBeDefined();
      expect(manager.completedCount).toBe(0);
      expect(manager.progress).toBe(0);
    });

    it('should accept custom read cache size', () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, {
        ...createManagerOptions(testDir),
        readCacheSize: 16,
      });

      expect(manager).toBeDefined();
    });

    it('should accept custom write queue size', () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, {
        ...createManagerOptions(testDir),
        maxWriteQueueSize: 64,
      });

      expect(manager).toBeDefined();
    });
  });

  // ===========================================================================
  // Properties Tests
  // ===========================================================================

  describe('properties', () => {
    it('completedCount should return number of completed pieces', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      expect(manager.completedCount).toBe(0);

      await manager.writePiece(0, createPieceData(0, 500));
      expect(manager.completedCount).toBe(1);

      await manager.stop();
    });

    it('progress should return download progress', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      expect(manager.progress).toBe(0);

      await manager.writePiece(0, createPieceData(0, 500));
      expect(manager.progress).toBe(0.5);

      await manager.writePiece(1, createPieceData(1, 500));
      expect(manager.progress).toBe(1);

      await manager.stop();
    });

    it('pieceCount should return total pieces', () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1500,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      expect(manager.pieceCount).toBe(3);
    });

    it('isComplete should indicate completion', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      expect(manager.isComplete).toBe(false);

      await manager.writePiece(0, createPieceData(0, 1000));
      expect(manager.isComplete).toBe(true);

      await manager.stop();
    });

    it('writeQueueLength should return queue length', () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      expect(manager.writeQueueLength).toBe(0);
    });

    it('readCacheLength should return cache size', () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      expect(manager.readCacheLength).toBe(0);
    });
  });

  // ===========================================================================
  // Lifecycle Tests
  // ===========================================================================

  describe('start', () => {
    it('should allocate files', async () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      const filesAllocatedHandler = vi.fn();
      manager.on('filesAllocated', filesAllocatedHandler);

      await manager.start();

      expect(filesAllocatedHandler).toHaveBeenCalled();

      await manager.stop();
    });

    it('should return empty array when no pieces exist', async () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      const completedPieces = await manager.start();

      expect(completedPieces).toEqual([]);

      await manager.stop();
    });

    it('should be idempotent', async () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      await manager.start();
      await manager.start();
      await manager.start();

      await manager.stop();
    });
  });

  describe('stop', () => {
    it('should close file handles', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      await manager.start();
      await manager.writePiece(0, createPieceData(0, 1000));
      await manager.stop();

      // Manager should be stopped
      await expect(manager.readPiece(0)).rejects.toThrow(DiskError);
    });

    it('should wait for pending writes', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      await manager.start();

      // Queue writes without waiting
      const writePromises = [
        manager.writePiece(0, createPieceData(0, 500)),
        manager.writePiece(1, createPieceData(1, 500)),
      ];

      // Stop should wait for writes
      await manager.stop();

      // All writes should be complete
      expect(manager.completedCount).toBe(2);
    });

    it('should be idempotent', async () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      await manager.start();
      await manager.stop();
      await manager.stop();
      await manager.stop();
    });
  });

  // ===========================================================================
  // writePiece Tests
  // ===========================================================================

  describe('writePiece', () => {
    it('should write piece to disk', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      const pieceData = createPieceData(0, 1000);
      await manager.writePiece(0, pieceData);

      expect(manager.hasPiece(0)).toBe(true);

      await manager.stop();
    });

    it('should emit pieceWritten event', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      const handler = vi.fn();
      manager.on('pieceWritten', handler);

      await manager.writePiece(0, createPieceData(0, 1000));

      expect(handler).toHaveBeenCalledWith({ pieceIndex: 0 });

      await manager.stop();
    });

    it('should throw when stopped', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      await manager.start();
      await manager.stop();

      await expect(manager.writePiece(0, createPieceData(0, 1000))).rejects.toThrow(DiskError);
    });

    it('should throw for invalid piece length', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await expect(manager.writePiece(0, Buffer.alloc(500))).rejects.toThrow(DiskError);

      await manager.stop();
    });

    it('should handle multiple concurrent writes', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 2000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      // Write all pieces concurrently
      await Promise.all([
        manager.writePiece(0, createPieceData(0, 500)),
        manager.writePiece(1, createPieceData(1, 500)),
        manager.writePiece(2, createPieceData(2, 500)),
        manager.writePiece(3, createPieceData(3, 500)),
      ]);

      expect(manager.completedCount).toBe(4);
      expect(manager.isComplete).toBe(true);

      await manager.stop();
    });
  });

  // ===========================================================================
  // readPiece Tests
  // ===========================================================================

  describe('readPiece', () => {
    it('should read piece from disk', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      const pieceData = createPieceData(0, 1000);
      await manager.writePiece(0, pieceData);

      const readData = await manager.readPiece(0);
      expect(readData.equals(pieceData)).toBe(true);

      await manager.stop();
    });

    it('should use read cache', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await manager.writePiece(0, createPieceData(0, 1000));

      // First read
      await manager.readPiece(0);
      expect(manager.readCacheLength).toBe(1);

      // Second read should use cache
      await manager.readPiece(0);
      expect(manager.readCacheLength).toBe(1);

      await manager.stop();
    });

    it('should throw for incomplete piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await expect(manager.readPiece(0)).rejects.toThrow(DiskError);

      await manager.stop();
    });

    it('should throw when stopped', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      await manager.start();
      await manager.writePiece(0, createPieceData(0, 1000));
      await manager.stop();

      await expect(manager.readPiece(0)).rejects.toThrow(DiskError);
    });
  });

  // ===========================================================================
  // readBlock Tests
  // ===========================================================================

  describe('readBlock', () => {
    it('should read block from piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      const pieceData = createPieceData(0, 1000);
      await manager.writePiece(0, pieceData);

      const block = await manager.readBlock(0, 200, 300);
      expect(block.equals(pieceData.subarray(200, 500))).toBe(true);

      await manager.stop();
    });

    it('should use cache when piece is cached', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      const pieceData = createPieceData(0, 1000);
      await manager.writePiece(0, pieceData);

      // Read full piece to cache it
      await manager.readPiece(0);

      // Read block from cache
      const block = await manager.readBlock(0, 100, 200);
      expect(block.equals(pieceData.subarray(100, 300))).toBe(true);

      await manager.stop();
    });

    it('should throw for incomplete piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await expect(manager.readBlock(0, 0, 100)).rejects.toThrow(DiskError);

      await manager.stop();
    });
  });

  // ===========================================================================
  // hasPiece Tests
  // ===========================================================================

  describe('hasPiece', () => {
    it('should return false for incomplete piece', async () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      expect(manager.hasPiece(0)).toBe(false);

      await manager.stop();
    });

    it('should return true for complete piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await manager.writePiece(0, createPieceData(0, 1000));

      expect(manager.hasPiece(0)).toBe(true);

      await manager.stop();
    });
  });

  // ===========================================================================
  // getCompletedPieces Tests
  // ===========================================================================

  describe('getCompletedPieces', () => {
    it('should return empty array initially', async () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      expect(manager.getCompletedPieces()).toEqual([]);

      await manager.stop();
    });

    it('should return completed piece indices', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1500,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await manager.writePiece(0, createPieceData(0, 500));
      await manager.writePiece(2, createPieceData(2, 500));

      const completed = manager.getCompletedPieces();
      expect(completed).toContain(0);
      expect(completed).toContain(2);
      expect(completed).not.toContain(1);

      await manager.stop();
    });
  });

  // ===========================================================================
  // markPieceComplete Tests
  // ===========================================================================

  describe('markPieceComplete', () => {
    it('should mark piece as complete', () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      expect(manager.hasPiece(0)).toBe(false);

      manager.markPieceComplete(0);

      expect(manager.hasPiece(0)).toBe(true);
      expect(manager.completedCount).toBe(1);
    });
  });

  // ===========================================================================
  // verifyPiece Tests
  // ===========================================================================

  describe('verifyPiece', () => {
    it('should return true for valid piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      // Write valid piece
      await manager.writePiece(0, createPieceData(0, 1000));

      const valid = await manager.verifyPiece(0);
      expect(valid).toBe(true);

      await manager.stop();
    });

    it('should return false for invalid piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      // Write piece directly to disk with wrong data
      const filePath = path.join(testDir, 'test.txt');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, Buffer.alloc(1000, 0xff));

      const valid = await manager.verifyPiece(0);
      expect(valid).toBe(false);

      await manager.stop();
    });

    it('should return false for non-existent piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      const valid = await manager.verifyPiece(0);
      expect(valid).toBe(false);

      await manager.stop();
    });
  });

  // ===========================================================================
  // verifyExistingPieces Tests
  // ===========================================================================

  describe('verifyExistingPieces', () => {
    it('should verify all existing pieces', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1500,
      });

      // First write some pieces
      const manager1 = new DiskManager(metadata, createManagerOptions(testDir));
      await manager1.start();
      await manager1.writePiece(0, createPieceData(0, 500));
      await manager1.writePiece(2, createPieceData(2, 500));
      await manager1.stop();

      // Create new manager and verify
      const manager2 = new DiskManager(metadata, {
        ...createManagerOptions(testDir),
        verifyOnStart: true,
      });

      const completedHandler = vi.fn();
      manager2.on('verificationComplete', completedHandler);

      await manager2.start();

      expect(completedHandler).toHaveBeenCalled();
      expect(manager2.hasPiece(0)).toBe(true);
      expect(manager2.hasPiece(2)).toBe(true);
      expect(manager2.hasPiece(1)).toBe(false);

      await manager2.stop();
    });

    it('should emit progress events', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 2000, // 4 pieces
      });
      const manager = new DiskManager(metadata, {
        ...createManagerOptions(testDir),
        verifyOnStart: true,
      });

      const progressHandler = vi.fn();
      manager.on('verificationProgress', progressHandler);

      await manager.start();

      expect(progressHandler).toHaveBeenCalled();

      await manager.stop();
    });

    it('should emit pieceVerified for valid pieces', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });

      // Write valid piece
      const manager1 = new DiskManager(metadata, createManagerOptions(testDir));
      await manager1.start();
      await manager1.writePiece(0, createPieceData(0, 1000));
      await manager1.stop();

      // Verify
      const manager2 = new DiskManager(metadata, {
        ...createManagerOptions(testDir),
        verifyOnStart: true,
      });

      const verifiedHandler = vi.fn();
      manager2.on('pieceVerified', verifiedHandler);

      await manager2.start();

      expect(verifiedHandler).toHaveBeenCalledWith({ pieceIndex: 0 });

      await manager2.stop();
    });

    it('should emit pieceFailed for invalid pieces', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, {
        ...createManagerOptions(testDir),
        verifyOnStart: true,
      });

      // Write invalid piece directly
      const filePath = path.join(testDir, 'test.txt');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, Buffer.alloc(1000, 0xff));

      const failedHandler = vi.fn();
      manager.on('pieceFailed', failedHandler);

      await manager.start();

      expect(failedHandler).toHaveBeenCalledWith({ pieceIndex: 0 });

      await manager.stop();
    });
  });

  // ===========================================================================
  // deleteFiles Tests
  // ===========================================================================

  describe('deleteFiles', () => {
    it('should delete all torrent files', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await manager.writePiece(0, createPieceData(0, 1000));

      await manager.deleteFiles();

      const filePath = path.join(testDir, 'test.txt');
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should clear completed pieces', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await manager.writePiece(0, createPieceData(0, 1000));
      expect(manager.completedCount).toBe(1);

      await manager.deleteFiles();

      expect(manager.completedCount).toBe(0);
    });
  });

  // ===========================================================================
  // File Management Tests
  // ===========================================================================

  describe('getTotalAllocatedBytes', () => {
    it('should return 0 when no files written', async () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      const bytes = await manager.getTotalAllocatedBytes();
      expect(bytes).toBe(0);

      await manager.stop();
    });

    it('should return total bytes after writes', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, {
        ...createManagerOptions(testDir),
        allocationStrategy: AllocationStrategy.Full,
      });
      await manager.start();

      await manager.writePiece(0, createPieceData(0, 1000));

      const bytes = await manager.getTotalAllocatedBytes();
      expect(bytes).toBeGreaterThanOrEqual(1000);

      await manager.stop();
    });
  });

  describe('getFilePath', () => {
    it('should return correct file path', () => {
      const metadata = createMultiFileMetadata({
        name: 'test-torrent',
        files: [
          { path: ['file1.txt'], length: 100 },
          { path: ['subdir', 'file2.txt'], length: 100 },
        ],
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      expect(manager.getFilePath(0)).toBe(path.join(testDir, 'test-torrent', 'file1.txt'));
      expect(manager.getFilePath(1)).toBe(path.join(testDir, 'test-torrent', 'subdir', 'file2.txt'));
    });

    it('should throw for invalid file index', () => {
      const metadata = createSingleFileMetadata();
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      expect(() => manager.getFilePath(-1)).toThrow();
      expect(() => manager.getFilePath(100)).toThrow();
    });
  });

  describe('getTorrentPath', () => {
    it('should return correct torrent path', () => {
      const metadata = createSingleFileMetadata({ name: 'my-file.txt' });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));

      expect(manager.getTorrentPath()).toBe(path.join(testDir, 'my-file.txt'));
    });
  });

  // ===========================================================================
  // Cache Tests
  // ===========================================================================

  describe('read cache', () => {
    it('should evict oldest entries when full', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 100,
        totalLength: 1000, // 10 pieces
      });
      const manager = new DiskManager(metadata, {
        ...createManagerOptions(testDir),
        readCacheSize: 3, // Small cache
      });
      await manager.start();

      // Write and read all pieces
      for (let i = 0; i < 10; i++) {
        await manager.writePiece(i, createPieceData(i, 100));
      }

      for (let i = 0; i < 10; i++) {
        await manager.readPiece(i);
      }

      // Cache should be at max size
      expect(manager.readCacheLength).toBeLessThanOrEqual(3);

      await manager.stop();
    });

    it('should clear cache on clearCache', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await manager.writePiece(0, createPieceData(0, 1000));
      await manager.readPiece(0);
      expect(manager.readCacheLength).toBe(1);

      manager.clearCache();
      expect(manager.readCacheLength).toBe(0);

      await manager.stop();
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle multi-file torrent with pieces spanning files', async () => {
      const metadata = createMultiFileMetadata({
        pieceLength: 1000,
        files: [
          { path: ['file1.txt'], length: 600 },
          { path: ['file2.txt'], length: 600 },
        ],
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      // Piece 0 spans both files
      await manager.writePiece(0, createPieceData(0, 1000));

      // Verify it can be read back
      const readData = await manager.readPiece(0);
      expect(readData.equals(createPieceData(0, 1000))).toBe(true);

      await manager.stop();
    });

    it('should handle last piece being smaller', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1500, // Last piece is 500 bytes
      });
      const manager = new DiskManager(metadata, createManagerOptions(testDir));
      await manager.start();

      await manager.writePiece(0, createPieceData(0, 1000));
      await manager.writePiece(1, createPieceData(1, 500));

      expect(manager.isComplete).toBe(true);

      const piece1 = await manager.readPiece(1);
      expect(piece1.length).toBe(500);

      await manager.stop();
    });
  });
});
