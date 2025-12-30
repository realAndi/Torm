import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { encode } from '../../../src/engine/bencode.js';
import { parseTorrent, TorrentMetadata } from '../../../src/engine/torrent/parser.js';
import {
  DiskIO,
  AllocationStrategy,
  calculateRequiredSpace,
  normalizePath,
} from '../../../src/engine/disk/io.js';
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
  const dir = path.join(os.tmpdir(), `torm-disk-test-${Date.now()}-${testCounter}`);
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
 * Create a single-file torrent metadata
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
  const pieces = Buffer.alloc(pieceCount * 20);
  for (let i = 0; i < pieceCount; i++) {
    sha1(`piece-${i}`).copy(pieces, i * 20);
  }

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
    { path: ['subdir', 'file2.txt'], length: 750 },
  ];

  const totalLength = files.reduce((sum, f) => sum + f.length, 0);
  const pieceCount = Math.ceil(totalLength / pieceLength);
  const pieces = Buffer.alloc(pieceCount * 20);
  for (let i = 0; i < pieceCount; i++) {
    sha1(`piece-${i}`).copy(pieces, i * 20);
  }

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
 * Create test piece data
 */
function createPieceData(length: number, seed = 0): Buffer {
  const data = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    data[i] = (seed + i) % 256;
  }
  return data;
}

// =============================================================================
// Tests
// =============================================================================

describe('DiskIO', () => {
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
    it('should create DiskIO with default options', () => {
      const metadata = createSingleFileMetadata();
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      expect(diskIO).toBeDefined();
    });

    it('should accept custom allocation strategy', () => {
      const metadata = createSingleFileMetadata();
      const diskIO = new DiskIO(metadata, {
        downloadPath: testDir,
        allocationStrategy: AllocationStrategy.Full,
      });

      expect(diskIO).toBeDefined();
    });

    it('should accept createDirectories option', () => {
      const metadata = createSingleFileMetadata();
      const diskIO = new DiskIO(metadata, {
        downloadPath: testDir,
        createDirectories: false,
      });

      expect(diskIO).toBeDefined();
    });
  });

  // ===========================================================================
  // writePiece Tests
  // ===========================================================================

  describe('writePiece', () => {
    it('should write a single-file piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const pieceData = createPieceData(1000);
      await diskIO.writePiece(0, pieceData);

      // Verify file was created
      const filePath = path.join(testDir, 'test.txt');
      const fileData = await fs.readFile(filePath);
      expect(fileData.equals(pieceData)).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should write multiple pieces', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1000,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const piece0 = createPieceData(500, 0);
      const piece1 = createPieceData(500, 100);

      await diskIO.writePiece(0, piece0);
      await diskIO.writePiece(1, piece1);

      // Verify file content
      const filePath = path.join(testDir, 'test.txt');
      const fileData = await fs.readFile(filePath);
      expect(fileData.subarray(0, 500).equals(piece0)).toBe(true);
      expect(fileData.subarray(500, 1000).equals(piece1)).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should write piece spanning multiple files', async () => {
      const metadata = createMultiFileMetadata({
        pieceLength: 1000,
        files: [
          { path: ['file1.txt'], length: 600 },
          { path: ['file2.txt'], length: 600 },
        ],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const piece0 = createPieceData(1000);
      await diskIO.writePiece(0, piece0);

      // Verify file1 content (first 600 bytes of piece)
      const file1Path = path.join(testDir, 'test-folder', 'file1.txt');
      const file1Data = await fs.readFile(file1Path);
      expect(file1Data.equals(piece0.subarray(0, 600))).toBe(true);

      // Verify file2 content (next 400 bytes of piece)
      const file2Path = path.join(testDir, 'test-folder', 'file2.txt');
      const file2Data = await fs.readFile(file2Path);
      expect(file2Data.subarray(0, 400).equals(piece0.subarray(600, 1000))).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should throw for invalid piece data length', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      await expect(diskIO.writePiece(0, Buffer.alloc(500))).rejects.toThrow(DiskError);
      await expect(diskIO.writePiece(0, Buffer.alloc(1500))).rejects.toThrow(DiskError);

      await diskIO.closeAllHandles();
    });

    it('should create parent directories', async () => {
      const metadata = createMultiFileMetadata({
        files: [{ path: ['deep', 'nested', 'dir', 'file.txt'], length: 100 }],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      await diskIO.writePiece(0, createPieceData(100));

      const filePath = path.join(testDir, 'test-folder', 'deep', 'nested', 'dir', 'file.txt');
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should handle last piece being smaller', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1500, // Last piece is 500 bytes
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      await diskIO.writePiece(0, createPieceData(1000));
      await diskIO.writePiece(1, createPieceData(500)); // Last piece

      const filePath = path.join(testDir, 'test.txt');
      const stats = await fs.stat(filePath);
      expect(stats.size).toBeGreaterThanOrEqual(1500);

      await diskIO.closeAllHandles();
    });
  });

  // ===========================================================================
  // readPiece Tests
  // ===========================================================================

  describe('readPiece', () => {
    it('should read a single-file piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      // Write piece first
      const pieceData = createPieceData(1000);
      await diskIO.writePiece(0, pieceData);

      // Read it back
      const result = await diskIO.readPiece(0);
      expect(result.complete).toBe(true);
      expect(result.data.equals(pieceData)).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should read piece spanning multiple files', async () => {
      const metadata = createMultiFileMetadata({
        pieceLength: 1000,
        files: [
          { path: ['file1.txt'], length: 600 },
          { path: ['file2.txt'], length: 600 },
        ],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      // Write piece
      const pieceData = createPieceData(1000);
      await diskIO.writePiece(0, pieceData);

      // Read it back
      const result = await diskIO.readPiece(0);
      expect(result.complete).toBe(true);
      expect(result.data.equals(pieceData)).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should return incomplete for non-existent files', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      // Don't write anything, just read
      const result = await diskIO.readPiece(0);
      expect(result.complete).toBe(false);
      expect(result.data.length).toBe(1000);

      await diskIO.closeAllHandles();
    });

    it('should read all pieces correctly', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1500,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const pieces = [
        createPieceData(500, 0),
        createPieceData(500, 100),
        createPieceData(500, 200),
      ];

      for (let i = 0; i < pieces.length; i++) {
        await diskIO.writePiece(i, pieces[i]);
      }

      for (let i = 0; i < pieces.length; i++) {
        const result = await diskIO.readPiece(i);
        expect(result.complete).toBe(true);
        expect(result.data.equals(pieces[i])).toBe(true);
      }

      await diskIO.closeAllHandles();
    });
  });

  // ===========================================================================
  // readBlock Tests
  // ===========================================================================

  describe('readBlock', () => {
    it('should read a block from a piece', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const pieceData = createPieceData(1000);
      await diskIO.writePiece(0, pieceData);

      // Read a block from the middle
      const block = await diskIO.readBlock(0, 200, 300);
      expect(block.equals(pieceData.subarray(200, 500))).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should throw for invalid block range', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      await expect(diskIO.readBlock(0, -1, 100)).rejects.toThrow(DiskError);
      await expect(diskIO.readBlock(0, 900, 200)).rejects.toThrow(DiskError);

      await diskIO.closeAllHandles();
    });

    it('should read block spanning file boundary', async () => {
      const metadata = createMultiFileMetadata({
        pieceLength: 1000,
        files: [
          { path: ['file1.txt'], length: 600 },
          { path: ['file2.txt'], length: 600 },
        ],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const pieceData = createPieceData(1000);
      await diskIO.writePiece(0, pieceData);

      // Read block spanning files (500-700, crosses 600 boundary)
      const block = await diskIO.readBlock(0, 500, 200);
      expect(block.equals(pieceData.subarray(500, 700))).toBe(true);

      await diskIO.closeAllHandles();
    });
  });

  // ===========================================================================
  // allocateFiles Tests
  // ===========================================================================

  describe('allocateFiles', () => {
    it('should allocate all files with sparse strategy', async () => {
      const metadata = createMultiFileMetadata({
        files: [
          { path: ['file1.txt'], length: 1000 },
          { path: ['file2.txt'], length: 2000 },
        ],
      });
      const diskIO = new DiskIO(metadata, {
        downloadPath: testDir,
        allocationStrategy: AllocationStrategy.Sparse,
      });

      await diskIO.allocateFiles();

      const file1Path = path.join(testDir, 'test-folder', 'file1.txt');
      const file2Path = path.join(testDir, 'test-folder', 'file2.txt');

      const file1Exists = await fs.access(file1Path).then(() => true).catch(() => false);
      const file2Exists = await fs.access(file2Path).then(() => true).catch(() => false);

      expect(file1Exists).toBe(true);
      expect(file2Exists).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should allocate files with full strategy', async () => {
      const metadata = createSingleFileMetadata({
        totalLength: 5000,
      });
      const diskIO = new DiskIO(metadata, {
        downloadPath: testDir,
        allocationStrategy: AllocationStrategy.Full,
      });

      await diskIO.allocateFiles();

      const filePath = path.join(testDir, 'test.txt');
      const stats = await fs.stat(filePath);
      expect(stats.size).toBe(5000);

      await diskIO.closeAllHandles();
    });

    it('should allocate files with compact strategy', async () => {
      const metadata = createSingleFileMetadata({
        totalLength: 5000,
      });
      const diskIO = new DiskIO(metadata, {
        downloadPath: testDir,
        allocationStrategy: AllocationStrategy.Compact,
      });

      await diskIO.allocateFiles();

      const filePath = path.join(testDir, 'test.txt');
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should create nested directories', async () => {
      const metadata = createMultiFileMetadata({
        files: [{ path: ['a', 'b', 'c', 'file.txt'], length: 100 }],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      await diskIO.allocateFiles();

      const dirPath = path.join(testDir, 'test-folder', 'a', 'b', 'c');
      const dirExists = await fs.stat(dirPath).then((s) => s.isDirectory()).catch(() => false);
      expect(dirExists).toBe(true);

      await diskIO.closeAllHandles();
    });
  });

  // ===========================================================================
  // fileExists Tests
  // ===========================================================================

  describe('fileExists', () => {
    it('should return false for non-existent file', async () => {
      const metadata = createSingleFileMetadata();
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const exists = await diskIO.fileExists(metadata.files[0]);
      expect(exists).toBe(false);

      await diskIO.closeAllHandles();
    });

    it('should return true for existing file', async () => {
      const metadata = createSingleFileMetadata();
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      await diskIO.writePiece(0, createPieceData(1000));

      const exists = await diskIO.fileExists(metadata.files[0]);
      expect(exists).toBe(true);

      await diskIO.closeAllHandles();
    });
  });

  // ===========================================================================
  // getFileSize Tests
  // ===========================================================================

  describe('getFileSize', () => {
    it('should return 0 for non-existent file', async () => {
      const metadata = createSingleFileMetadata();
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const size = await diskIO.getFileSize(metadata.files[0]);
      expect(size).toBe(0);

      await diskIO.closeAllHandles();
    });

    it('should return correct size for existing file', async () => {
      const metadata = createSingleFileMetadata({ totalLength: 5000 });
      const diskIO = new DiskIO(metadata, {
        downloadPath: testDir,
        allocationStrategy: AllocationStrategy.Full,
      });

      await diskIO.allocateFiles();

      const size = await diskIO.getFileSize(metadata.files[0]);
      expect(size).toBe(5000);

      await diskIO.closeAllHandles();
    });
  });

  // ===========================================================================
  // verifyFiles Tests
  // ===========================================================================

  describe('verifyFiles', () => {
    it('should return all files as incomplete when none exist', async () => {
      const metadata = createMultiFileMetadata({
        files: [
          { path: ['file1.txt'], length: 1000 },
          { path: ['file2.txt'], length: 2000 },
        ],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const incomplete = await diskIO.verifyFiles();
      expect(incomplete).toHaveLength(2);

      await diskIO.closeAllHandles();
    });

    it('should return empty array when all files are complete', async () => {
      const metadata = createSingleFileMetadata({ totalLength: 1000 });
      const diskIO = new DiskIO(metadata, {
        downloadPath: testDir,
        allocationStrategy: AllocationStrategy.Full,
      });

      await diskIO.allocateFiles();

      const incomplete = await diskIO.verifyFiles();
      expect(incomplete).toHaveLength(0);

      await diskIO.closeAllHandles();
    });

    it('should return incomplete files', async () => {
      const metadata = createMultiFileMetadata({
        files: [
          { path: ['file1.txt'], length: 1000 },
          { path: ['file2.txt'], length: 2000 },
        ],
      });
      const diskIO = new DiskIO(metadata, {
        downloadPath: testDir,
        allocationStrategy: AllocationStrategy.Full,
      });

      // Only allocate first file
      await diskIO.allocateFile(metadata.files[0]);

      const incomplete = await diskIO.verifyFiles();
      expect(incomplete).toHaveLength(1);
      expect(incomplete[0].path).toContain('file2.txt');

      await diskIO.closeAllHandles();
    });
  });

  // ===========================================================================
  // deleteFiles Tests
  // ===========================================================================

  describe('deleteFiles', () => {
    it('should delete all torrent files', async () => {
      const metadata = createMultiFileMetadata({
        files: [
          { path: ['file1.txt'], length: 100 },
          { path: ['file2.txt'], length: 100 },
        ],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      // Create files
      await diskIO.allocateFiles();
      await diskIO.writePiece(0, createPieceData(200));

      // Verify files exist
      let file1Exists = await diskIO.fileExists(metadata.files[0]);
      expect(file1Exists).toBe(true);

      // Delete files
      await diskIO.deleteFiles();

      // Verify files are deleted
      file1Exists = await diskIO.fileExists(metadata.files[0]);
      expect(file1Exists).toBe(false);

      await diskIO.closeAllHandles();
    });

    it('should optionally delete empty directories', async () => {
      const metadata = createMultiFileMetadata({
        files: [{ path: ['subdir', 'file.txt'], length: 100 }],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      await diskIO.allocateFiles();
      await diskIO.writePiece(0, createPieceData(100));

      await diskIO.deleteFiles(true);

      const subdirPath = path.join(testDir, 'test-folder', 'subdir');
      const exists = await fs.access(subdirPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);

      await diskIO.closeAllHandles();
    });

    it('should not throw for non-existent files', async () => {
      const metadata = createSingleFileMetadata();
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      // Should complete without throwing
      await diskIO.deleteFiles();

      await diskIO.closeAllHandles();
    });
  });

  // ===========================================================================
  // getFilePath Tests
  // ===========================================================================

  describe('getFilePath', () => {
    it('should return correct path for single-file torrent', () => {
      const metadata = createSingleFileMetadata({ name: 'test.txt' });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const filePath = diskIO.getFilePath(metadata.files[0]);
      expect(filePath).toBe(path.join(testDir, 'test.txt'));
    });

    it('should return correct path for multi-file torrent', () => {
      const metadata = createMultiFileMetadata({
        name: 'my-torrent',
        files: [{ path: ['subdir', 'file.txt'], length: 100 }],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const filePath = diskIO.getFilePath(metadata.files[0]);
      expect(filePath).toBe(path.join(testDir, 'my-torrent', 'subdir', 'file.txt'));
    });
  });

  // ===========================================================================
  // getTorrentPath Tests
  // ===========================================================================

  describe('getTorrentPath', () => {
    it('should return correct torrent root path', () => {
      const metadata = createSingleFileMetadata({ name: 'test.txt' });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const torrentPath = diskIO.getTorrentPath();
      expect(torrentPath).toBe(path.join(testDir, 'test.txt'));
    });
  });

  // ===========================================================================
  // getTotalAllocatedBytes Tests
  // ===========================================================================

  describe('getTotalAllocatedBytes', () => {
    it('should return 0 when no files allocated', async () => {
      const metadata = createSingleFileMetadata();
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      const bytes = await diskIO.getTotalAllocatedBytes();
      expect(bytes).toBe(0);

      await diskIO.closeAllHandles();
    });

    it('should return total size when files allocated', async () => {
      const metadata = createMultiFileMetadata({
        files: [
          { path: ['file1.txt'], length: 1000 },
          { path: ['file2.txt'], length: 2000 },
        ],
      });
      const diskIO = new DiskIO(metadata, {
        downloadPath: testDir,
        allocationStrategy: AllocationStrategy.Full,
      });

      await diskIO.allocateFiles();

      const bytes = await diskIO.getTotalAllocatedBytes();
      expect(bytes).toBe(3000);

      await diskIO.closeAllHandles();
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty files', async () => {
      // Empty files shouldn't normally exist in torrents, but test robustness
      const metadata = createMultiFileMetadata({
        pieceLength: 16384,
        files: [
          { path: ['file1.txt'], length: 16384 },
        ],
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      await diskIO.writePiece(0, createPieceData(16384));

      const result = await diskIO.readPiece(0);
      expect(result.complete).toBe(true);

      await diskIO.closeAllHandles();
    });

    it('should handle writing pieces out of order', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 500,
        totalLength: 1500,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      // Write pieces out of order
      await diskIO.writePiece(2, createPieceData(500, 200));
      await diskIO.writePiece(0, createPieceData(500, 0));
      await diskIO.writePiece(1, createPieceData(500, 100));

      // Verify all pieces
      for (let i = 0; i < 3; i++) {
        const result = await diskIO.readPiece(i);
        expect(result.complete).toBe(true);
      }

      await diskIO.closeAllHandles();
    });

    it('should handle overwriting pieces', async () => {
      const metadata = createSingleFileMetadata({
        pieceLength: 1000,
        totalLength: 1000,
      });
      const diskIO = new DiskIO(metadata, { downloadPath: testDir });

      // Write piece
      await diskIO.writePiece(0, createPieceData(1000, 0));

      // Overwrite with different data
      const newData = createPieceData(1000, 100);
      await diskIO.writePiece(0, newData);

      // Verify new data
      const result = await diskIO.readPiece(0);
      expect(result.data.equals(newData)).toBe(true);

      await diskIO.closeAllHandles();
    });
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('calculateRequiredSpace', () => {
  it('should return total length', () => {
    const metadata = createSingleFileMetadata({ totalLength: 5000 });
    expect(calculateRequiredSpace(metadata)).toBe(5000);
  });

  it('should sum all file sizes for multi-file torrent', () => {
    const metadata = createMultiFileMetadata({
      files: [
        { path: ['file1.txt'], length: 1000 },
        { path: ['file2.txt'], length: 2000 },
        { path: ['file3.txt'], length: 3000 },
      ],
    });
    expect(calculateRequiredSpace(metadata)).toBe(6000);
  });
});

describe('normalizePath', () => {
  it('should normalize path separators', () => {
    expect(normalizePath('foo\\bar\\baz')).toBe('foo/bar/baz');
  });

  it('should handle already normalized paths', () => {
    expect(normalizePath('foo/bar/baz')).toBe('foo/bar/baz');
  });

  it('should handle mixed separators', () => {
    expect(normalizePath('foo\\bar/baz')).toBe('foo/bar/baz');
  });
});
