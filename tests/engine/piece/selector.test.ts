import { describe, it, expect, beforeEach } from 'vitest';
import {
  SelectionStrategy,
  PieceAvailability,
  PieceSelector,
  getEndgamePieces,
} from '../../../src/engine/piece/selector.js';
import { allocateBitfield, setBit, hasBit } from '../../../src/engine/piece/state.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a bitfield buffer with specific pieces set.
 *
 * @param pieceCount - Total number of pieces
 * @param setPieces - Array of piece indices to set as "have"
 * @returns Bitfield buffer with specified pieces set
 */
function createBitfield(pieceCount: number, setPieces: number[]): Buffer {
  const bitfield = allocateBitfield(pieceCount);
  for (const index of setPieces) {
    setBit(bitfield, index);
  }
  return bitfield;
}

/**
 * Create a full bitfield (all pieces set).
 *
 * @param pieceCount - Total number of pieces
 * @returns Bitfield buffer with all pieces set
 */
function createFullBitfield(pieceCount: number): Buffer {
  const bitfield = allocateBitfield(pieceCount);
  for (let i = 0; i < pieceCount; i++) {
    setBit(bitfield, i);
  }
  return bitfield;
}

/**
 * Create an empty bitfield (no pieces set).
 *
 * @param pieceCount - Total number of pieces
 * @returns Empty bitfield buffer
 */
function createEmptyBitfield(pieceCount: number): Buffer {
  return allocateBitfield(pieceCount);
}

// =============================================================================
// PieceAvailability Tests
// =============================================================================

describe('PieceAvailability', () => {
  describe('constructor', () => {
    it('should initialize with correct piece count', () => {
      const availability = new PieceAvailability(100);
      expect(availability.pieceCount).toBe(100);
    });

    it('should initialize availability array with zeros', () => {
      const availability = new PieceAvailability(10);
      expect(availability.availability.length).toBe(10);
      expect(availability.availability.every((count) => count === 0)).toBe(true);
    });

    it('should initialize empty peer bitfields map', () => {
      const availability = new PieceAvailability(10);
      expect(availability.peerBitfields.size).toBe(0);
    });

    it('should handle zero pieces', () => {
      const availability = new PieceAvailability(0);
      expect(availability.pieceCount).toBe(0);
      expect(availability.availability.length).toBe(0);
    });
  });

  describe('addPeer', () => {
    it('should add a peer with their bitfield', () => {
      const availability = new PieceAvailability(8);
      const bitfield = createBitfield(8, [0, 2, 4]);

      availability.addPeer('peer-1', bitfield);

      expect(availability.hasPeer('peer-1')).toBe(true);
      expect(availability.peerBitfields.get('peer-1')).not.toBe(bitfield); // Should be a copy
    });

    it('should increment availability counts for pieces peer has', () => {
      const availability = new PieceAvailability(8);
      const bitfield = createBitfield(8, [0, 2, 4]);

      availability.addPeer('peer-1', bitfield);

      expect(availability.getAvailability(0)).toBe(1);
      expect(availability.getAvailability(1)).toBe(0);
      expect(availability.getAvailability(2)).toBe(1);
      expect(availability.getAvailability(3)).toBe(0);
      expect(availability.getAvailability(4)).toBe(1);
    });

    it('should handle multiple peers correctly', () => {
      const availability = new PieceAvailability(8);

      availability.addPeer('peer-1', createBitfield(8, [0, 1, 2]));
      availability.addPeer('peer-2', createBitfield(8, [0, 2, 4]));
      availability.addPeer('peer-3', createBitfield(8, [0, 3, 5]));

      expect(availability.getAvailability(0)).toBe(3); // All three have it
      expect(availability.getAvailability(1)).toBe(1); // Only peer-1
      expect(availability.getAvailability(2)).toBe(2); // peer-1 and peer-2
      expect(availability.getAvailability(3)).toBe(1); // Only peer-3
      expect(availability.getAvailability(4)).toBe(1); // Only peer-2
      expect(availability.getAvailability(5)).toBe(1); // Only peer-3
      expect(availability.getAvailability(6)).toBe(0); // Nobody has it
    });

    it('should update existing peer correctly (replace)', () => {
      const availability = new PieceAvailability(8);

      availability.addPeer('peer-1', createBitfield(8, [0, 1, 2]));
      expect(availability.getAvailability(0)).toBe(1);
      expect(availability.getAvailability(3)).toBe(0);

      // Replace with different bitfield
      availability.addPeer('peer-1', createBitfield(8, [3, 4, 5]));

      // Old pieces should be decremented
      expect(availability.getAvailability(0)).toBe(0);
      expect(availability.getAvailability(1)).toBe(0);
      expect(availability.getAvailability(2)).toBe(0);

      // New pieces should be incremented
      expect(availability.getAvailability(3)).toBe(1);
      expect(availability.getAvailability(4)).toBe(1);
      expect(availability.getAvailability(5)).toBe(1);
    });

    it('should store a copy of the bitfield', () => {
      const availability = new PieceAvailability(8);
      const bitfield = createBitfield(8, [0, 1, 2]);

      availability.addPeer('peer-1', bitfield);

      // Modify original bitfield
      setBit(bitfield, 7);

      // Stored bitfield should not be affected
      const stored = availability.peerBitfields.get('peer-1')!;
      expect(hasBit(stored, 7)).toBe(false);
    });
  });

  describe('removePeer', () => {
    it('should remove a peer', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 1, 2]));

      availability.removePeer('peer-1');

      expect(availability.hasPeer('peer-1')).toBe(false);
    });

    it('should decrement availability counts when removing peer', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 1, 2]));
      availability.addPeer('peer-2', createBitfield(8, [0, 2, 4]));

      expect(availability.getAvailability(0)).toBe(2);
      expect(availability.getAvailability(2)).toBe(2);

      availability.removePeer('peer-1');

      expect(availability.getAvailability(0)).toBe(1);
      expect(availability.getAvailability(1)).toBe(0);
      expect(availability.getAvailability(2)).toBe(1);
      expect(availability.getAvailability(4)).toBe(1);
    });

    it('should handle removing non-existent peer gracefully', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 1, 2]));

      // Should not throw
      availability.removePeer('peer-nonexistent');

      // Original peer should still be there
      expect(availability.hasPeer('peer-1')).toBe(true);
    });
  });

  describe('updatePeerHave', () => {
    it('should increment availability for newly announced piece', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 1]));

      expect(availability.getAvailability(2)).toBe(0);

      availability.updatePeerHave('peer-1', 2);

      expect(availability.getAvailability(2)).toBe(1);
    });

    it('should not double-count if peer already has piece', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 1, 2]));

      expect(availability.getAvailability(2)).toBe(1);

      availability.updatePeerHave('peer-1', 2);

      expect(availability.getAvailability(2)).toBe(1); // Still 1
    });

    it('should update the stored bitfield', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0]));

      availability.updatePeerHave('peer-1', 5);

      const stored = availability.peerBitfields.get('peer-1')!;
      expect(hasBit(stored, 5)).toBe(true);
    });

    it('should create new peer if not tracked', () => {
      const availability = new PieceAvailability(8);

      availability.updatePeerHave('new-peer', 3);

      expect(availability.hasPeer('new-peer')).toBe(true);
      expect(availability.getAvailability(3)).toBe(1);
    });
  });

  describe('getAvailability', () => {
    it('should return 0 for invalid piece index (negative)', () => {
      const availability = new PieceAvailability(8);
      expect(availability.getAvailability(-1)).toBe(0);
    });

    it('should return 0 for invalid piece index (too large)', () => {
      const availability = new PieceAvailability(8);
      expect(availability.getAvailability(10)).toBe(0);
    });

    it('should return correct count for valid piece', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [3]));
      availability.addPeer('peer-2', createBitfield(8, [3]));

      expect(availability.getAvailability(3)).toBe(2);
    });
  });

  describe('getRarestPieces', () => {
    it('should return pieces sorted by rarity (ascending)', () => {
      const availability = new PieceAvailability(8);

      // Piece 0: 3 peers, Piece 1: 1 peer, Piece 2: 2 peers, Piece 3: 1 peer
      availability.addPeer('peer-1', createBitfield(8, [0, 1, 2]));
      availability.addPeer('peer-2', createBitfield(8, [0, 2]));
      availability.addPeer('peer-3', createBitfield(8, [0, 3]));

      const rarest = availability.getRarestPieces(new Set());

      // Rarest first: 1 (count=1), 3 (count=1), 2 (count=2), 0 (count=3)
      expect(rarest[0]).toBe(1); // count=1, lowest index among count=1
      expect(rarest[1]).toBe(3); // count=1
      expect(rarest[2]).toBe(2); // count=2
      expect(rarest[3]).toBe(0); // count=3
    });

    it('should exclude pieces in the exclude set', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 1, 2, 3]));

      const rarest = availability.getRarestPieces(new Set([0, 2]));

      expect(rarest).toContain(1);
      expect(rarest).toContain(3);
      expect(rarest).not.toContain(0);
      expect(rarest).not.toContain(2);
    });

    it('should not include pieces with zero availability', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 2]));

      const rarest = availability.getRarestPieces(new Set());

      expect(rarest).toContain(0);
      expect(rarest).toContain(2);
      expect(rarest).not.toContain(1); // No peer has it
      expect(rarest.length).toBe(2);
    });

    it('should prefer lower index for equally rare pieces', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [3, 5, 7]));

      const rarest = availability.getRarestPieces(new Set());

      // All have count=1, should be sorted by index
      expect(rarest).toEqual([3, 5, 7]);
    });

    it('should return empty array if all pieces excluded', () => {
      const availability = new PieceAvailability(4);
      availability.addPeer('peer-1', createBitfield(4, [0, 1, 2, 3]));

      const rarest = availability.getRarestPieces(new Set([0, 1, 2, 3]));

      expect(rarest).toEqual([]);
    });
  });

  describe('getPeersWithPiece', () => {
    it('should return all peers that have a piece', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 1]));
      availability.addPeer('peer-2', createBitfield(8, [0, 2]));
      availability.addPeer('peer-3', createBitfield(8, [0, 3]));

      const peers = availability.getPeersWithPiece(0);

      expect(peers).toContain('peer-1');
      expect(peers).toContain('peer-2');
      expect(peers).toContain('peer-3');
      expect(peers.length).toBe(3);
    });

    it('should return empty array if no peers have piece', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 1]));

      const peers = availability.getPeersWithPiece(5);

      expect(peers).toEqual([]);
    });

    it('should return correct peers for specific piece', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0, 1]));
      availability.addPeer('peer-2', createBitfield(8, [1, 2]));
      availability.addPeer('peer-3', createBitfield(8, [2, 3]));

      const peers1 = availability.getPeersWithPiece(1);
      expect(peers1).toContain('peer-1');
      expect(peers1).toContain('peer-2');
      expect(peers1).not.toContain('peer-3');
    });
  });

  describe('hasPeer', () => {
    it('should return true for registered peer', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0]));

      expect(availability.hasPeer('peer-1')).toBe(true);
    });

    it('should return false for non-registered peer', () => {
      const availability = new PieceAvailability(8);

      expect(availability.hasPeer('peer-nonexistent')).toBe(false);
    });

    it('should return false after peer is removed', () => {
      const availability = new PieceAvailability(8);
      availability.addPeer('peer-1', createBitfield(8, [0]));
      availability.removePeer('peer-1');

      expect(availability.hasPeer('peer-1')).toBe(false);
    });
  });
});

// =============================================================================
// PieceSelector Tests
// =============================================================================

describe('PieceSelector', () => {
  describe('constructor', () => {
    it('should initialize with default RarestFirst strategy', () => {
      const selector = new PieceSelector(100);
      expect(selector.strategy).toBe(SelectionStrategy.RarestFirst);
    });

    it('should initialize with specified strategy', () => {
      const selector = new PieceSelector(100, SelectionStrategy.Sequential);
      expect(selector.strategy).toBe(SelectionStrategy.Sequential);
    });

    it('should initialize availability tracker with correct piece count', () => {
      const selector = new PieceSelector(100);
      expect(selector.availability.pieceCount).toBe(100);
    });
  });

  describe('setStrategy', () => {
    it('should change the strategy', () => {
      const selector = new PieceSelector(100);

      selector.setStrategy(SelectionStrategy.Sequential);
      expect(selector.strategy).toBe(SelectionStrategy.Sequential);

      selector.setStrategy(SelectionStrategy.Random);
      expect(selector.strategy).toBe(SelectionStrategy.Random);
    });
  });

  describe('selectPiece - RarestFirst strategy', () => {
    let selector: PieceSelector;

    beforeEach(() => {
      selector = new PieceSelector(10, SelectionStrategy.RarestFirst);
    });

    it('should select the rarest available piece', () => {
      // Peer 1 has pieces 0, 1, 2 (common)
      // Peer 2 has pieces 0, 3 (piece 3 is rarer)
      selector.availability.addPeer('peer-1', createBitfield(10, [0, 1, 2]));
      selector.availability.addPeer('peer-2', createBitfield(10, [0, 3]));

      const ownBitfield = createEmptyBitfield(10);
      const peerBitfield = createBitfield(10, [0, 3]); // peer-2's pieces
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBe(3); // Rarer (count=1) vs 0 (count=2)
    });

    it('should prefer lower index for equally rare pieces', () => {
      selector.availability.addPeer('peer-1', createBitfield(10, [3, 7]));

      const ownBitfield = createEmptyBitfield(10);
      const peerBitfield = createBitfield(10, [3, 7]);
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBe(3); // Lower index
    });

    it('should not return pieces we already own', () => {
      selector.availability.addPeer('peer-1', createBitfield(10, [0, 1, 2]));

      const ownBitfield = createBitfield(10, [0, 1]); // We have 0, 1
      const peerBitfield = createBitfield(10, [0, 1, 2]);
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBe(2); // Only piece we don't have
    });

    it('should not return pieces the peer does not have', () => {
      selector.availability.addPeer('peer-1', createBitfield(10, [0, 1, 2, 3, 4]));

      const ownBitfield = createEmptyBitfield(10);
      const peerBitfield = createBitfield(10, [2, 4]); // Peer only has 2, 4
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect([2, 4]).toContain(piece); // Must be one peer has
    });

    it('should not return pieces in progress', () => {
      selector.availability.addPeer('peer-1', createBitfield(10, [0, 1, 2]));

      const ownBitfield = createEmptyBitfield(10);
      const peerBitfield = createBitfield(10, [0, 1, 2]);
      const inProgress = new Set<number>([0, 1]); // 0 and 1 are in progress

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBe(2);
    });

    it('should return null when no pieces available', () => {
      selector.availability.addPeer('peer-1', createBitfield(10, [0, 1, 2]));

      const ownBitfield = createBitfield(10, [0, 1, 2]); // We have all peer's pieces
      const peerBitfield = createBitfield(10, [0, 1, 2]);
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBeNull();
    });

    it('should return null when peer has no useful pieces', () => {
      selector.availability.addPeer('peer-1', createBitfield(10, [0, 1, 2]));

      const ownBitfield = createEmptyBitfield(10);
      const peerBitfield = createEmptyBitfield(10); // Peer has nothing
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBeNull();
    });

    it('should handle pieces with zero availability (not tracked)', () => {
      // No peers added - all pieces have zero availability
      const ownBitfield = createEmptyBitfield(10);
      const peerBitfield = createBitfield(10, [0, 1, 2]);
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      // Should still work - picks from candidates even with zero availability
      expect([0, 1, 2]).toContain(piece);
    });
  });

  describe('selectPiece - Sequential strategy', () => {
    let selector: PieceSelector;

    beforeEach(() => {
      selector = new PieceSelector(10, SelectionStrategy.Sequential);
    });

    it('should select the lowest index piece', () => {
      selector.availability.addPeer('peer-1', createBitfield(10, [3, 5, 7]));

      const ownBitfield = createEmptyBitfield(10);
      const peerBitfield = createBitfield(10, [3, 5, 7]);
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBe(3);
    });

    it('should skip pieces we already have', () => {
      selector.availability.addPeer('peer-1', createBitfield(10, [0, 1, 2, 3]));

      const ownBitfield = createBitfield(10, [0, 1]); // Have first two
      const peerBitfield = createBitfield(10, [0, 1, 2, 3]);
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBe(2); // First piece we don't have
    });

    it('should skip pieces in progress', () => {
      const ownBitfield = createEmptyBitfield(10);
      const peerBitfield = createBitfield(10, [0, 1, 2, 3, 4]);
      const inProgress = new Set<number>([0, 1, 2]);

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBe(3);
    });

    it('should return null when all pieces owned or in progress', () => {
      const ownBitfield = createBitfield(10, [0, 1]);
      const peerBitfield = createBitfield(10, [0, 1, 2, 3]);
      const inProgress = new Set<number>([2, 3]);

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBeNull();
    });
  });

  describe('selectPiece - Random strategy', () => {
    let selector: PieceSelector;

    beforeEach(() => {
      selector = new PieceSelector(100, SelectionStrategy.Random);
    });

    it('should return a valid piece', () => {
      selector.availability.addPeer('peer-1', createBitfield(100, [10, 20, 30, 40, 50]));

      const ownBitfield = createEmptyBitfield(100);
      const peerBitfield = createBitfield(100, [10, 20, 30, 40, 50]);
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect([10, 20, 30, 40, 50]).toContain(piece);
    });

    it('should respect exclusions', () => {
      selector.availability.addPeer('peer-1', createBitfield(100, [10, 20, 30]));

      const ownBitfield = createBitfield(100, [10]); // Have piece 10
      const peerBitfield = createBitfield(100, [10, 20, 30]);
      const inProgress = new Set<number>([20]); // 20 in progress

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBe(30); // Only valid choice
    });

    it('should return null when no pieces available', () => {
      const ownBitfield = createFullBitfield(100);
      const peerBitfield = createFullBitfield(100);
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBeNull();
    });

    it('should return different pieces over multiple calls (probabilistic)', () => {
      selector.availability.addPeer('peer-1', createFullBitfield(100));

      const ownBitfield = createEmptyBitfield(100);
      const peerBitfield = createFullBitfield(100);
      const inProgress = new Set<number>();

      const selections = new Set<number>();
      for (let i = 0; i < 50; i++) {
        const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);
        if (piece !== null) {
          selections.add(piece);
        }
      }

      // With 100 pieces and 50 random selections, we should get more than 1 unique piece
      // (probability of getting same piece 50 times is astronomically low)
      expect(selections.size).toBeGreaterThan(1);
    });
  });

  describe('selectPieces - Multi-piece selection', () => {
    let selector: PieceSelector;

    beforeEach(() => {
      selector = new PieceSelector(20, SelectionStrategy.Sequential);
    });

    it('should return requested number of pieces', () => {
      const ownBitfield = createEmptyBitfield(20);
      const peerBitfield = createFullBitfield(20);
      const inProgress = new Set<number>();

      const pieces = selector.selectPieces(ownBitfield, peerBitfield, inProgress, 5);

      expect(pieces.length).toBe(5);
    });

    it('should not return duplicate pieces', () => {
      const ownBitfield = createEmptyBitfield(20);
      const peerBitfield = createFullBitfield(20);
      const inProgress = new Set<number>();

      const pieces = selector.selectPieces(ownBitfield, peerBitfield, inProgress, 10);

      const uniquePieces = new Set(pieces);
      expect(uniquePieces.size).toBe(pieces.length);
    });

    it('should return fewer pieces if not enough available', () => {
      const ownBitfield = createEmptyBitfield(20);
      const peerBitfield = createBitfield(20, [0, 1, 2]); // Only 3 pieces
      const inProgress = new Set<number>();

      const pieces = selector.selectPieces(ownBitfield, peerBitfield, inProgress, 10);

      expect(pieces.length).toBe(3);
      expect(pieces).toEqual([0, 1, 2]); // Sequential order
    });

    it('should return empty array if no pieces available', () => {
      const ownBitfield = createFullBitfield(20);
      const peerBitfield = createFullBitfield(20);
      const inProgress = new Set<number>();

      const pieces = selector.selectPieces(ownBitfield, peerBitfield, inProgress, 5);

      expect(pieces).toEqual([]);
    });

    it('should respect original inProgress set', () => {
      const ownBitfield = createEmptyBitfield(20);
      const peerBitfield = createBitfield(20, [0, 1, 2, 3, 4]);
      const inProgress = new Set<number>([0, 1]);

      const pieces = selector.selectPieces(ownBitfield, peerBitfield, inProgress, 5);

      expect(pieces).not.toContain(0);
      expect(pieces).not.toContain(1);
      expect(pieces).toEqual([2, 3, 4]);
    });

    it('should not modify the original inProgress set', () => {
      const ownBitfield = createEmptyBitfield(20);
      const peerBitfield = createFullBitfield(20);
      const inProgress = new Set<number>([0]);

      selector.selectPieces(ownBitfield, peerBitfield, inProgress, 5);

      expect(inProgress.size).toBe(1);
      expect(inProgress.has(0)).toBe(true);
    });
  });
});

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('Edge Cases', () => {
  describe('Empty bitfields', () => {
    it('should handle empty own bitfield', () => {
      const selector = new PieceSelector(10);
      selector.availability.addPeer('peer-1', createBitfield(10, [0, 1, 2]));

      const piece = selector.selectPiece(
        createEmptyBitfield(10),
        createBitfield(10, [0, 1, 2]),
        new Set()
      );

      expect([0, 1, 2]).toContain(piece);
    });

    it('should return null for empty peer bitfield', () => {
      const selector = new PieceSelector(10);

      const piece = selector.selectPiece(
        createEmptyBitfield(10),
        createEmptyBitfield(10),
        new Set()
      );

      expect(piece).toBeNull();
    });

    it('should return null when both bitfields are empty', () => {
      const selector = new PieceSelector(10);

      const piece = selector.selectPiece(
        createEmptyBitfield(10),
        createEmptyBitfield(10),
        new Set()
      );

      expect(piece).toBeNull();
    });
  });

  describe('All pieces owned', () => {
    it('should return null when we have all pieces', () => {
      const selector = new PieceSelector(10);
      selector.availability.addPeer('peer-1', createFullBitfield(10));

      const piece = selector.selectPiece(
        createFullBitfield(10),
        createFullBitfield(10),
        new Set()
      );

      expect(piece).toBeNull();
    });
  });

  describe('Single piece torrent', () => {
    it('should select the only piece if available', () => {
      const selector = new PieceSelector(1);
      selector.availability.addPeer('peer-1', createBitfield(1, [0]));

      const piece = selector.selectPiece(
        createEmptyBitfield(1),
        createBitfield(1, [0]),
        new Set()
      );

      expect(piece).toBe(0);
    });

    it('should return null if the only piece is owned', () => {
      const selector = new PieceSelector(1);

      const piece = selector.selectPiece(
        createBitfield(1, [0]),
        createBitfield(1, [0]),
        new Set()
      );

      expect(piece).toBeNull();
    });

    it('should return null if the only piece is in progress', () => {
      const selector = new PieceSelector(1);

      const piece = selector.selectPiece(
        createEmptyBitfield(1),
        createBitfield(1, [0]),
        new Set([0])
      );

      expect(piece).toBeNull();
    });
  });

  describe('Large torrent (many pieces)', () => {
    it('should handle large piece count efficiently', () => {
      const pieceCount = 10000;
      const selector = new PieceSelector(pieceCount, SelectionStrategy.RarestFirst);

      // Add multiple peers with varying piece availability
      for (let i = 0; i < 10; i++) {
        const pieces: number[] = [];
        for (let j = i * 1000; j < (i + 1) * 1000; j++) {
          pieces.push(j);
        }
        selector.availability.addPeer(`peer-${i}`, createBitfield(pieceCount, pieces));
      }

      const ownBitfield = createEmptyBitfield(pieceCount);
      const peerBitfield = createBitfield(pieceCount, [0, 5000, 9999]);
      const inProgress = new Set<number>();

      const startTime = performance.now();
      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);
      const endTime = performance.now();

      expect(piece).not.toBeNull();
      expect([0, 5000, 9999]).toContain(piece);
      expect(endTime - startTime).toBeLessThan(100); // Should be fast
    });

    it('should select correct rarest piece from large set', () => {
      const pieceCount = 1000;
      const selector = new PieceSelector(pieceCount, SelectionStrategy.RarestFirst);

      // Make piece 500 the rarest (only 1 peer has it)
      selector.availability.addPeer('peer-1', createBitfield(pieceCount, [500]));

      // Make other pieces more common
      for (let i = 0; i < 5; i++) {
        const pieces = [0, 100, 200, 300, 400, 600, 700, 800, 900];
        selector.availability.addPeer(`peer-${i + 2}`, createBitfield(pieceCount, pieces));
      }

      const ownBitfield = createEmptyBitfield(pieceCount);
      const peerBitfield = createBitfield(pieceCount, [0, 100, 500]); // Peer has common and rare
      const inProgress = new Set<number>();

      const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);

      expect(piece).toBe(500); // Rarest piece
    });
  });
});

// =============================================================================
// getEndgamePieces Tests
// =============================================================================

describe('getEndgamePieces', () => {
  it('should return empty array when not in endgame mode', () => {
    const pieceCount = 100;
    const threshold = 5;
    const ownBitfield = createBitfield(pieceCount, [0, 1, 2]); // Only 3 pieces, missing 97

    const missing = getEndgamePieces(ownBitfield, pieceCount, threshold);

    expect(missing).toEqual([]);
  });

  it('should return missing pieces when in endgame mode', () => {
    const pieceCount = 10;
    const threshold = 3;

    // Have 8 pieces, missing 2 (pieces 5 and 8)
    const ownBitfield = createBitfield(pieceCount, [0, 1, 2, 3, 4, 6, 7, 9]);

    const missing = getEndgamePieces(ownBitfield, pieceCount, threshold);

    expect(missing).toContain(5);
    expect(missing).toContain(8);
    expect(missing.length).toBe(2);
  });

  it('should return empty array when all pieces are owned', () => {
    const pieceCount = 10;
    const threshold = 3;
    const ownBitfield = createFullBitfield(pieceCount);

    const missing = getEndgamePieces(ownBitfield, pieceCount, threshold);

    expect(missing).toEqual([]);
  });

  it('should return all missing pieces at threshold boundary', () => {
    const pieceCount = 10;
    const threshold = 3;

    // Have 7 pieces, missing exactly 3 (at threshold)
    const ownBitfield = createBitfield(pieceCount, [0, 1, 2, 3, 4, 5, 6]);

    const missing = getEndgamePieces(ownBitfield, pieceCount, threshold);

    expect(missing).toEqual([7, 8, 9]);
  });

  it('should not include owned pieces', () => {
    const pieceCount = 10;
    const threshold = 5;

    // Have all except pieces 3 and 7
    const ownBitfield = createBitfield(pieceCount, [0, 1, 2, 4, 5, 6, 8, 9]);

    const missing = getEndgamePieces(ownBitfield, pieceCount, threshold);

    expect(missing).toEqual([3, 7]);
    expect(missing).not.toContain(0);
    expect(missing).not.toContain(9);
  });

  it('should handle single piece torrent', () => {
    const pieceCount = 1;
    const threshold = 1;

    const missing = getEndgamePieces(createEmptyBitfield(1), pieceCount, threshold);
    expect(missing).toEqual([0]);

    const notMissing = getEndgamePieces(createBitfield(1, [0]), pieceCount, threshold);
    expect(notMissing).toEqual([]);
  });

  it('should handle threshold of 0', () => {
    const pieceCount = 10;
    const threshold = 0;

    // With threshold 0, we're only in endgame when complete (0 missing)
    const almostComplete = createBitfield(pieceCount, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(getEndgamePieces(almostComplete, pieceCount, threshold)).toEqual([]);

    const complete = createFullBitfield(pieceCount);
    expect(getEndgamePieces(complete, pieceCount, threshold)).toEqual([]);
  });
});

// =============================================================================
// SelectionStrategy Enum Tests
// =============================================================================

describe('SelectionStrategy Enum', () => {
  it('should have correct values', () => {
    expect(SelectionStrategy.RarestFirst).toBe('rarest-first');
    expect(SelectionStrategy.Sequential).toBe('sequential');
    expect(SelectionStrategy.Random).toBe('random');
  });
});
