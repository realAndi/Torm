import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { encode } from '../../../src/engine/bencode.js';
import {
  parseTorrent,
  getPieceHash,
  getActualPieceLength,
  getFilesForPiece,
  createMagnetUri,
  TorrentMetadata,
} from '../../../src/engine/torrent/parser.js';
import { MetadataError } from '../../../src/engine/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a SHA-1 hash
 */
function sha1(data: Buffer | string): Buffer {
  return createHash('sha1')
    .update(typeof data === 'string' ? Buffer.from(data) : data)
    .digest();
}

/**
 * Create piece hashes from data blocks
 */
function createPieceHashes(...pieces: Buffer[]): Buffer {
  return Buffer.concat(pieces.map((p) => sha1(p)));
}

/**
 * Create a minimal valid single-file torrent
 */
function createSingleFileTorrent(options: {
  name?: string;
  pieceLength?: number;
  totalLength?: number;
  announce?: string;
  isPrivate?: boolean;
  comment?: string;
  createdBy?: string;
  creationDate?: number;
  announceList?: string[][];
} = {}): Buffer {
  const name = options.name ?? 'test.txt';
  const pieceLength = options.pieceLength ?? 16384;
  const totalLength = options.totalLength ?? 1000;
  const announce = options.announce ?? 'http://tracker.example.com/announce';

  const pieceCount = Math.ceil(totalLength / pieceLength);
  const pieces = Buffer.alloc(pieceCount * 20);
  // Fill with fake hashes
  for (let i = 0; i < pieceCount; i++) {
    sha1(`piece-${i}`).copy(pieces, i * 20);
  }

  const info: { [key: string]: unknown } = {
    name: Buffer.from(name),
    'piece length': pieceLength,
    pieces,
    length: totalLength,
  };

  if (options.isPrivate) {
    info['private'] = 1;
  }

  const torrent: { [key: string]: unknown } = {
    info,
    announce: Buffer.from(announce),
  };

  if (options.announceList) {
    torrent['announce-list'] = options.announceList.map((tier) =>
      tier.map((url) => Buffer.from(url))
    );
  }

  if (options.comment) {
    torrent['comment'] = Buffer.from(options.comment);
  }

  if (options.createdBy) {
    torrent['created by'] = Buffer.from(options.createdBy);
  }

  if (options.creationDate) {
    torrent['creation date'] = options.creationDate;
  }

  return encode(torrent as any);
}

/**
 * Create a minimal valid multi-file torrent
 */
function createMultiFileTorrent(options: {
  name?: string;
  pieceLength?: number;
  announce?: string;
  files?: Array<{ path: string[]; length: number }>;
} = {}): Buffer {
  const name = options.name ?? 'test-folder';
  const pieceLength = options.pieceLength ?? 16384;
  const announce = options.announce ?? 'http://tracker.example.com/announce';
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

  const info: { [key: string]: unknown } = {
    name: Buffer.from(name),
    'piece length': pieceLength,
    pieces,
    files: files.map((f) => ({
      path: f.path.map((p) => Buffer.from(p)),
      length: f.length,
    })),
  };

  const torrent: { [key: string]: unknown } = {
    info,
    announce: Buffer.from(announce),
  };

  return encode(torrent as any);
}

// =============================================================================
// parseTorrent Tests
// =============================================================================

describe('parseTorrent', () => {
  describe('single-file torrents', () => {
    it('should parse a minimal valid single-file torrent', () => {
      const torrentData = createSingleFileTorrent();
      const metadata = parseTorrent(torrentData);

      expect(metadata.name).toBe('test.txt');
      expect(metadata.pieceLength).toBe(16384);
      expect(metadata.totalLength).toBe(1000);
      expect(metadata.pieceCount).toBe(1);
      expect(metadata.files).toHaveLength(1);
      expect(metadata.files[0].path).toBe('test.txt');
      expect(metadata.files[0].length).toBe(1000);
      expect(metadata.files[0].offset).toBe(0);
      expect(metadata.isPrivate).toBe(false);
      expect(metadata.announce).toBe('http://tracker.example.com/announce');
    });

    it('should calculate correct info hash', () => {
      const torrentData = createSingleFileTorrent();
      const metadata = parseTorrent(torrentData);

      expect(metadata.infoHash).toBeInstanceOf(Buffer);
      expect(metadata.infoHash.length).toBe(20);
      expect(metadata.infoHashHex).toBe(metadata.infoHash.toString('hex'));
    });

    it('should handle multiple pieces', () => {
      const torrentData = createSingleFileTorrent({
        pieceLength: 16384,
        totalLength: 50000,
      });
      const metadata = parseTorrent(torrentData);

      expect(metadata.pieceCount).toBe(4); // 50000 / 16384 = 3.05, ceil = 4
      expect(metadata.pieces.length).toBe(80); // 4 * 20
    });

    it('should parse private torrent flag', () => {
      const torrentData = createSingleFileTorrent({ isPrivate: true });
      const metadata = parseTorrent(torrentData);

      expect(metadata.isPrivate).toBe(true);
    });

    it('should parse optional comment field', () => {
      const torrentData = createSingleFileTorrent({ comment: 'Test comment' });
      const metadata = parseTorrent(torrentData);

      expect(metadata.comment).toBe('Test comment');
    });

    it('should parse optional created by field', () => {
      const torrentData = createSingleFileTorrent({ createdBy: 'Test Client 1.0' });
      const metadata = parseTorrent(torrentData);

      expect(metadata.createdBy).toBe('Test Client 1.0');
    });

    it('should parse optional creation date field', () => {
      const timestamp = 1609459200; // 2021-01-01
      const torrentData = createSingleFileTorrent({ creationDate: timestamp });
      const metadata = parseTorrent(torrentData);

      expect(metadata.creationDate).toBe(timestamp);
    });

    it('should parse announce-list', () => {
      const torrentData = createSingleFileTorrent({
        announceList: [
          ['http://tracker1.example.com/announce', 'http://tracker2.example.com/announce'],
          ['http://backup-tracker.example.com/announce'],
        ],
      });
      const metadata = parseTorrent(torrentData);

      expect(metadata.announceList).toBeDefined();
      expect(metadata.announceList).toHaveLength(2);
      expect(metadata.announceList![0]).toHaveLength(2);
      expect(metadata.announceList![1]).toHaveLength(1);
    });

    it('should store raw info dictionary', () => {
      const torrentData = createSingleFileTorrent();
      const metadata = parseTorrent(torrentData);

      expect(metadata.rawInfo).toBeDefined();
      expect(metadata.rawInfo['name']).toBeDefined();
      expect(metadata.rawInfo['piece length']).toBeDefined();
      expect(metadata.rawInfo['pieces']).toBeDefined();
    });
  });

  describe('multi-file torrents', () => {
    it('should parse a minimal valid multi-file torrent', () => {
      const torrentData = createMultiFileTorrent();
      const metadata = parseTorrent(torrentData);

      expect(metadata.name).toBe('test-folder');
      expect(metadata.files).toHaveLength(2);
      expect(metadata.totalLength).toBe(1250);
    });

    it('should construct correct file paths', () => {
      const torrentData = createMultiFileTorrent({
        name: 'my-torrent',
        files: [
          { path: ['file1.txt'], length: 100 },
          { path: ['subdir', 'file2.txt'], length: 200 },
          { path: ['subdir', 'nested', 'file3.txt'], length: 300 },
        ],
      });
      const metadata = parseTorrent(torrentData);

      expect(metadata.files[0].path).toBe('my-torrent/file1.txt');
      expect(metadata.files[1].path).toBe('my-torrent/subdir/file2.txt');
      expect(metadata.files[2].path).toBe('my-torrent/subdir/nested/file3.txt');
    });

    it('should calculate correct file offsets', () => {
      const torrentData = createMultiFileTorrent({
        files: [
          { path: ['file1.txt'], length: 100 },
          { path: ['file2.txt'], length: 200 },
          { path: ['file3.txt'], length: 300 },
        ],
      });
      const metadata = parseTorrent(torrentData);

      expect(metadata.files[0].offset).toBe(0);
      expect(metadata.files[1].offset).toBe(100);
      expect(metadata.files[2].offset).toBe(300);
    });

    it('should calculate correct total length', () => {
      const torrentData = createMultiFileTorrent({
        files: [
          { path: ['a.txt'], length: 1000 },
          { path: ['b.txt'], length: 2000 },
          { path: ['c.txt'], length: 3000 },
        ],
      });
      const metadata = parseTorrent(torrentData);

      expect(metadata.totalLength).toBe(6000);
    });
  });

  describe('error handling', () => {
    it('should throw MetadataError for empty buffer', () => {
      expect(() => parseTorrent(Buffer.alloc(0))).toThrow(MetadataError);
    });

    it('should throw MetadataError for invalid bencoding', () => {
      expect(() => parseTorrent(Buffer.from('invalid data'))).toThrow(MetadataError);
    });

    it('should throw MetadataError for non-dictionary torrent', () => {
      const data = encode([1, 2, 3]);
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow('must be a dictionary');
    });

    it('should throw MetadataError for missing info dictionary', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow("'info'");
    });

    it('should throw MetadataError for missing name', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          'piece length': 16384,
          pieces: sha1('test'),
          length: 100,
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow("'name'");
    });

    it('should throw MetadataError for missing piece length', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          name: Buffer.from('test.txt'),
          pieces: sha1('test'),
          length: 100,
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow("'piece length'");
    });

    it('should throw MetadataError for missing pieces', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          name: Buffer.from('test.txt'),
          'piece length': 16384,
          length: 100,
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow("'pieces'");
    });

    it('should throw MetadataError for invalid pieces length', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          name: Buffer.from('test.txt'),
          'piece length': 16384,
          pieces: Buffer.alloc(15), // Not a multiple of 20
          length: 100,
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow('multiple of 20');
    });

    it('should throw MetadataError for missing announce and announce-list', () => {
      const data = encode({
        info: {
          name: Buffer.from('test.txt'),
          'piece length': 16384,
          pieces: sha1('test'),
          length: 100,
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow("'announce'");
    });

    it('should throw MetadataError for invalid piece length', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          name: Buffer.from('test.txt'),
          'piece length': -1,
          pieces: sha1('test'),
          length: 100,
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow('Invalid piece length');
    });

    it('should throw MetadataError for piece count mismatch', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          name: Buffer.from('test.txt'),
          'piece length': 16384,
          pieces: Buffer.alloc(40), // 2 pieces, but length would need only 1
          length: 100,
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow('Piece count mismatch');
    });

    it('should throw MetadataError for empty torrent name', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          name: Buffer.from(''),
          'piece length': 16384,
          pieces: sha1('test'),
          length: 100,
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow('Invalid torrent name');
    });

    it('should throw MetadataError for invalid path components in multi-file', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          name: Buffer.from('test-folder'),
          'piece length': 16384,
          pieces: sha1('test'),
          files: [
            {
              path: [Buffer.from('..')], // Invalid path component
              length: 100,
            },
          ],
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow('Invalid path component');
    });

    it('should throw MetadataError for empty files list', () => {
      const data = encode({
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          name: Buffer.from('test-folder'),
          'piece length': 16384,
          pieces: sha1('test'),
          files: [],
        },
      });
      expect(() => parseTorrent(data)).toThrow(MetadataError);
      expect(() => parseTorrent(data)).toThrow('no files');
    });
  });

  describe('edge cases', () => {
    it('should use first tracker from announce-list if announce is missing', () => {
      const info = {
        name: Buffer.from('test.txt'),
        'piece length': 16384,
        pieces: sha1('test'),
        length: 100,
      };

      const data = encode({
        info,
        'announce-list': [[Buffer.from('http://tracker1.example.com/announce')]],
      });

      const metadata = parseTorrent(data);
      expect(metadata.announce).toBe('http://tracker1.example.com/announce');
    });

    it('should handle torrent with exact piece boundary', () => {
      const pieceLength = 16384;
      const totalLength = pieceLength * 3; // Exactly 3 pieces

      const torrentData = createSingleFileTorrent({
        pieceLength,
        totalLength,
      });
      const metadata = parseTorrent(torrentData);

      expect(metadata.pieceCount).toBe(3);
      expect(metadata.totalLength).toBe(totalLength);
    });

    it('should handle very large torrent', () => {
      const pieceLength = 262144; // 256 KB
      const totalLength = 1073741824; // 1 GB

      const torrentData = createSingleFileTorrent({
        pieceLength,
        totalLength,
      });
      const metadata = parseTorrent(torrentData);

      expect(metadata.pieceCount).toBe(4096);
      expect(metadata.totalLength).toBe(totalLength);
    });

    it('should handle unicode in name', () => {
      const torrentData = createSingleFileTorrent({
        name: '\u4e2d\u6587\u6587\u4ef6.txt', // Chinese characters
      });
      const metadata = parseTorrent(torrentData);

      expect(metadata.name).toBe('\u4e2d\u6587\u6587\u4ef6.txt');
    });

    it('should handle unicode in file paths', () => {
      const torrentData = createMultiFileTorrent({
        name: 'test',
        files: [
          { path: ['\u65e5\u672c\u8a9e', 'file.txt'], length: 100 }, // Japanese characters
        ],
      });
      const metadata = parseTorrent(torrentData);

      expect(metadata.files[0].path).toBe('test/\u65e5\u672c\u8a9e/file.txt');
    });
  });
});

// =============================================================================
// getPieceHash Tests
// =============================================================================

describe('getPieceHash', () => {
  it('should return correct hash for each piece', () => {
    const torrentData = createSingleFileTorrent({
      pieceLength: 16384,
      totalLength: 50000, // 4 pieces
    });
    const metadata = parseTorrent(torrentData);

    for (let i = 0; i < metadata.pieceCount; i++) {
      const hash = getPieceHash(metadata, i);
      expect(hash).toBeInstanceOf(Buffer);
      expect(hash.length).toBe(20);
    }
  });

  it('should throw for invalid piece index', () => {
    const torrentData = createSingleFileTorrent();
    const metadata = parseTorrent(torrentData);

    expect(() => getPieceHash(metadata, -1)).toThrow('Invalid piece index');
    expect(() => getPieceHash(metadata, metadata.pieceCount)).toThrow('Invalid piece index');
  });

  it('should return different hashes for different pieces', () => {
    const torrentData = createSingleFileTorrent({
      pieceLength: 16384,
      totalLength: 50000,
    });
    const metadata = parseTorrent(torrentData);

    const hash0 = getPieceHash(metadata, 0);
    const hash1 = getPieceHash(metadata, 1);

    expect(hash0.equals(hash1)).toBe(false);
  });
});

// =============================================================================
// getActualPieceLength Tests
// =============================================================================

describe('getActualPieceLength', () => {
  it('should return standard piece length for non-last pieces', () => {
    const torrentData = createSingleFileTorrent({
      pieceLength: 16384,
      totalLength: 50000, // 4 pieces
    });
    const metadata = parseTorrent(torrentData);

    expect(getActualPieceLength(metadata, 0)).toBe(16384);
    expect(getActualPieceLength(metadata, 1)).toBe(16384);
    expect(getActualPieceLength(metadata, 2)).toBe(16384);
  });

  it('should return correct length for last piece', () => {
    const torrentData = createSingleFileTorrent({
      pieceLength: 16384,
      totalLength: 50000, // 4 pieces, last is 50000 - 3*16384 = 848 bytes
    });
    const metadata = parseTorrent(torrentData);

    expect(getActualPieceLength(metadata, 3)).toBe(848);
  });

  it('should return standard length when last piece is full', () => {
    const pieceLength = 16384;
    const totalLength = pieceLength * 3; // Exactly 3 full pieces

    const torrentData = createSingleFileTorrent({
      pieceLength,
      totalLength,
    });
    const metadata = parseTorrent(torrentData);

    expect(getActualPieceLength(metadata, 2)).toBe(pieceLength);
  });

  it('should throw for invalid piece index', () => {
    const torrentData = createSingleFileTorrent();
    const metadata = parseTorrent(torrentData);

    expect(() => getActualPieceLength(metadata, -1)).toThrow('Invalid piece index');
    expect(() => getActualPieceLength(metadata, metadata.pieceCount)).toThrow('Invalid piece index');
  });
});

// =============================================================================
// getFilesForPiece Tests
// =============================================================================

describe('getFilesForPiece', () => {
  it('should return single file for single-file torrent', () => {
    const torrentData = createSingleFileTorrent({
      pieceLength: 16384,
      totalLength: 10000,
    });
    const metadata = parseTorrent(torrentData);

    const files = getFilesForPiece(metadata, 0);

    expect(files).toHaveLength(1);
    expect(files[0].file.path).toBe('test.txt');
    expect(files[0].fileOffset).toBe(0);
    expect(files[0].length).toBe(10000);
  });

  it('should handle piece contained in single file (multi-file)', () => {
    const torrentData = createMultiFileTorrent({
      pieceLength: 16384,
      files: [
        { path: ['file1.txt'], length: 20000 },
        { path: ['file2.txt'], length: 20000 },
      ],
    });
    const metadata = parseTorrent(torrentData);

    // First piece is entirely within file1
    const files = getFilesForPiece(metadata, 0);

    expect(files).toHaveLength(1);
    expect(files[0].file.path).toContain('file1.txt');
    expect(files[0].fileOffset).toBe(0);
    expect(files[0].length).toBe(16384);
  });

  it('should handle piece spanning multiple files', () => {
    const torrentData = createMultiFileTorrent({
      pieceLength: 16384,
      files: [
        { path: ['file1.txt'], length: 10000 },
        { path: ['file2.txt'], length: 10000 },
      ],
    });
    const metadata = parseTorrent(torrentData);

    // First piece spans both files (0-16383)
    // file1: 0-9999 (10000 bytes), file2: 10000-16383 (6384 bytes)
    const files = getFilesForPiece(metadata, 0);

    expect(files).toHaveLength(2);
    expect(files[0].file.path).toContain('file1.txt');
    expect(files[0].fileOffset).toBe(0);
    expect(files[0].length).toBe(10000);
    expect(files[1].file.path).toContain('file2.txt');
    expect(files[1].fileOffset).toBe(0);
    expect(files[1].length).toBe(6384);
  });

  it('should handle piece starting in middle of file', () => {
    const torrentData = createMultiFileTorrent({
      pieceLength: 16384,
      files: [
        { path: ['file1.txt'], length: 20000 },
        { path: ['file2.txt'], length: 20000 },
      ],
    });
    const metadata = parseTorrent(torrentData);

    // Second piece starts at offset 16384 in file1
    const files = getFilesForPiece(metadata, 1);

    expect(files).toHaveLength(2);
    expect(files[0].file.path).toContain('file1.txt');
    expect(files[0].fileOffset).toBe(16384);
    expect(files[0].length).toBe(3616); // 20000 - 16384
  });

  it('should throw for invalid piece index', () => {
    const torrentData = createSingleFileTorrent();
    const metadata = parseTorrent(torrentData);

    expect(() => getFilesForPiece(metadata, -1)).toThrow('Invalid piece index');
    expect(() => getFilesForPiece(metadata, metadata.pieceCount)).toThrow('Invalid piece index');
  });

  it('should handle many small files', () => {
    const torrentData = createMultiFileTorrent({
      pieceLength: 16384,
      files: [
        { path: ['a.txt'], length: 1000 },
        { path: ['b.txt'], length: 1000 },
        { path: ['c.txt'], length: 1000 },
        { path: ['d.txt'], length: 1000 },
        { path: ['e.txt'], length: 1000 },
        { path: ['f.txt'], length: 1000 },
        { path: ['g.txt'], length: 1000 },
        { path: ['h.txt'], length: 1000 },
        { path: ['i.txt'], length: 1000 },
        { path: ['j.txt'], length: 1000 },
      ],
    });
    const metadata = parseTorrent(torrentData);

    // First piece spans all 10 files (10000 bytes total, piece is 10000 bytes)
    const files = getFilesForPiece(metadata, 0);

    expect(files).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(files[i].length).toBe(1000);
    }
  });
});

// =============================================================================
// createMagnetUri Tests
// =============================================================================

describe('createMagnetUri', () => {
  it('should create valid magnet URI', () => {
    const torrentData = createSingleFileTorrent({
      name: 'test.txt',
      announce: 'http://tracker.example.com/announce',
    });
    const metadata = parseTorrent(torrentData);

    const magnet = createMagnetUri(metadata);

    expect(magnet).toContain('magnet:?');
    expect(magnet).toContain(`xt=urn:btih:${metadata.infoHashHex}`);
    expect(magnet).toContain('dn=test.txt');
    expect(magnet).toContain('tr=http%3A%2F%2Ftracker.example.com%2Fannounce');
  });

  it('should include all trackers from announce-list', () => {
    const torrentData = createSingleFileTorrent({
      announceList: [
        ['http://tracker1.example.com/announce'],
        ['http://tracker2.example.com/announce'],
      ],
    });
    const metadata = parseTorrent(torrentData);

    const magnet = createMagnetUri(metadata);

    expect(magnet).toContain('tr=http%3A%2F%2Ftracker1.example.com%2Fannounce');
    expect(magnet).toContain('tr=http%3A%2F%2Ftracker2.example.com%2Fannounce');
  });

  it('should properly encode special characters in name', () => {
    const torrentData = createSingleFileTorrent({
      name: 'Test File & More.txt',
    });
    const metadata = parseTorrent(torrentData);

    const magnet = createMagnetUri(metadata);

    expect(magnet).toContain('dn=Test%20File%20%26%20More.txt');
  });
});

// =============================================================================
// Info Hash Consistency Tests
// =============================================================================

describe('info hash consistency', () => {
  it('should produce same info hash for identical torrent content', () => {
    const torrentData1 = createSingleFileTorrent({ name: 'test.txt', totalLength: 1000 });
    const torrentData2 = createSingleFileTorrent({ name: 'test.txt', totalLength: 1000 });

    const metadata1 = parseTorrent(torrentData1);
    const metadata2 = parseTorrent(torrentData2);

    expect(metadata1.infoHash.equals(metadata2.infoHash)).toBe(true);
  });

  it('should produce different info hash for different content', () => {
    const torrentData1 = createSingleFileTorrent({ name: 'test.txt', totalLength: 1000 });
    const torrentData2 = createSingleFileTorrent({ name: 'test.txt', totalLength: 2000 });

    const metadata1 = parseTorrent(torrentData1);
    const metadata2 = parseTorrent(torrentData2);

    expect(metadata1.infoHash.equals(metadata2.infoHash)).toBe(false);
  });

  it('should not change info hash based on announce URL', () => {
    const torrentData1 = createSingleFileTorrent({
      name: 'test.txt',
      announce: 'http://tracker1.example.com/announce',
    });
    const torrentData2 = createSingleFileTorrent({
      name: 'test.txt',
      announce: 'http://tracker2.example.com/announce',
    });

    const metadata1 = parseTorrent(torrentData1);
    const metadata2 = parseTorrent(torrentData2);

    // Info hash should be the same since announce is outside info dict
    expect(metadata1.infoHash.equals(metadata2.infoHash)).toBe(true);
  });
});
