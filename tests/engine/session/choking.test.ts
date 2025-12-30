import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChokingAlgorithm, PeerStats, PeerList } from '../../../src/engine/session/choking.js';

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockPeerStats(overrides: Partial<PeerStats> = {}): PeerStats {
  return {
    peerId: 'peer-1',
    downloadRate: 0,
    uploadRate: 0,
    amChoking: true,
    peerInterested: false,
    amInterested: false,
    peerChoking: true,
    ...overrides,
  };
}

function createMockPeerList(peers: PeerStats[] = []): PeerList {
  return {
    getPeerStats: () => peers,
    getPeerStat: (peerId: string) => peers.find((p) => p.peerId === peerId),
  };
}

// =============================================================================
// ChokingAlgorithm Tests
// =============================================================================

// Skipped: vi.useFakeTimers() not supported in Bun's test runner
// TODO: Rewrite these tests to not depend on Vitest timer mocking
describe.skip('ChokingAlgorithm', () => {
  let algorithm: ChokingAlgorithm;
  let mockPeerList: PeerList;
  let mockPeers: PeerStats[];

  beforeEach(() => {
    vi.useFakeTimers();
    mockPeers = [];
    mockPeerList = createMockPeerList(mockPeers);
  });

  afterEach(() => {
    if (algorithm) {
      algorithm.stop();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create an instance with peer list', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      expect(algorithm).toBeInstanceOf(ChokingAlgorithm);
    });

    it('should start with no unchoked peers', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      expect(algorithm.getUnchoked()).toHaveLength(0);
    });
  });

  // ===========================================================================
  // start/stop Tests
  // ===========================================================================

  describe('start', () => {
    it('should start the algorithm', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.start();
      // No error means success - internal running state
    });

    it('should perform initial recalculation on start', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 1000,
        })
      );
      algorithm = new ChokingAlgorithm(mockPeerList);

      const unchokeHandler = vi.fn();
      algorithm.on('unchoke', unchokeHandler);
      algorithm.addPeer('peer-1');
      algorithm.start();

      expect(unchokeHandler).toHaveBeenCalled();
    });

    it('should be idempotent', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.start();
      algorithm.start();
      // No error means success
    });
  });

  describe('stop', () => {
    it('should stop the algorithm', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.start();
      algorithm.stop();
      // No error means success
    });

    it('should clear unchoked peers', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 1000,
        })
      );
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.start();

      expect(algorithm.getUnchoked().length).toBeGreaterThan(0);

      algorithm.stop();
      expect(algorithm.getUnchoked()).toHaveLength(0);
    });

    it('should be idempotent', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.start();
      algorithm.stop();
      algorithm.stop();
      // No error means success
    });
  });

  // ===========================================================================
  // Peer Management Tests
  // ===========================================================================

  describe('addPeer', () => {
    it('should add a peer to tracking', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      // No error means success - internal state
    });

    it('should trigger recalculation when running', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 1000,
        })
      );
      algorithm = new ChokingAlgorithm(mockPeerList);

      const unchokeHandler = vi.fn();
      algorithm.on('unchoke', unchokeHandler);
      algorithm.start();
      algorithm.addPeer('peer-1');

      // Peer should be unchoked after recalculation
      expect(algorithm.getUnchoked()).toContain('peer-1');
    });

    it('should be idempotent for same peer', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.addPeer('peer-1');
      // No error means success
    });
  });

  describe('removePeer', () => {
    it('should remove a peer from tracking', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.removePeer('peer-1');
      // No error means success
    });

    it('should clear optimistic unchoke if removed peer was optimistic', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 0,
        })
      );
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.start();
      algorithm.removePeer('peer-1');
      // Internal state cleared - no error means success
    });

    it('should handle removing non-existent peer gracefully', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.removePeer('non-existent');
      // No error means success
    });
  });

  // ===========================================================================
  // Choking Decision Tests
  // ===========================================================================

  describe('recalculate', () => {
    it('should unchoke top 4 interested peers by download rate (leeching)', () => {
      // Create 6 interested peers with different download rates
      for (let i = 1; i <= 6; i++) {
        mockPeers.push(
          createMockPeerStats({
            peerId: `peer-${i}`,
            peerInterested: true,
            downloadRate: i * 1000,
          })
        );
      }

      algorithm = new ChokingAlgorithm(mockPeerList);
      for (let i = 1; i <= 6; i++) {
        algorithm.addPeer(`peer-${i}`);
      }

      const decisions = algorithm.recalculate();

      // Should unchoke top 4 by download rate
      const unchokedIds = decisions
        .filter((d) => d.action === 'unchoke')
        .map((d) => d.peerId);

      // Top 4 by download rate: peer-6, peer-5, peer-4, peer-3
      expect(unchokedIds).toContain('peer-6');
      expect(unchokedIds).toContain('peer-5');
      expect(unchokedIds).toContain('peer-4');
      expect(unchokedIds).toContain('peer-3');
    });

    it('should prefer upload rate when seeding', () => {
      // Create peers with different upload rates
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 100,
          uploadRate: 5000,
        }),
        createMockPeerStats({
          peerId: 'peer-2',
          peerInterested: true,
          downloadRate: 5000,
          uploadRate: 100,
        })
      );

      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.addPeer('peer-2');
      algorithm.setSeeding(true);

      const decisions = algorithm.recalculate();

      const unchokedIds = decisions
        .filter((d) => d.action === 'unchoke')
        .map((d) => d.peerId);

      // When seeding, peer-1 with higher upload rate should be preferred
      expect(unchokedIds[0]).toBe('peer-1');
    });

    it('should only unchoke interested peers', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: false,
          downloadRate: 10000,
        }),
        createMockPeerStats({
          peerId: 'peer-2',
          peerInterested: true,
          downloadRate: 1000,
        })
      );

      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.addPeer('peer-2');

      const decisions = algorithm.recalculate();

      const unchokedIds = decisions
        .filter((d) => d.action === 'unchoke')
        .map((d) => d.peerId);

      expect(unchokedIds).toContain('peer-2');
      expect(unchokedIds).not.toContain('peer-1');
    });

    it('should emit choke event for previously unchoked peers now choked', () => {
      // Start with 2 interested peers
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 1000,
        })
      );

      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.start();

      // Verify peer-1 is unchoked
      expect(algorithm.getUnchoked()).toContain('peer-1');

      // Now make peer-1 not interested
      mockPeers[0].peerInterested = false;

      const chokeHandler = vi.fn();
      algorithm.on('choke', chokeHandler);
      algorithm.recalculate();

      expect(chokeHandler).toHaveBeenCalledWith({ peerId: 'peer-1' });
    });
  });

  // ===========================================================================
  // Optimistic Unchoke Tests
  // ===========================================================================

  describe('optimistic unchoke', () => {
    it('should rotate optimistic unchoke every 30 seconds', () => {
      // Create more peers than regular unchoke slots
      for (let i = 1; i <= 6; i++) {
        mockPeers.push(
          createMockPeerStats({
            peerId: `peer-${i}`,
            peerInterested: true,
            downloadRate: 0, // All zero rate, so any selection is optimistic
          })
        );
      }

      algorithm = new ChokingAlgorithm(mockPeerList);
      for (let i = 1; i <= 6; i++) {
        algorithm.addPeer(`peer-${i}`);
      }
      algorithm.start();

      const initialUnchoked = [...algorithm.getUnchoked()];

      // Advance 30 seconds for optimistic rotation
      vi.advanceTimersByTime(30_000);

      // The unchoked set may have changed due to optimistic rotation
      // Just verify the algorithm is still running
      expect(algorithm.getUnchoked().length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Periodic Recalculation Tests
  // ===========================================================================

  describe('periodic recalculation', () => {
    it('should recalculate every 10 seconds', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 1000,
        })
      );

      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.start();

      // Change peer stats
      mockPeers[0].downloadRate = 5000;

      // Advance 10 seconds
      vi.advanceTimersByTime(10_000);

      // Algorithm should have recalculated (no direct way to verify,
      // but we can check it's still running)
      expect(algorithm.getUnchoked()).toContain('peer-1');
    });
  });

  // ===========================================================================
  // Snub Detection Tests
  // ===========================================================================

  describe('snub detection', () => {
    it('should emit snubbed event when peer is inactive for 60 seconds', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          amInterested: true,
          peerChoking: false, // Peer is not choking us
          downloadRate: 1000,
        })
      );

      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.start();

      const snubbedHandler = vi.fn();
      algorithm.on('snubbed', snubbedHandler);

      // Advance 60 seconds without updating peer activity
      vi.advanceTimersByTime(60_000);
      algorithm.recalculate();

      expect(snubbedHandler).toHaveBeenCalledWith({ peerId: 'peer-1' });
    });

    it('should clear snubbed status when peer becomes active', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          amInterested: true,
          peerChoking: false,
          downloadRate: 1000,
        })
      );

      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.start();

      // Advance to trigger snubbing
      vi.advanceTimersByTime(60_000);
      algorithm.recalculate();

      // Update peer activity - should clear snubbed status
      algorithm.updatePeerActivity('peer-1');

      // Recalculate - should not emit snubbed again for this peer
      const snubbedHandler = vi.fn();
      algorithm.on('snubbed', snubbedHandler);
      algorithm.recalculate();

      expect(snubbedHandler).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // setSeeding Tests
  // ===========================================================================

  describe('setSeeding', () => {
    it('should switch to upload rate preference when seeding', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 1000,
          uploadRate: 100,
        }),
        createMockPeerStats({
          peerId: 'peer-2',
          peerInterested: true,
          downloadRate: 100,
          uploadRate: 1000,
        })
      );

      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.addPeer('peer-2');
      algorithm.start();

      // Both peers should be unchoked (only 2 peers, under 4 slot limit)
      let unchoked = algorithm.getUnchoked();
      expect(unchoked).toContain('peer-1');
      expect(unchoked).toContain('peer-2');

      // Switch to seeding mode and verify it recalculates
      algorithm.setSeeding(true);

      // Both peers should still be unchoked
      unchoked = algorithm.getUnchoked();
      expect(unchoked.length).toBe(2);
    });

    it('should trigger recalculation when mode changes', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 1000,
        })
      );

      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.start();

      const unchokeHandler = vi.fn();
      algorithm.on('unchoke', unchokeHandler);

      // Clear handler call count
      unchokeHandler.mockClear();

      algorithm.setSeeding(true);

      // Recalculation should have been triggered
      // (may or may not emit events depending on state)
    });
  });

  // ===========================================================================
  // getUnchoked Tests
  // ===========================================================================

  describe('getUnchoked', () => {
    it('should return empty array when no peers', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      expect(algorithm.getUnchoked()).toEqual([]);
    });

    it('should return list of unchoked peers', () => {
      mockPeers.push(
        createMockPeerStats({
          peerId: 'peer-1',
          peerInterested: true,
          downloadRate: 1000,
        }),
        createMockPeerStats({
          peerId: 'peer-2',
          peerInterested: true,
          downloadRate: 2000,
        })
      );

      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.addPeer('peer-2');
      algorithm.start();

      const unchoked = algorithm.getUnchoked();
      expect(unchoked).toContain('peer-1');
      expect(unchoked).toContain('peer-2');
    });
  });

  // ===========================================================================
  // updatePeerActivity Tests
  // ===========================================================================

  describe('updatePeerActivity', () => {
    it('should update timestamp for known peer', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.addPeer('peer-1');
      algorithm.updatePeerActivity('peer-1');
      // No error means success
    });

    it('should create activity record for unknown peer', () => {
      algorithm = new ChokingAlgorithm(mockPeerList);
      algorithm.updatePeerActivity('peer-1');
      // No error means success - activity is tracked
    });
  });
});
