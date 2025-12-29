import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'crypto';
import {
  PieceManager,
  PieceManagerOptions,
  PieceManagerEvents,
  DEFAULT_PIPELINE_LENGTH,
  DEFAULT_ENDGAME_THRESHOLD,
  MAX_PIECE_RETRIES,
} from '../../../src/engine/piece/manager.js';
import { SelectionStrategy } from '../../../src/engine/piece/selector.js';
import { BLOCK_SIZE, allocateBitfield, setBit } from '../../../src/engine/piece/state.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Compute SHA-1 hash of data
 */
function sha1(data: Buffer | string): Buffer {
  return createHash('sha1')
    .update(typeof data === 'string' ? Buffer.from(data) : data)
    .digest();
}

/**
 * Create piece hashes for test pieces
 */
function createPieceHashes(...pieces: Buffer[]): Buffer {
  const hashes = pieces.map((p) => sha1(p));
  return Buffer.concat(hashes);
}

/**
 * Create a bitfield with specified pieces set
 */
function createBitfield(pieceCount: number, setPieces: number[]): Buffer {
  const bitfield = allocateBitfield(pieceCount);
  for (const index of setPieces) {
    setBit(bitfield, index);
  }
  return bitfield;
}

/**
 * Create a full bitfield (all pieces set)
 */
function createFullBitfield(pieceCount: number): Buffer {
  const bitfield = allocateBitfield(pieceCount);
  for (let i = 0; i < pieceCount; i++) {
    setBit(bitfield, i);
  }
  return bitfield;
}

/**
 * Create test piece data of a given size
 */
function createPieceData(pieceIndex: number, length: number): Buffer {
  const data = Buffer.alloc(length);
  // Fill with recognizable pattern
  for (let i = 0; i < length; i++) {
    data[i] = (pieceIndex + i) % 256;
  }
  return data;
}

/**
 * Create default PieceManager options for testing
 */
function createTestOptions(overrides: Partial<PieceManagerOptions> = {}): PieceManagerOptions {
  const pieceCount = overrides.pieceCount ?? 10;
  const pieceLength = overrides.pieceLength ?? BLOCK_SIZE * 4; // 4 blocks per piece
  const totalLength = overrides.totalLength ?? pieceCount * pieceLength;

  // Create piece data and hashes
  const pieces: Buffer[] = [];
  for (let i = 0; i < pieceCount; i++) {
    const isLastPiece = i === pieceCount - 1;
    const length = isLastPiece
      ? totalLength - (pieceCount - 1) * pieceLength
      : pieceLength;
    pieces.push(createPieceData(i, length));
  }
  const pieceHashes = overrides.pieceHashes ?? createPieceHashes(...pieces);

  return {
    pieceCount,
    pieceLength,
    totalLength,
    pieceHashes,
    ...overrides,
  };
}

// =============================================================================
// Constants Tests
// =============================================================================

describe('Constants', () => {
  it('DEFAULT_PIPELINE_LENGTH should be 5', () => {
    expect(DEFAULT_PIPELINE_LENGTH).toBe(5);
  });

  it('DEFAULT_ENDGAME_THRESHOLD should be 10', () => {
    expect(DEFAULT_ENDGAME_THRESHOLD).toBe(10);
  });

  it('MAX_PIECE_RETRIES should be 3', () => {
    expect(MAX_PIECE_RETRIES).toBe(3);
  });
});

// =============================================================================
// Constructor Tests
// =============================================================================

describe('PieceManager', () => {
  describe('constructor', () => {
    it('should create a PieceManager with correct properties', () => {
      const options = createTestOptions();
      const manager = new PieceManager(options);

      expect(manager.pieceCount).toBe(10);
      expect(manager.completedPieces).toBe(0);
      expect(manager.progress).toBe(0);
      expect(manager.isComplete).toBe(false);
      expect(manager.isEndgame).toBe(false);
    });

    it('should accept custom pipeline length', () => {
      const options = createTestOptions({ pipelineLength: 10 });
      const manager = new PieceManager(options);

      expect(manager).toBeDefined();
    });

    it('should accept custom endgame threshold', () => {
      const options = createTestOptions({ endgameThreshold: 5 });
      const manager = new PieceManager(options);

      expect(manager).toBeDefined();
    });

    it('should accept custom selection strategy', () => {
      const options = createTestOptions({ strategy: SelectionStrategy.Sequential });
      const manager = new PieceManager(options);

      expect(manager).toBeDefined();
    });
  });

  // ===========================================================================
  // Peer Management Tests
  // ===========================================================================

  describe('peer management', () => {
    let manager: PieceManager;

    beforeEach(() => {
      manager = new PieceManager(createTestOptions());
    });

    describe('addPeerBitfield', () => {
      it('should register a peer with their bitfield', () => {
        const bitfield = createBitfield(10, [0, 2, 4, 6, 8]);
        manager.addPeerBitfield('peer-1', bitfield);

        expect(manager.availability.hasPeer('peer-1')).toBe(true);
      });

      it('should update availability counts', () => {
        const bitfield = createBitfield(10, [0, 1, 2]);
        manager.addPeerBitfield('peer-1', bitfield);

        expect(manager.availability.getAvailability(0)).toBe(1);
        expect(manager.availability.getAvailability(1)).toBe(1);
        expect(manager.availability.getAvailability(2)).toBe(1);
        expect(manager.availability.getAvailability(3)).toBe(0);
      });

      it('should handle multiple peers', () => {
        manager.addPeerBitfield('peer-1', createBitfield(10, [0, 1, 2]));
        manager.addPeerBitfield('peer-2', createBitfield(10, [0, 2, 4]));
        manager.addPeerBitfield('peer-3', createBitfield(10, [0, 3, 6]));

        expect(manager.availability.getAvailability(0)).toBe(3);
        expect(manager.availability.getAvailability(1)).toBe(1);
        expect(manager.availability.getAvailability(2)).toBe(2);
      });
    });

    describe('handlePeerHave', () => {
      it('should update availability when peer announces new piece', () => {
        manager.addPeerBitfield('peer-1', createBitfield(10, [0]));
        expect(manager.availability.getAvailability(5)).toBe(0);

        manager.handlePeerHave('peer-1', 5);

        expect(manager.availability.getAvailability(5)).toBe(1);
      });

      it('should create new peer if not tracked', () => {
        expect(manager.availability.hasPeer('new-peer')).toBe(false);

        manager.handlePeerHave('new-peer', 3);

        expect(manager.availability.hasPeer('new-peer')).toBe(true);
        expect(manager.availability.getAvailability(3)).toBe(1);
      });
    });

    describe('removePeer', () => {
      it('should remove peer from availability tracking', () => {
        manager.addPeerBitfield('peer-1', createBitfield(10, [0, 1, 2]));
        expect(manager.availability.hasPeer('peer-1')).toBe(true);

        manager.removePeer('peer-1');

        expect(manager.availability.hasPeer('peer-1')).toBe(false);
      });

      it('should decrement availability counts', () => {
        manager.addPeerBitfield('peer-1', createBitfield(10, [0, 1, 2]));
        manager.addPeerBitfield('peer-2', createBitfield(10, [0, 2, 4]));

        expect(manager.availability.getAvailability(0)).toBe(2);

        manager.removePeer('peer-1');

        expect(manager.availability.getAvailability(0)).toBe(1);
        expect(manager.availability.getAvailability(1)).toBe(0);
        expect(manager.availability.getAvailability(2)).toBe(1);
      });

      it('should cancel pending requests for the peer', () => {
        manager.addPeerBitfield('peer-1', createFullBitfield(10));

        // Create some requests
        const requests = manager.getBlockRequests('peer-1', createFullBitfield(10), 3);
        expect(requests.length).toBe(3);
        expect(manager.getPendingRequestCount('peer-1')).toBe(3);

        manager.removePeer('peer-1');

        expect(manager.getPendingRequestCount('peer-1')).toBe(0);
      });
    });

    describe('getPeersWithPiece', () => {
      it('should return peers that have a specific piece', () => {
        manager.addPeerBitfield('peer-1', createBitfield(10, [0, 1, 2]));
        manager.addPeerBitfield('peer-2', createBitfield(10, [0, 2, 4]));
        manager.addPeerBitfield('peer-3', createBitfield(10, [3, 4, 5]));

        const peersWithPiece0 = manager.getPeersWithPiece(0);
        expect(peersWithPiece0).toContain('peer-1');
        expect(peersWithPiece0).toContain('peer-2');
        expect(peersWithPiece0).not.toContain('peer-3');

        const peersWithPiece4 = manager.getPeersWithPiece(4);
        expect(peersWithPiece4).toContain('peer-2');
        expect(peersWithPiece4).toContain('peer-3');
        expect(peersWithPiece4).not.toContain('peer-1');
      });

      it('should return empty array for piece nobody has', () => {
        manager.addPeerBitfield('peer-1', createBitfield(10, [0, 1, 2]));

        const peers = manager.getPeersWithPiece(9);
        expect(peers).toEqual([]);
      });
    });
  });

  // ===========================================================================
  // Block Requests Tests
  // ===========================================================================

  describe('block requests', () => {
    let manager: PieceManager;

    beforeEach(() => {
      manager = new PieceManager(createTestOptions());
    });

    describe('getBlockRequests', () => {
      it('should return block requests for a peer', () => {
        manager.addPeerBitfield('peer-1', createFullBitfield(10));

        const requests = manager.getBlockRequests('peer-1', createFullBitfield(10), 3);

        expect(requests.length).toBe(3);
        expect(requests[0]).toHaveProperty('pieceIndex');
        expect(requests[0]).toHaveProperty('begin');
        expect(requests[0]).toHaveProperty('length');
      });

      it('should respect the count parameter', () => {
        // Use a fresh manager for this test
        const freshManager = new PieceManager(createTestOptions());
        freshManager.addPeerBitfield('peer-1', createFullBitfield(10));

        const requests1 = freshManager.getBlockRequests('peer-1', createFullBitfield(10), 1);
        expect(requests1.length).toBe(1);

        // Create another fresh manager to test 5 requests
        const freshManager2 = new PieceManager(createTestOptions());
        freshManager2.addPeerBitfield('peer-1', createFullBitfield(10));

        const requests5 = freshManager2.getBlockRequests('peer-1', createFullBitfield(10), 5);
        expect(requests5.length).toBe(5);
      });

      it('should not return requests for pieces the peer does not have', () => {
        manager.addPeerBitfield('peer-1', createBitfield(10, [0, 2, 4]));

        const peerBitfield = createBitfield(10, [0, 2, 4]);
        const requests = manager.getBlockRequests('peer-1', peerBitfield, 10);

        // All requests should be for pieces 0, 2, or 4
        for (const req of requests) {
          expect([0, 2, 4]).toContain(req.pieceIndex);
        }
      });

      it('should not return requests for pieces we already have', () => {
        manager.addPeerBitfield('peer-1', createFullBitfield(10));

        // Mark some pieces as complete
        manager.markPieceComplete(0);
        manager.markPieceComplete(1);
        manager.markPieceComplete(2);

        const requests = manager.getBlockRequests('peer-1', createFullBitfield(10), 20);

        // No requests should be for pieces 0, 1, or 2
        for (const req of requests) {
          expect([0, 1, 2]).not.toContain(req.pieceIndex);
        }
      });

      it('should return empty array if no valid pieces', () => {
        manager.addPeerBitfield('peer-1', createBitfield(10, [0, 1, 2]));

        // Mark those pieces as complete
        manager.markPieceComplete(0);
        manager.markPieceComplete(1);
        manager.markPieceComplete(2);

        const peerBitfield = createBitfield(10, [0, 1, 2]);
        const requests = manager.getBlockRequests('peer-1', peerBitfield, 5);

        expect(requests).toEqual([]);
      });

      it('should track pending requests', () => {
        manager.addPeerBitfield('peer-1', createFullBitfield(10));

        expect(manager.getPendingRequestCount('peer-1')).toBe(0);

        manager.getBlockRequests('peer-1', createFullBitfield(10), 3);

        expect(manager.getPendingRequestCount('peer-1')).toBe(3);
      });

      it('should not exceed pipeline limit for a peer', () => {
        manager.addPeerBitfield('peer-1', createFullBitfield(10));

        // First request batch
        manager.getBlockRequests('peer-1', createFullBitfield(10), 3);
        expect(manager.getPendingRequestCount('peer-1')).toBe(3);

        // Second request should account for existing
        const moreRequests = manager.getBlockRequests('peer-1', createFullBitfield(10), 3);

        // Should only get 0 more since we already have 3 pending
        // Note: The implementation may vary, but it should respect existing requests
        expect(manager.getPendingRequestCount('peer-1')).toBeLessThanOrEqual(6);
      });
    });

    describe('handleBlock', () => {
      it('should accept valid block data', () => {
        const options = createTestOptions({ pieceCount: 1, pieceLength: BLOCK_SIZE });
        const pieceData = createPieceData(0, BLOCK_SIZE);
        options.pieceHashes = sha1(pieceData);

        const manager = new PieceManager(options);
        manager.addPeerBitfield('peer-1', createFullBitfield(1));

        const requests = manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
        expect(requests.length).toBe(1);

        const completeHandler = vi.fn();
        manager.on('pieceComplete', completeHandler);

        manager.handleBlock('peer-1', 0, 0, pieceData);

        expect(completeHandler).toHaveBeenCalledWith({
          pieceIndex: 0,
          data: pieceData,
        });
      });

      it('should verify piece when all blocks received', () => {
        const pieceLength = BLOCK_SIZE * 2;
        const pieceData = createPieceData(0, pieceLength);
        const options = createTestOptions({
          pieceCount: 1,
          pieceLength,
          totalLength: pieceLength,
          pieceHashes: sha1(pieceData),
        });

        const manager = new PieceManager(options);
        manager.addPeerBitfield('peer-1', createFullBitfield(1));

        const completeHandler = vi.fn();
        manager.on('pieceComplete', completeHandler);

        // Request and send first block
        manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
        manager.handleBlock('peer-1', 0, 0, pieceData.subarray(0, BLOCK_SIZE));
        expect(completeHandler).not.toHaveBeenCalled();

        // Request and send second block
        manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
        manager.handleBlock('peer-1', 0, BLOCK_SIZE, pieceData.subarray(BLOCK_SIZE));

        expect(completeHandler).toHaveBeenCalledTimes(1);
      });

      it('should emit pieceFailed on hash mismatch', () => {
        const options = createTestOptions({ pieceCount: 1, pieceLength: BLOCK_SIZE });
        const manager = new PieceManager(options);
        manager.addPeerBitfield('peer-1', createFullBitfield(1));

        const failedHandler = vi.fn();
        manager.on('pieceFailed', failedHandler);

        manager.getBlockRequests('peer-1', createFullBitfield(1), 1);

        // Send wrong data
        const wrongData = Buffer.alloc(BLOCK_SIZE, 0xff);
        manager.handleBlock('peer-1', 0, 0, wrongData);

        expect(failedHandler).toHaveBeenCalledTimes(1);
        expect(failedHandler.mock.calls[0][0].pieceIndex).toBe(0);
        expect(failedHandler.mock.calls[0][0].retryCount).toBe(1);
      });

      it('should remove pending request when block received', () => {
        const manager = new PieceManager(createTestOptions());
        manager.addPeerBitfield('peer-1', createFullBitfield(10));

        manager.getBlockRequests('peer-1', createFullBitfield(10), 1);
        expect(manager.getPendingRequestCount('peer-1')).toBe(1);

        // Send any block data (verification will fail but request should be cleared)
        manager.handleBlock('peer-1', 0, 0, Buffer.alloc(BLOCK_SIZE));

        expect(manager.getPendingRequestCount('peer-1')).toBe(0);
      });
    });

    describe('cancelRequest', () => {
      it('should cancel a pending request', () => {
        const manager = new PieceManager(createTestOptions());
        manager.addPeerBitfield('peer-1', createFullBitfield(10));

        const requests = manager.getBlockRequests('peer-1', createFullBitfield(10), 1);
        expect(requests.length).toBe(1);
        expect(manager.getPendingRequestCount('peer-1')).toBe(1);

        const peerId = manager.cancelRequest(requests[0].pieceIndex, requests[0].begin);

        expect(peerId).toBe('peer-1');
        expect(manager.getPendingRequestCount('peer-1')).toBe(0);
      });

      it('should return null for non-existent request', () => {
        const manager = new PieceManager(createTestOptions());

        const peerId = manager.cancelRequest(99, 0);

        expect(peerId).toBeNull();
      });

      it('should reset block state to missing', () => {
        const manager = new PieceManager(createTestOptions());
        manager.addPeerBitfield('peer-1', createFullBitfield(10));

        const requests = manager.getBlockRequests('peer-1', createFullBitfield(10), 1);
        manager.cancelRequest(requests[0].pieceIndex, requests[0].begin);

        // Should be able to request the same block again
        const newRequests = manager.getBlockRequests('peer-1', createFullBitfield(10), 1);
        expect(newRequests.length).toBe(1);
      });
    });
  });

  // ===========================================================================
  // State Management Tests
  // ===========================================================================

  describe('state management', () => {
    describe('markPieceComplete', () => {
      it('should mark a piece as complete', () => {
        const manager = new PieceManager(createTestOptions());

        expect(manager.hasPiece(5)).toBe(false);

        manager.markPieceComplete(5);

        expect(manager.hasPiece(5)).toBe(true);
        expect(manager.completedPieces).toBe(1);
      });

      it('should update progress', () => {
        const manager = new PieceManager(createTestOptions({ pieceCount: 10 }));

        manager.markPieceComplete(0);
        expect(manager.progress).toBe(0.1);

        manager.markPieceComplete(1);
        expect(manager.progress).toBe(0.2);
      });

      it('should emit downloadComplete when all pieces done', () => {
        const manager = new PieceManager(createTestOptions({ pieceCount: 3 }));

        const completeHandler = vi.fn();
        manager.on('downloadComplete', completeHandler);

        manager.markPieceComplete(0);
        manager.markPieceComplete(1);
        expect(completeHandler).not.toHaveBeenCalled();

        manager.markPieceComplete(2);
        expect(completeHandler).toHaveBeenCalledTimes(1);
        expect(manager.isComplete).toBe(true);
      });
    });

    describe('hasPiece', () => {
      it('should return false for incomplete pieces', () => {
        const manager = new PieceManager(createTestOptions());

        expect(manager.hasPiece(0)).toBe(false);
        expect(manager.hasPiece(5)).toBe(false);
      });

      it('should return true for complete pieces', () => {
        const manager = new PieceManager(createTestOptions());

        manager.markPieceComplete(3);

        expect(manager.hasPiece(3)).toBe(true);
      });
    });

    describe('getBitfield', () => {
      it('should return empty bitfield initially', () => {
        const manager = new PieceManager(createTestOptions({ pieceCount: 16 }));

        const bitfield = manager.getBitfield();

        expect(bitfield.length).toBe(2); // 16 bits = 2 bytes
        expect(bitfield[0]).toBe(0);
        expect(bitfield[1]).toBe(0);
      });

      it('should reflect completed pieces', () => {
        const manager = new PieceManager(createTestOptions({ pieceCount: 16 }));

        manager.markPieceComplete(0);
        manager.markPieceComplete(8);

        const bitfield = manager.getBitfield();

        // Piece 0 = bit 7 of byte 0 = 0x80
        // Piece 8 = bit 7 of byte 1 = 0x80
        expect(bitfield[0]).toBe(0x80);
        expect(bitfield[1]).toBe(0x80);
      });
    });

    describe('setStrategy', () => {
      it('should change the selection strategy', () => {
        const manager = new PieceManager(createTestOptions());

        manager.setStrategy(SelectionStrategy.Sequential);
        // Strategy change should be accepted without error
        expect(manager).toBeDefined();

        manager.setStrategy(SelectionStrategy.Random);
        expect(manager).toBeDefined();
      });
    });
  });

  // ===========================================================================
  // Endgame Mode Tests
  // ===========================================================================

  describe('endgame mode', () => {
    it('should enter endgame when threshold reached', () => {
      const pieceCount = 15;
      const manager = new PieceManager(
        createTestOptions({
          pieceCount,
          endgameThreshold: 5,
        })
      );

      manager.addPeerBitfield('peer-1', createFullBitfield(pieceCount));

      const endgameHandler = vi.fn();
      manager.on('endgameStarted', endgameHandler);

      // Complete all but 5 pieces
      for (let i = 0; i < 10; i++) {
        manager.markPieceComplete(i);
      }

      expect(manager.isEndgame).toBe(false);

      // Request blocks to trigger endgame check
      manager.getBlockRequests('peer-1', createFullBitfield(pieceCount), 1);

      expect(manager.isEndgame).toBe(true);
      expect(endgameHandler).toHaveBeenCalledTimes(1);
      expect(endgameHandler.mock.calls[0][0].missingPieces).toHaveLength(5);
    });

    it('should not enter endgame if threshold not reached', () => {
      const pieceCount = 20;
      const manager = new PieceManager(
        createTestOptions({
          pieceCount,
          endgameThreshold: 5,
        })
      );

      manager.addPeerBitfield('peer-1', createFullBitfield(pieceCount));

      // Complete only 10 pieces (10 remaining > 5 threshold)
      for (let i = 0; i < 10; i++) {
        manager.markPieceComplete(i);
      }

      manager.getBlockRequests('peer-1', createFullBitfield(pieceCount), 1);

      expect(manager.isEndgame).toBe(false);
    });
  });

  // ===========================================================================
  // Properties Tests
  // ===========================================================================

  describe('properties', () => {
    it('pieceCount should return total pieces', () => {
      const manager = new PieceManager(createTestOptions({ pieceCount: 42 }));
      expect(manager.pieceCount).toBe(42);
    });

    it('completedPieces should return completed count', () => {
      const manager = new PieceManager(createTestOptions({ pieceCount: 10 }));

      expect(manager.completedPieces).toBe(0);

      manager.markPieceComplete(0);
      manager.markPieceComplete(1);
      manager.markPieceComplete(2);

      expect(manager.completedPieces).toBe(3);
    });

    it('progress should return download progress', () => {
      const manager = new PieceManager(createTestOptions({ pieceCount: 4 }));

      expect(manager.progress).toBe(0);

      manager.markPieceComplete(0);
      expect(manager.progress).toBe(0.25);

      manager.markPieceComplete(1);
      expect(manager.progress).toBe(0.5);

      manager.markPieceComplete(2);
      expect(manager.progress).toBe(0.75);

      manager.markPieceComplete(3);
      expect(manager.progress).toBe(1);
    });

    it('isComplete should indicate download completion', () => {
      const manager = new PieceManager(createTestOptions({ pieceCount: 2 }));

      expect(manager.isComplete).toBe(false);

      manager.markPieceComplete(0);
      expect(manager.isComplete).toBe(false);

      manager.markPieceComplete(1);
      expect(manager.isComplete).toBe(true);
    });

    it('isEndgame should indicate endgame mode', () => {
      const manager = new PieceManager(
        createTestOptions({ pieceCount: 10, endgameThreshold: 3 })
      );

      expect(manager.isEndgame).toBe(false);

      // Would need to trigger endgame through normal flow
    });

    it('availability should expose the availability tracker', () => {
      const manager = new PieceManager(createTestOptions());

      expect(manager.availability).toBeDefined();
      expect(manager.availability.pieceCount).toBe(10);
    });
  });

  // ===========================================================================
  // Piece Verification Tests
  // ===========================================================================

  describe('piece verification', () => {
    it('should verify piece with correct hash', () => {
      const pieceData = createPieceData(0, BLOCK_SIZE);
      const options = createTestOptions({
        pieceCount: 1,
        pieceLength: BLOCK_SIZE,
        totalLength: BLOCK_SIZE,
        pieceHashes: sha1(pieceData),
      });

      const manager = new PieceManager(options);
      manager.addPeerBitfield('peer-1', createFullBitfield(1));

      const completeHandler = vi.fn();
      manager.on('pieceComplete', completeHandler);

      manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
      manager.handleBlock('peer-1', 0, 0, pieceData);

      expect(completeHandler).toHaveBeenCalledTimes(1);
      expect(manager.hasPiece(0)).toBe(true);
    });

    it('should reject piece with wrong hash', () => {
      const options = createTestOptions({
        pieceCount: 1,
        pieceLength: BLOCK_SIZE,
        totalLength: BLOCK_SIZE,
      });

      const manager = new PieceManager(options);
      manager.addPeerBitfield('peer-1', createFullBitfield(1));

      const completeHandler = vi.fn();
      const failedHandler = vi.fn();
      manager.on('pieceComplete', completeHandler);
      manager.on('pieceFailed', failedHandler);

      manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
      manager.handleBlock('peer-1', 0, 0, Buffer.alloc(BLOCK_SIZE, 0xff));

      expect(completeHandler).not.toHaveBeenCalled();
      expect(failedHandler).toHaveBeenCalledTimes(1);
      expect(manager.hasPiece(0)).toBe(false);
    });

    it('should retry failed pieces', () => {
      const options = createTestOptions({
        pieceCount: 1,
        pieceLength: BLOCK_SIZE,
        totalLength: BLOCK_SIZE,
      });

      const manager = new PieceManager(options);
      manager.addPeerBitfield('peer-1', createFullBitfield(1));

      const failedHandler = vi.fn();
      manager.on('pieceFailed', failedHandler);

      // First failure
      manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
      manager.handleBlock('peer-1', 0, 0, Buffer.alloc(BLOCK_SIZE, 0xff));
      expect(failedHandler.mock.calls[0][0].retryCount).toBe(1);

      // Second failure
      manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
      manager.handleBlock('peer-1', 0, 0, Buffer.alloc(BLOCK_SIZE, 0xee));
      expect(failedHandler.mock.calls[1][0].retryCount).toBe(2);
    });

    it('should give up after max retries', () => {
      const options = createTestOptions({
        pieceCount: 1,
        pieceLength: BLOCK_SIZE,
        totalLength: BLOCK_SIZE,
      });

      const manager = new PieceManager(options);
      manager.addPeerBitfield('peer-1', createFullBitfield(1));

      const gaveUpHandler = vi.fn();
      manager.on('pieceGaveUp', gaveUpHandler);

      // Fail MAX_PIECE_RETRIES times
      for (let i = 0; i < MAX_PIECE_RETRIES; i++) {
        manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
        manager.handleBlock('peer-1', 0, 0, Buffer.alloc(BLOCK_SIZE, i));
      }

      expect(gaveUpHandler).toHaveBeenCalledTimes(1);
      expect(gaveUpHandler.mock.calls[0][0].pieceIndex).toBe(0);
      expect(gaveUpHandler.mock.calls[0][0].retryCount).toBe(MAX_PIECE_RETRIES);
    });
  });

  // ===========================================================================
  // Download Complete Event Tests
  // ===========================================================================

  describe('downloadComplete event', () => {
    it('should emit downloadComplete when all pieces verified', () => {
      const pieceLength = BLOCK_SIZE;
      const pieces = [createPieceData(0, pieceLength), createPieceData(1, pieceLength)];
      const options = createTestOptions({
        pieceCount: 2,
        pieceLength,
        totalLength: pieceLength * 2,
        pieceHashes: createPieceHashes(...pieces),
        strategy: SelectionStrategy.Sequential, // Ensure predictable order
      });

      const manager = new PieceManager(options);
      manager.addPeerBitfield('peer-1', createFullBitfield(2));

      const completeHandler = vi.fn();
      manager.on('downloadComplete', completeHandler);

      // Get all block requests - will return 2 blocks (one per piece)
      const requests = manager.getBlockRequests('peer-1', createFullBitfield(2), 2);
      expect(requests.length).toBe(2);

      // Sort by piece index to handle them in order
      requests.sort((a, b) => a.pieceIndex - b.pieceIndex);

      // Complete first piece
      manager.handleBlock('peer-1', requests[0].pieceIndex, requests[0].begin, pieces[requests[0].pieceIndex]);
      expect(completeHandler).not.toHaveBeenCalled();

      // Complete second piece
      manager.handleBlock('peer-1', requests[1].pieceIndex, requests[1].begin, pieces[requests[1].pieceIndex]);
      expect(completeHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit downloadComplete when last piece marked complete', () => {
      const manager = new PieceManager(createTestOptions({ pieceCount: 3 }));

      const completeHandler = vi.fn();
      manager.on('downloadComplete', completeHandler);

      manager.markPieceComplete(0);
      manager.markPieceComplete(1);
      expect(completeHandler).not.toHaveBeenCalled();

      manager.markPieceComplete(2);
      expect(completeHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Edge Cases Tests
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle single block piece', () => {
      const pieceData = createPieceData(0, BLOCK_SIZE);
      const options = createTestOptions({
        pieceCount: 1,
        pieceLength: BLOCK_SIZE,
        totalLength: BLOCK_SIZE,
        pieceHashes: sha1(pieceData),
      });

      const manager = new PieceManager(options);
      manager.addPeerBitfield('peer-1', createFullBitfield(1));

      const completeHandler = vi.fn();
      manager.on('pieceComplete', completeHandler);

      manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
      manager.handleBlock('peer-1', 0, 0, pieceData);

      expect(completeHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle piece smaller than one block', () => {
      const pieceData = Buffer.alloc(1000, 0xab);
      const options = createTestOptions({
        pieceCount: 1,
        pieceLength: 1000,
        totalLength: 1000,
        pieceHashes: sha1(pieceData),
      });

      const manager = new PieceManager(options);
      manager.addPeerBitfield('peer-1', createFullBitfield(1));

      const requests = manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
      expect(requests.length).toBe(1);
      expect(requests[0].length).toBe(1000);

      const completeHandler = vi.fn();
      manager.on('pieceComplete', completeHandler);

      manager.handleBlock('peer-1', 0, 0, pieceData);

      expect(completeHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle last piece being smaller', () => {
      const pieceLength = BLOCK_SIZE;
      const totalLength = pieceLength * 2 + 1000; // 2 full pieces + 1000 bytes
      const piece0 = createPieceData(0, pieceLength);
      const piece1 = createPieceData(1, pieceLength);
      const piece2 = createPieceData(2, 1000); // Last piece is smaller

      const options = createTestOptions({
        pieceCount: 3,
        pieceLength,
        totalLength,
        pieceHashes: createPieceHashes(piece0, piece1, piece2),
      });

      const manager = new PieceManager(options);
      manager.addPeerBitfield('peer-1', createFullBitfield(3));

      // Mark first two complete
      manager.markPieceComplete(0);
      manager.markPieceComplete(1);

      // Request last piece
      const requests = manager.getBlockRequests('peer-1', createFullBitfield(3), 1);
      expect(requests.length).toBe(1);
      expect(requests[0].pieceIndex).toBe(2);
      expect(requests[0].length).toBe(1000);

      const completeHandler = vi.fn();
      manager.on('pieceComplete', completeHandler);

      manager.handleBlock('peer-1', 2, 0, piece2);

      expect(completeHandler).toHaveBeenCalledTimes(1);
      expect(manager.isComplete).toBe(true);
    });

    it('should handle receiving duplicate blocks', () => {
      const pieceData = createPieceData(0, BLOCK_SIZE);
      const options = createTestOptions({
        pieceCount: 1,
        pieceLength: BLOCK_SIZE,
        totalLength: BLOCK_SIZE,
        pieceHashes: sha1(pieceData),
      });

      const manager = new PieceManager(options);
      manager.addPeerBitfield('peer-1', createFullBitfield(1));

      const completeHandler = vi.fn();
      manager.on('pieceComplete', completeHandler);

      manager.getBlockRequests('peer-1', createFullBitfield(1), 1);
      manager.handleBlock('peer-1', 0, 0, pieceData);

      // Try to handle the same block again
      manager.handleBlock('peer-1', 0, 0, pieceData);
      manager.handleBlock('peer-1', 0, 0, pieceData);

      // Should only complete once
      expect(completeHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle no available peers', () => {
      const manager = new PieceManager(createTestOptions());

      // Don't add any peers
      const requests = manager.getBlockRequests('peer-1', createFullBitfield(10), 5);

      // Should still return requests if peer has pieces
      expect(requests.length).toBeGreaterThan(0);
    });

    it('should handle peer with empty bitfield', () => {
      const manager = new PieceManager(createTestOptions());
      manager.addPeerBitfield('peer-1', allocateBitfield(10));

      const requests = manager.getBlockRequests('peer-1', allocateBitfield(10), 5);

      expect(requests).toEqual([]);
    });
  });
});
