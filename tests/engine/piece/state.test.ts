import { describe, it, expect, beforeEach } from 'vitest';
import {
  BLOCK_SIZE,
  BlockState,
  PieceState,
  TorrentPieceMap,
  allocateBitfield,
  hasBit,
  setBit,
  clearBit,
  countBits,
} from '../../../src/engine/piece/state.js';

// =============================================================================
// Constants Tests
// =============================================================================

describe('BLOCK_SIZE', () => {
  it('should be 16384 bytes (16 KiB)', () => {
    expect(BLOCK_SIZE).toBe(16384);
  });
});

// =============================================================================
// BlockState Tests
// =============================================================================

describe('BlockState', () => {
  it('should have Missing state with value "missing"', () => {
    expect(BlockState.Missing).toBe('missing');
  });

  it('should have Requested state with value "requested"', () => {
    expect(BlockState.Requested).toBe('requested');
  });

  it('should have Received state with value "received"', () => {
    expect(BlockState.Received).toBe('received');
  });

  it('should have exactly three states', () => {
    const states = Object.values(BlockState);
    expect(states).toHaveLength(3);
    expect(states).toContain('missing');
    expect(states).toContain('requested');
    expect(states).toContain('received');
  });
});

// =============================================================================
// PieceState Tests
// =============================================================================

describe('PieceState', () => {
  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create a piece state with the correct properties', () => {
      const piece = new PieceState(0, 262144); // 256 KiB

      expect(piece.pieceIndex).toBe(0);
      expect(piece.pieceLength).toBe(262144);
      expect(piece.blockCount).toBe(16); // 262144 / 16384 = 16
      expect(piece.data).toBeNull();
    });

    it('should calculate correct block count for non-aligned piece length', () => {
      // 100000 bytes = 6.1 blocks, should round up to 7
      const piece = new PieceState(0, 100000);
      expect(piece.blockCount).toBe(7);
    });

    it('should calculate correct block count for exactly one block', () => {
      const piece = new PieceState(0, BLOCK_SIZE);
      expect(piece.blockCount).toBe(1);
    });

    it('should calculate correct block count for less than one block', () => {
      const piece = new PieceState(0, 1000);
      expect(piece.blockCount).toBe(1);
    });

    it('should initialize all blocks to Missing state', () => {
      const piece = new PieceState(0, 65536); // 4 blocks
      expect(piece.blocks).toHaveLength(4);
      expect(piece.blocks.every((s) => s === BlockState.Missing)).toBe(true);
    });

    it('should throw error for negative piece index', () => {
      expect(() => new PieceState(-1, 16384)).toThrow('Invalid piece index');
    });

    it('should throw error for zero piece length', () => {
      expect(() => new PieceState(0, 0)).toThrow('Invalid piece length');
    });

    it('should throw error for negative piece length', () => {
      expect(() => new PieceState(0, -100)).toThrow('Invalid piece length');
    });

    it('should allow piece index of zero', () => {
      const piece = new PieceState(0, 16384);
      expect(piece.pieceIndex).toBe(0);
    });

    it('should allow large piece indices', () => {
      const piece = new PieceState(10000, 16384);
      expect(piece.pieceIndex).toBe(10000);
    });
  });

  // ===========================================================================
  // getBlockState Tests
  // ===========================================================================

  describe('getBlockState', () => {
    let piece: PieceState;

    beforeEach(() => {
      piece = new PieceState(0, 65536); // 4 blocks
    });

    it('should return Missing for uninitialized blocks', () => {
      expect(piece.getBlockState(0)).toBe(BlockState.Missing);
      expect(piece.getBlockState(1)).toBe(BlockState.Missing);
      expect(piece.getBlockState(3)).toBe(BlockState.Missing);
    });

    it('should throw error for negative block index', () => {
      expect(() => piece.getBlockState(-1)).toThrow('Invalid block index');
    });

    it('should throw error for block index out of range', () => {
      expect(() => piece.getBlockState(4)).toThrow('Invalid block index');
      expect(() => piece.getBlockState(100)).toThrow('Invalid block index');
    });
  });

  // ===========================================================================
  // setBlockState Tests
  // ===========================================================================

  describe('setBlockState', () => {
    let piece: PieceState;

    beforeEach(() => {
      piece = new PieceState(0, 65536); // 4 blocks
    });

    it('should set block state correctly', () => {
      piece.setBlockState(0, BlockState.Requested);
      expect(piece.getBlockState(0)).toBe(BlockState.Requested);
    });

    it('should allow transitioning through all states', () => {
      piece.setBlockState(1, BlockState.Missing);
      expect(piece.getBlockState(1)).toBe(BlockState.Missing);

      piece.setBlockState(1, BlockState.Requested);
      expect(piece.getBlockState(1)).toBe(BlockState.Requested);

      piece.setBlockState(1, BlockState.Received);
      expect(piece.getBlockState(1)).toBe(BlockState.Received);
    });

    it('should throw error for negative block index', () => {
      expect(() => piece.setBlockState(-1, BlockState.Requested)).toThrow(
        'Invalid block index'
      );
    });

    it('should throw error for block index out of range', () => {
      expect(() => piece.setBlockState(4, BlockState.Requested)).toThrow(
        'Invalid block index'
      );
    });
  });

  // ===========================================================================
  // getBlockOffset Tests
  // ===========================================================================

  describe('getBlockOffset', () => {
    let piece: PieceState;

    beforeEach(() => {
      piece = new PieceState(0, 65536); // 4 blocks
    });

    it('should return 0 for first block', () => {
      expect(piece.getBlockOffset(0)).toBe(0);
    });

    it('should return correct offset for subsequent blocks', () => {
      expect(piece.getBlockOffset(1)).toBe(BLOCK_SIZE);
      expect(piece.getBlockOffset(2)).toBe(BLOCK_SIZE * 2);
      expect(piece.getBlockOffset(3)).toBe(BLOCK_SIZE * 3);
    });

    it('should throw error for invalid block index', () => {
      expect(() => piece.getBlockOffset(-1)).toThrow('Invalid block index');
      expect(() => piece.getBlockOffset(4)).toThrow('Invalid block index');
    });
  });

  // ===========================================================================
  // getBlockLength Tests
  // ===========================================================================

  describe('getBlockLength', () => {
    it('should return BLOCK_SIZE for non-last blocks', () => {
      const piece = new PieceState(0, 65536); // 4 full blocks
      expect(piece.getBlockLength(0)).toBe(BLOCK_SIZE);
      expect(piece.getBlockLength(1)).toBe(BLOCK_SIZE);
      expect(piece.getBlockLength(2)).toBe(BLOCK_SIZE);
    });

    it('should return BLOCK_SIZE for last block when aligned', () => {
      const piece = new PieceState(0, BLOCK_SIZE * 4); // Exactly 4 blocks
      expect(piece.getBlockLength(3)).toBe(BLOCK_SIZE);
    });

    it('should return correct length for last block when not aligned', () => {
      // 50000 bytes: 3 full blocks + 784 bytes
      const piece = new PieceState(0, 50000);
      expect(piece.blockCount).toBe(4);
      expect(piece.getBlockLength(0)).toBe(BLOCK_SIZE);
      expect(piece.getBlockLength(1)).toBe(BLOCK_SIZE);
      expect(piece.getBlockLength(2)).toBe(BLOCK_SIZE);
      expect(piece.getBlockLength(3)).toBe(50000 - BLOCK_SIZE * 3);
    });

    it('should handle single block piece', () => {
      const piece = new PieceState(0, 1000);
      expect(piece.blockCount).toBe(1);
      expect(piece.getBlockLength(0)).toBe(1000);
    });

    it('should throw error for invalid block index', () => {
      const piece = new PieceState(0, 65536);
      expect(() => piece.getBlockLength(-1)).toThrow('Invalid block index');
      expect(() => piece.getBlockLength(4)).toThrow('Invalid block index');
    });
  });

  // ===========================================================================
  // writeBlock Tests
  // ===========================================================================

  describe('writeBlock', () => {
    let piece: PieceState;

    beforeEach(() => {
      piece = new PieceState(0, BLOCK_SIZE * 2); // 2 blocks
    });

    it('should allocate data buffer on first write', () => {
      expect(piece.data).toBeNull();

      const blockData = Buffer.alloc(BLOCK_SIZE, 0xaa);
      piece.writeBlock(0, blockData);

      expect(piece.data).not.toBeNull();
      expect(piece.data?.length).toBe(BLOCK_SIZE * 2);
    });

    it('should write block data at correct offset', () => {
      const block0 = Buffer.alloc(BLOCK_SIZE, 0xaa);
      const block1 = Buffer.alloc(BLOCK_SIZE, 0xbb);

      piece.writeBlock(0, block0);
      piece.writeBlock(1, block1);

      expect(piece.data?.slice(0, BLOCK_SIZE)).toEqual(block0);
      expect(piece.data?.slice(BLOCK_SIZE)).toEqual(block1);
    });

    it('should set block state to Received', () => {
      const blockData = Buffer.alloc(BLOCK_SIZE, 0xaa);
      piece.setBlockState(0, BlockState.Requested);

      piece.writeBlock(0, blockData);

      expect(piece.getBlockState(0)).toBe(BlockState.Received);
    });

    it('should throw error for wrong block data length', () => {
      const wrongSize = Buffer.alloc(1000); // Wrong size
      expect(() => piece.writeBlock(0, wrongSize)).toThrow('Invalid block data length');
    });

    it('should handle smaller last block', () => {
      const piece = new PieceState(0, BLOCK_SIZE + 1000); // 1 full block + 1000 bytes
      const lastBlockData = Buffer.alloc(1000, 0xcc);

      piece.writeBlock(1, lastBlockData);

      expect(piece.getBlockState(1)).toBe(BlockState.Received);
      expect(piece.data?.slice(BLOCK_SIZE)).toEqual(lastBlockData);
    });

    it('should throw error for invalid block index', () => {
      const blockData = Buffer.alloc(BLOCK_SIZE);
      expect(() => piece.writeBlock(-1, blockData)).toThrow('Invalid block index');
      expect(() => piece.writeBlock(2, blockData)).toThrow('Invalid block index');
    });
  });

  // ===========================================================================
  // getMissingBlocks Tests
  // ===========================================================================

  describe('getMissingBlocks', () => {
    let piece: PieceState;

    beforeEach(() => {
      piece = new PieceState(0, BLOCK_SIZE * 4); // 4 blocks
    });

    it('should return all block indices when none requested', () => {
      expect(piece.getMissingBlocks()).toEqual([0, 1, 2, 3]);
    });

    it('should not include requested blocks', () => {
      piece.setBlockState(1, BlockState.Requested);
      expect(piece.getMissingBlocks()).toEqual([0, 2, 3]);
    });

    it('should not include received blocks', () => {
      piece.setBlockState(2, BlockState.Received);
      expect(piece.getMissingBlocks()).toEqual([0, 1, 3]);
    });

    it('should return empty array when all blocks requested or received', () => {
      piece.setBlockState(0, BlockState.Requested);
      piece.setBlockState(1, BlockState.Received);
      piece.setBlockState(2, BlockState.Requested);
      piece.setBlockState(3, BlockState.Received);

      expect(piece.getMissingBlocks()).toEqual([]);
    });
  });

  // ===========================================================================
  // getRequestedBlocks Tests
  // ===========================================================================

  describe('getRequestedBlocks', () => {
    let piece: PieceState;

    beforeEach(() => {
      piece = new PieceState(0, BLOCK_SIZE * 4); // 4 blocks
    });

    it('should return empty array when none requested', () => {
      expect(piece.getRequestedBlocks()).toEqual([]);
    });

    it('should return indices of requested blocks', () => {
      piece.setBlockState(1, BlockState.Requested);
      piece.setBlockState(3, BlockState.Requested);
      expect(piece.getRequestedBlocks()).toEqual([1, 3]);
    });

    it('should not include received blocks', () => {
      piece.setBlockState(0, BlockState.Requested);
      piece.setBlockState(1, BlockState.Received);
      piece.setBlockState(2, BlockState.Requested);

      expect(piece.getRequestedBlocks()).toEqual([0, 2]);
    });
  });

  // ===========================================================================
  // isComplete Tests
  // ===========================================================================

  describe('isComplete', () => {
    let piece: PieceState;

    beforeEach(() => {
      piece = new PieceState(0, BLOCK_SIZE * 2); // 2 blocks
    });

    it('should return false when no blocks received', () => {
      expect(piece.isComplete()).toBe(false);
    });

    it('should return false when some blocks are missing', () => {
      piece.setBlockState(0, BlockState.Received);
      expect(piece.isComplete()).toBe(false);
    });

    it('should return false when some blocks are requested but not received', () => {
      piece.setBlockState(0, BlockState.Received);
      piece.setBlockState(1, BlockState.Requested);
      expect(piece.isComplete()).toBe(false);
    });

    it('should return true when all blocks are received', () => {
      piece.setBlockState(0, BlockState.Received);
      piece.setBlockState(1, BlockState.Received);
      expect(piece.isComplete()).toBe(true);
    });

    it('should work for single block piece', () => {
      const smallPiece = new PieceState(0, 1000);
      expect(smallPiece.isComplete()).toBe(false);
      smallPiece.setBlockState(0, BlockState.Received);
      expect(smallPiece.isComplete()).toBe(true);
    });
  });

  // ===========================================================================
  // getData Tests
  // ===========================================================================

  describe('getData', () => {
    let piece: PieceState;

    beforeEach(() => {
      piece = new PieceState(0, BLOCK_SIZE * 2); // 2 blocks
    });

    it('should throw error when piece is not complete', () => {
      expect(() => piece.getData()).toThrow('not complete');
    });

    it('should throw error when only some blocks received', () => {
      const block = Buffer.alloc(BLOCK_SIZE, 0xaa);
      piece.writeBlock(0, block);
      expect(() => piece.getData()).toThrow('not complete');
    });

    it('should return piece data when complete', () => {
      const block0 = Buffer.alloc(BLOCK_SIZE, 0xaa);
      const block1 = Buffer.alloc(BLOCK_SIZE, 0xbb);

      piece.writeBlock(0, block0);
      piece.writeBlock(1, block1);

      const data = piece.getData();
      expect(data.length).toBe(BLOCK_SIZE * 2);
      expect(data.slice(0, BLOCK_SIZE)).toEqual(block0);
      expect(data.slice(BLOCK_SIZE)).toEqual(block1);
    });
  });

  // ===========================================================================
  // reset Tests
  // ===========================================================================

  describe('reset', () => {
    let piece: PieceState;

    beforeEach(() => {
      piece = new PieceState(0, BLOCK_SIZE * 2); // 2 blocks
    });

    it('should reset all blocks to Missing state', () => {
      piece.setBlockState(0, BlockState.Requested);
      piece.setBlockState(1, BlockState.Received);

      piece.reset();

      expect(piece.getBlockState(0)).toBe(BlockState.Missing);
      expect(piece.getBlockState(1)).toBe(BlockState.Missing);
    });

    it('should clear piece data', () => {
      const block = Buffer.alloc(BLOCK_SIZE, 0xaa);
      piece.writeBlock(0, block);
      expect(piece.data).not.toBeNull();

      piece.reset();

      expect(piece.data).toBeNull();
    });

    it('should allow piece to be redownloaded after reset', () => {
      const block0 = Buffer.alloc(BLOCK_SIZE, 0xaa);
      piece.writeBlock(0, block0);
      piece.setBlockState(1, BlockState.Requested);

      piece.reset();

      // Should be able to write blocks again
      const newBlock0 = Buffer.alloc(BLOCK_SIZE, 0xcc);
      piece.writeBlock(0, newBlock0);

      expect(piece.getBlockState(0)).toBe(BlockState.Received);
      expect(piece.data?.slice(0, 10)).toEqual(Buffer.alloc(10, 0xcc));
    });
  });
});

// =============================================================================
// TorrentPieceMap Tests
// =============================================================================

describe('TorrentPieceMap', () => {
  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create a torrent piece map with correct properties', () => {
      const map = new TorrentPieceMap(100, 262144, 26214400);

      expect(map.pieceCount).toBe(100);
      expect(map.pieceLength).toBe(262144);
      expect(map.totalLength).toBe(26214400);
      expect(map.pieces.size).toBe(0);
      expect(map.completedPieces.size).toBe(0);
    });

    it('should throw error for zero piece count', () => {
      expect(() => new TorrentPieceMap(0, 262144, 26214400)).toThrow('Invalid piece count');
    });

    it('should throw error for negative piece count', () => {
      expect(() => new TorrentPieceMap(-1, 262144, 26214400)).toThrow('Invalid piece count');
    });

    it('should throw error for zero piece length', () => {
      expect(() => new TorrentPieceMap(100, 0, 26214400)).toThrow('Invalid piece length');
    });

    it('should throw error for negative piece length', () => {
      expect(() => new TorrentPieceMap(100, -1, 26214400)).toThrow('Invalid piece length');
    });

    it('should throw error for zero total length', () => {
      expect(() => new TorrentPieceMap(100, 262144, 0)).toThrow('Invalid total length');
    });

    it('should throw error for negative total length', () => {
      expect(() => new TorrentPieceMap(100, 262144, -1)).toThrow('Invalid total length');
    });
  });

  // ===========================================================================
  // getPieceLength Tests
  // ===========================================================================

  describe('getPieceLength', () => {
    it('should return standard piece length for non-last pieces', () => {
      const map = new TorrentPieceMap(10, 262144, 2621440);

      expect(map.getPieceLength(0)).toBe(262144);
      expect(map.getPieceLength(5)).toBe(262144);
      expect(map.getPieceLength(8)).toBe(262144);
    });

    it('should return standard length for last piece when aligned', () => {
      // 10 pieces of 262144 = 2621440 total, evenly divisible
      const map = new TorrentPieceMap(10, 262144, 2621440);
      expect(map.getPieceLength(9)).toBe(262144);
    });

    it('should return smaller length for last piece when not aligned', () => {
      // 10 pieces, standard 262144, but total is 2500000
      // Last piece should be 2500000 - (9 * 262144) = 2500000 - 2359296 = 140704
      const map = new TorrentPieceMap(10, 262144, 2500000);
      expect(map.getPieceLength(9)).toBe(140704);
    });

    it('should throw error for invalid piece index', () => {
      const map = new TorrentPieceMap(10, 262144, 2621440);
      expect(() => map.getPieceLength(-1)).toThrow('Invalid piece index');
      expect(() => map.getPieceLength(10)).toThrow('Invalid piece index');
    });
  });

  // ===========================================================================
  // getPieceState Tests
  // ===========================================================================

  describe('getPieceState', () => {
    let map: TorrentPieceMap;

    beforeEach(() => {
      map = new TorrentPieceMap(10, 262144, 2621440);
    });

    it('should create new PieceState if not exists', () => {
      expect(map.pieces.size).toBe(0);

      const piece = map.getPieceState(0);

      expect(map.pieces.size).toBe(1);
      expect(piece).toBeInstanceOf(PieceState);
      expect(piece.pieceIndex).toBe(0);
    });

    it('should return existing PieceState if already created', () => {
      const piece1 = map.getPieceState(5);
      const piece2 = map.getPieceState(5);

      expect(piece1).toBe(piece2);
      expect(map.pieces.size).toBe(1);
    });

    it('should create PieceState with correct length for last piece', () => {
      const map = new TorrentPieceMap(10, 262144, 2500000);
      const piece = map.getPieceState(9);

      expect(piece.pieceLength).toBe(140704);
    });

    it('should throw error for invalid piece index', () => {
      expect(() => map.getPieceState(-1)).toThrow('Invalid piece index');
      expect(() => map.getPieceState(10)).toThrow('Invalid piece index');
    });

    it('should throw error for already completed piece', () => {
      map.markPieceComplete(5);
      expect(() => map.getPieceState(5)).toThrow('already complete');
    });
  });

  // ===========================================================================
  // markPieceComplete Tests
  // ===========================================================================

  describe('markPieceComplete', () => {
    let map: TorrentPieceMap;

    beforeEach(() => {
      map = new TorrentPieceMap(10, 262144, 2621440);
    });

    it('should add piece to completedPieces', () => {
      map.markPieceComplete(0);
      expect(map.completedPieces.has(0)).toBe(true);
    });

    it('should remove piece from pieces map', () => {
      map.getPieceState(5); // Create piece state
      expect(map.pieces.has(5)).toBe(true);

      map.markPieceComplete(5);

      expect(map.pieces.has(5)).toBe(false);
      expect(map.completedPieces.has(5)).toBe(true);
    });

    it('should work even if piece was never created', () => {
      map.markPieceComplete(3);
      expect(map.completedPieces.has(3)).toBe(true);
    });

    it('should throw error for invalid piece index', () => {
      expect(() => map.markPieceComplete(-1)).toThrow('Invalid piece index');
      expect(() => map.markPieceComplete(10)).toThrow('Invalid piece index');
    });
  });

  // ===========================================================================
  // markPieceFailed Tests
  // ===========================================================================

  describe('markPieceFailed', () => {
    let map: TorrentPieceMap;

    beforeEach(() => {
      map = new TorrentPieceMap(10, BLOCK_SIZE * 4, BLOCK_SIZE * 40);
    });

    it('should reset piece state', () => {
      const piece = map.getPieceState(5);
      piece.setBlockState(0, BlockState.Requested);
      piece.setBlockState(1, BlockState.Received);

      map.markPieceFailed(5);

      expect(piece.getBlockState(0)).toBe(BlockState.Missing);
      expect(piece.getBlockState(1)).toBe(BlockState.Missing);
    });

    it('should do nothing if piece not in progress', () => {
      expect(() => map.markPieceFailed(5)).not.toThrow();
    });

    it('should throw error for invalid piece index', () => {
      expect(() => map.markPieceFailed(-1)).toThrow('Invalid piece index');
      expect(() => map.markPieceFailed(10)).toThrow('Invalid piece index');
    });
  });

  // ===========================================================================
  // hasPiece Tests
  // ===========================================================================

  describe('hasPiece', () => {
    let map: TorrentPieceMap;

    beforeEach(() => {
      map = new TorrentPieceMap(10, 262144, 2621440);
    });

    it('should return false for uncompleted pieces', () => {
      expect(map.hasPiece(0)).toBe(false);
    });

    it('should return true for completed pieces', () => {
      map.markPieceComplete(5);
      expect(map.hasPiece(5)).toBe(true);
    });

    it('should return false for in-progress pieces', () => {
      map.getPieceState(3);
      expect(map.hasPiece(3)).toBe(false);
    });

    it('should return false for invalid indices without throwing', () => {
      expect(map.hasPiece(-1)).toBe(false);
      expect(map.hasPiece(100)).toBe(false);
    });
  });

  // ===========================================================================
  // getCompletedCount Tests
  // ===========================================================================

  describe('getCompletedCount', () => {
    let map: TorrentPieceMap;

    beforeEach(() => {
      map = new TorrentPieceMap(10, 262144, 2621440);
    });

    it('should return 0 initially', () => {
      expect(map.getCompletedCount()).toBe(0);
    });

    it('should count completed pieces', () => {
      map.markPieceComplete(0);
      expect(map.getCompletedCount()).toBe(1);

      map.markPieceComplete(5);
      expect(map.getCompletedCount()).toBe(2);

      map.markPieceComplete(9);
      expect(map.getCompletedCount()).toBe(3);
    });
  });

  // ===========================================================================
  // getProgress Tests
  // ===========================================================================

  describe('getProgress', () => {
    let map: TorrentPieceMap;

    beforeEach(() => {
      map = new TorrentPieceMap(10, 262144, 2621440);
    });

    it('should return 0 initially', () => {
      expect(map.getProgress()).toBe(0);
    });

    it('should return correct progress ratio', () => {
      map.markPieceComplete(0);
      expect(map.getProgress()).toBe(0.1);

      map.markPieceComplete(1);
      expect(map.getProgress()).toBe(0.2);
    });

    it('should return 1 when all pieces complete', () => {
      for (let i = 0; i < 10; i++) {
        map.markPieceComplete(i);
      }
      expect(map.getProgress()).toBe(1);
    });
  });

  // ===========================================================================
  // getBitfield Tests
  // ===========================================================================

  describe('getBitfield', () => {
    it('should return zero-filled bitfield when no pieces complete', () => {
      const map = new TorrentPieceMap(16, 262144, 4194304);
      const bitfield = map.getBitfield();

      expect(bitfield.length).toBe(2);
      expect(bitfield[0]).toBe(0);
      expect(bitfield[1]).toBe(0);
    });

    it('should set bits for completed pieces', () => {
      const map = new TorrentPieceMap(16, 262144, 4194304);
      map.markPieceComplete(0);
      map.markPieceComplete(7);

      const bitfield = map.getBitfield();

      // Piece 0 is bit 7 of byte 0 (0x80)
      // Piece 7 is bit 0 of byte 0 (0x01)
      expect(bitfield[0]).toBe(0x81);
      expect(bitfield[1]).toBe(0);
    });

    it('should handle pieces across multiple bytes', () => {
      const map = new TorrentPieceMap(16, 262144, 4194304);
      map.markPieceComplete(8); // First bit of second byte

      const bitfield = map.getBitfield();

      expect(bitfield[0]).toBe(0);
      expect(bitfield[1]).toBe(0x80);
    });

    it('should handle non-byte-aligned piece counts', () => {
      const map = new TorrentPieceMap(10, 262144, 2621440);
      map.markPieceComplete(0);
      map.markPieceComplete(9);

      const bitfield = map.getBitfield();

      expect(bitfield.length).toBe(2);
      expect(bitfield[0]).toBe(0x80); // Piece 0
      expect(bitfield[1]).toBe(0x40); // Piece 9 (bit 6 of byte 1)
    });
  });

  // ===========================================================================
  // getInProgressPieces Tests
  // ===========================================================================

  describe('getInProgressPieces', () => {
    let map: TorrentPieceMap;

    beforeEach(() => {
      map = new TorrentPieceMap(10, 262144, 2621440);
    });

    it('should return empty array initially', () => {
      expect(map.getInProgressPieces()).toEqual([]);
    });

    it('should return indices of pieces with state', () => {
      map.getPieceState(0);
      map.getPieceState(5);
      map.getPieceState(9);

      const inProgress = map.getInProgressPieces();
      expect(inProgress.sort()).toEqual([0, 5, 9]);
    });

    it('should not include completed pieces', () => {
      map.getPieceState(0);
      map.getPieceState(5);
      map.markPieceComplete(5);

      const inProgress = map.getInProgressPieces();
      expect(inProgress).toEqual([0]);
    });
  });
});

// =============================================================================
// Bitfield Utilities Tests
// =============================================================================

describe('Bitfield Utilities', () => {
  // ===========================================================================
  // allocateBitfield Tests
  // ===========================================================================

  describe('allocateBitfield', () => {
    it('should allocate correct size for aligned piece count', () => {
      const bitfield = allocateBitfield(8);
      expect(bitfield.length).toBe(1);
    });

    it('should allocate correct size for non-aligned piece count', () => {
      const bitfield = allocateBitfield(10);
      expect(bitfield.length).toBe(2);
    });

    it('should allocate zero-filled buffer', () => {
      const bitfield = allocateBitfield(16);
      expect(bitfield.every((b) => b === 0)).toBe(true);
    });

    it('should handle large piece counts', () => {
      const bitfield = allocateBitfield(1000);
      expect(bitfield.length).toBe(125);
    });

    it('should handle zero piece count', () => {
      const bitfield = allocateBitfield(0);
      expect(bitfield.length).toBe(0);
    });

    it('should throw error for negative piece count', () => {
      expect(() => allocateBitfield(-1)).toThrow('Invalid piece count');
    });
  });

  // ===========================================================================
  // hasBit Tests
  // ===========================================================================

  describe('hasBit', () => {
    it('should return false for unset bits', () => {
      const bitfield = Buffer.alloc(2);
      expect(hasBit(bitfield, 0)).toBe(false);
      expect(hasBit(bitfield, 7)).toBe(false);
      expect(hasBit(bitfield, 15)).toBe(false);
    });

    it('should return true for set bits', () => {
      const bitfield = Buffer.from([0x80, 0x01]); // Bits 0 and 15 set
      expect(hasBit(bitfield, 0)).toBe(true);
      expect(hasBit(bitfield, 15)).toBe(true);
    });

    it('should correctly handle high bit first ordering', () => {
      const bitfield = Buffer.from([0x80]); // Only bit 0 set
      expect(hasBit(bitfield, 0)).toBe(true);
      expect(hasBit(bitfield, 1)).toBe(false);
      expect(hasBit(bitfield, 7)).toBe(false);

      const bitfield2 = Buffer.from([0x01]); // Only bit 7 set
      expect(hasBit(bitfield2, 0)).toBe(false);
      expect(hasBit(bitfield2, 7)).toBe(true);
    });

    it('should return false for negative index', () => {
      const bitfield = Buffer.from([0xff]);
      expect(hasBit(bitfield, -1)).toBe(false);
    });

    it('should return false for index beyond buffer', () => {
      const bitfield = Buffer.from([0xff]);
      expect(hasBit(bitfield, 8)).toBe(false);
      expect(hasBit(bitfield, 100)).toBe(false);
    });

    it('should work with empty bitfield', () => {
      const bitfield = Buffer.alloc(0);
      expect(hasBit(bitfield, 0)).toBe(false);
    });
  });

  // ===========================================================================
  // setBit Tests
  // ===========================================================================

  describe('setBit', () => {
    it('should set bit at correct position', () => {
      const bitfield = Buffer.alloc(2);

      setBit(bitfield, 0);
      expect(bitfield[0]).toBe(0x80);

      setBit(bitfield, 7);
      expect(bitfield[0]).toBe(0x81);
    });

    it('should handle bits in second byte', () => {
      const bitfield = Buffer.alloc(2);

      setBit(bitfield, 8);
      expect(bitfield[1]).toBe(0x80);

      setBit(bitfield, 15);
      expect(bitfield[1]).toBe(0x81);
    });

    it('should not affect other bits', () => {
      const bitfield = Buffer.from([0x00, 0x00]);

      setBit(bitfield, 3);

      expect(hasBit(bitfield, 0)).toBe(false);
      expect(hasBit(bitfield, 1)).toBe(false);
      expect(hasBit(bitfield, 2)).toBe(false);
      expect(hasBit(bitfield, 3)).toBe(true);
      expect(hasBit(bitfield, 4)).toBe(false);
    });

    it('should be idempotent', () => {
      const bitfield = Buffer.alloc(1);

      setBit(bitfield, 0);
      const value1 = bitfield[0];

      setBit(bitfield, 0);
      expect(bitfield[0]).toBe(value1);
    });

    it('should throw error for negative index', () => {
      const bitfield = Buffer.alloc(1);
      expect(() => setBit(bitfield, -1)).toThrow('Invalid bit index');
    });

    it('should throw error for index beyond buffer', () => {
      const bitfield = Buffer.alloc(1);
      expect(() => setBit(bitfield, 8)).toThrow('out of range');
    });
  });

  // ===========================================================================
  // clearBit Tests
  // ===========================================================================

  describe('clearBit', () => {
    it('should clear set bit', () => {
      const bitfield = Buffer.from([0xff]);

      clearBit(bitfield, 0);
      expect(bitfield[0]).toBe(0x7f);

      clearBit(bitfield, 7);
      expect(bitfield[0]).toBe(0x7e);
    });

    it('should handle bits in second byte', () => {
      const bitfield = Buffer.from([0xff, 0xff]);

      clearBit(bitfield, 8);
      expect(bitfield[1]).toBe(0x7f);
    });

    it('should not affect other bits', () => {
      const bitfield = Buffer.from([0xff]);

      clearBit(bitfield, 3);

      expect(hasBit(bitfield, 0)).toBe(true);
      expect(hasBit(bitfield, 1)).toBe(true);
      expect(hasBit(bitfield, 2)).toBe(true);
      expect(hasBit(bitfield, 3)).toBe(false);
      expect(hasBit(bitfield, 4)).toBe(true);
    });

    it('should be idempotent', () => {
      const bitfield = Buffer.from([0x00]);

      clearBit(bitfield, 0);
      expect(bitfield[0]).toBe(0x00);
    });

    it('should throw error for negative index', () => {
      const bitfield = Buffer.alloc(1);
      expect(() => clearBit(bitfield, -1)).toThrow('Invalid bit index');
    });

    it('should throw error for index beyond buffer', () => {
      const bitfield = Buffer.alloc(1);
      expect(() => clearBit(bitfield, 8)).toThrow('out of range');
    });
  });

  // ===========================================================================
  // countBits Tests
  // ===========================================================================

  describe('countBits', () => {
    it('should return 0 for empty bitfield', () => {
      const bitfield = Buffer.alloc(0);
      expect(countBits(bitfield)).toBe(0);
    });

    it('should return 0 for zero-filled bitfield', () => {
      const bitfield = Buffer.alloc(10);
      expect(countBits(bitfield)).toBe(0);
    });

    it('should count single set bit', () => {
      const bitfield = Buffer.from([0x80]);
      expect(countBits(bitfield)).toBe(1);
    });

    it('should count multiple set bits in one byte', () => {
      const bitfield = Buffer.from([0x55]); // 01010101 = 4 bits
      expect(countBits(bitfield)).toBe(4);
    });

    it('should count all bits when all set', () => {
      const bitfield = Buffer.from([0xff]);
      expect(countBits(bitfield)).toBe(8);
    });

    it('should count across multiple bytes', () => {
      const bitfield = Buffer.from([0xff, 0x00, 0xff]);
      expect(countBits(bitfield)).toBe(16);
    });

    it('should handle various patterns', () => {
      // Pattern: 10101010 01010101 = 8 bits
      const bitfield = Buffer.from([0xaa, 0x55]);
      expect(countBits(bitfield)).toBe(8);
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('integration', () => {
    it('should work together for typical workflow', () => {
      const pieceCount = 100;
      const bitfield = allocateBitfield(pieceCount);

      // Initially no bits set
      expect(countBits(bitfield)).toBe(0);
      expect(hasBit(bitfield, 0)).toBe(false);

      // Set some pieces as complete
      setBit(bitfield, 0);
      setBit(bitfield, 50);
      setBit(bitfield, 99);

      expect(countBits(bitfield)).toBe(3);
      expect(hasBit(bitfield, 0)).toBe(true);
      expect(hasBit(bitfield, 50)).toBe(true);
      expect(hasBit(bitfield, 99)).toBe(true);
      expect(hasBit(bitfield, 1)).toBe(false);

      // Clear a bit
      clearBit(bitfield, 50);
      expect(countBits(bitfield)).toBe(2);
      expect(hasBit(bitfield, 50)).toBe(false);
    });

    it('should match TorrentPieceMap.getBitfield output', () => {
      const map = new TorrentPieceMap(100, 262144, 26214400);

      map.markPieceComplete(0);
      map.markPieceComplete(42);
      map.markPieceComplete(99);

      const bitfield = map.getBitfield();

      expect(hasBit(bitfield, 0)).toBe(true);
      expect(hasBit(bitfield, 42)).toBe(true);
      expect(hasBit(bitfield, 99)).toBe(true);
      expect(hasBit(bitfield, 1)).toBe(false);
      expect(countBits(bitfield)).toBe(3);
    });
  });
});

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('Edge Cases', () => {
  describe('Single block piece', () => {
    it('should handle piece smaller than one block', () => {
      const piece = new PieceState(0, 1000);

      expect(piece.blockCount).toBe(1);
      expect(piece.getBlockLength(0)).toBe(1000);

      const data = Buffer.alloc(1000, 0xaa);
      piece.writeBlock(0, data);

      expect(piece.isComplete()).toBe(true);
      expect(piece.getData()).toEqual(data);
    });
  });

  describe('Single piece torrent', () => {
    it('should handle torrent with one piece', () => {
      const map = new TorrentPieceMap(1, 262144, 100000);

      expect(map.pieceCount).toBe(1);
      expect(map.getPieceLength(0)).toBe(100000);

      map.markPieceComplete(0);
      expect(map.getProgress()).toBe(1);
      expect(map.getBitfield()).toEqual(Buffer.from([0x80]));
    });
  });

  describe('Last piece smaller than block', () => {
    it('should handle last piece smaller than one block', () => {
      // 10 pieces, standard 16384, total makes last piece 100 bytes
      const totalLength = BLOCK_SIZE * 9 + 100;
      const map = new TorrentPieceMap(10, BLOCK_SIZE, totalLength);

      expect(map.getPieceLength(9)).toBe(100);

      const piece = map.getPieceState(9);
      expect(piece.blockCount).toBe(1);
      expect(piece.getBlockLength(0)).toBe(100);
    });
  });

  describe('Large torrent', () => {
    it('should handle large piece counts efficiently', () => {
      // 10000 pieces
      const map = new TorrentPieceMap(10000, 262144, 2621440000);

      // Just access a few pieces
      map.getPieceState(0);
      map.getPieceState(5000);
      map.getPieceState(9999);

      expect(map.pieces.size).toBe(3);

      map.markPieceComplete(5000);
      expect(map.pieces.size).toBe(2);
      expect(map.completedPieces.size).toBe(1);
    });
  });

  describe('Bitfield edge cases', () => {
    it('should handle 1 piece torrent bitfield', () => {
      const bitfield = allocateBitfield(1);
      expect(bitfield.length).toBe(1);

      setBit(bitfield, 0);
      expect(bitfield[0]).toBe(0x80);
    });

    it('should handle exact byte boundary', () => {
      const bitfield = allocateBitfield(8);
      expect(bitfield.length).toBe(1);

      for (let i = 0; i < 8; i++) {
        setBit(bitfield, i);
      }
      expect(bitfield[0]).toBe(0xff);
    });

    it('should handle piece count one less than byte boundary', () => {
      const bitfield = allocateBitfield(7);
      expect(bitfield.length).toBe(1);

      for (let i = 0; i < 7; i++) {
        setBit(bitfield, i);
      }
      // Bits 0-6 set = 0b11111110 = 0xfe
      expect(bitfield[0]).toBe(0xfe);
    });
  });
});
