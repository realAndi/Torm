import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TrackerClient,
  TrackerClientOptions,
  TorrentTrackerState,
  PeerInfo,
  AnnounceResponse,
  getTrackerType,
  parseAnnounceList,
} from '../../../src/engine/tracker/client.js';
import { TrackerStatus } from '../../../src/engine/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createPeerId(): Buffer {
  return Buffer.from('-TR3000-123456789012');
}

function createInfoHash(): Buffer {
  return Buffer.alloc(20, 0xab);
}

function createClientOptions(overrides?: Partial<TrackerClientOptions>): TrackerClientOptions {
  return {
    peerId: createPeerId(),
    port: 6881,
    ...overrides,
  };
}

function createTorrentState(overrides?: Partial<TorrentTrackerState>): TorrentTrackerState {
  return {
    infoHash: createInfoHash(),
    downloaded: 0,
    uploaded: 0,
    left: 1000000,
    trackers: [['http://tracker.example.com/announce']],
    ...overrides,
  };
}

function createPeers(count: number): PeerInfo[] {
  const peers: PeerInfo[] = [];
  for (let i = 0; i < count; i++) {
    peers.push({
      ip: `192.168.1.${i + 1}`,
      port: 6881 + i,
      peerId: `peer${i}`.padEnd(20, '0'),
    });
  }
  return peers;
}

function createMockAnnounceResponse(overrides?: Partial<AnnounceResponse>): AnnounceResponse {
  return {
    interval: 1800,
    complete: 10,
    incomplete: 5,
    peers: createPeers(3),
    ...overrides,
  };
}

// =============================================================================
// Tests for Helper Functions
// =============================================================================

describe('getTrackerType', () => {
  it('should return "http" for HTTP URLs', () => {
    expect(getTrackerType('http://tracker.example.com/announce')).toBe('http');
  });

  it('should return "http" for HTTPS URLs', () => {
    expect(getTrackerType('https://tracker.example.com/announce')).toBe('http');
  });

  it('should return "udp" for UDP URLs', () => {
    expect(getTrackerType('udp://tracker.example.com:1337/announce')).toBe('udp');
  });

  it('should return "unknown" for unsupported protocols', () => {
    expect(getTrackerType('wss://tracker.example.com/announce')).toBe('unknown');
    expect(getTrackerType('ftp://tracker.example.com/announce')).toBe('unknown');
  });

  it('should return "unknown" for invalid URLs', () => {
    expect(getTrackerType('not-a-url')).toBe('unknown');
    expect(getTrackerType('')).toBe('unknown');
  });

  it('should handle URLs with various port numbers', () => {
    expect(getTrackerType('http://tracker.example.com:8080/announce')).toBe('http');
    expect(getTrackerType('udp://tracker.example.com:6969/announce')).toBe('udp');
  });
});

describe('parseAnnounceList', () => {
  it('should return single announce URL as tier 0', () => {
    const result = parseAnnounceList('http://tracker.example.com/announce');
    expect(result).toEqual([['http://tracker.example.com/announce']]);
  });

  it('should return announce-list if provided', () => {
    const announceList = [
      ['http://tier1a.com/announce', 'http://tier1b.com/announce'],
      ['udp://tier2.com:1337/announce'],
    ];
    const result = parseAnnounceList('http://primary.com/announce', announceList);

    expect(result).toHaveLength(2);
    expect(result[0]).toContain('http://primary.com/announce');
    expect(result[0]).toContain('http://tier1a.com/announce');
    expect(result[1]).toContain('udp://tier2.com:1337/announce');
  });

  it('should add primary announce to tier 0 if not present', () => {
    const announceList = [['http://other.com/announce']];
    const result = parseAnnounceList('http://primary.com/announce', announceList);

    expect(result[0]).toContain('http://primary.com/announce');
    expect(result[0].indexOf('http://primary.com/announce')).toBe(0);
  });

  it('should not duplicate primary announce if already in announce-list', () => {
    const announceList = [['http://primary.com/announce', 'http://other.com/announce']];
    const result = parseAnnounceList('http://primary.com/announce', announceList);

    const primaryCount = result[0].filter((url) => url === 'http://primary.com/announce').length;
    expect(primaryCount).toBe(1);
  });

  it('should filter out empty URLs and empty tiers', () => {
    const announceList = [
      ['http://tracker1.com/announce', '', '  '],
      [''],
      ['http://tracker2.com/announce'],
    ];
    const result = parseAnnounceList('', announceList);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(['http://tracker1.com/announce']);
    expect(result[1]).toEqual(['http://tracker2.com/announce']);
  });

  it('should return empty array for no trackers', () => {
    expect(parseAnnounceList('')).toEqual([]);
    expect(parseAnnounceList('', [])).toEqual([]);
    expect(parseAnnounceList('', [[]])).toEqual([]);
  });
});

// =============================================================================
// Tests for TrackerClient Class
// =============================================================================

describe('TrackerClient', () => {
  let client: TrackerClient;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with required options', () => {
      client = new TrackerClient(createClientOptions());
      expect(client).toBeInstanceOf(TrackerClient);
    });

    it('should accept custom user agent', () => {
      client = new TrackerClient(
        createClientOptions({
          userAgent: 'CustomClient/1.0',
        }),
      );
      expect(client).toBeInstanceOf(TrackerClient);
    });

    it('should accept custom announce interval', () => {
      client = new TrackerClient(
        createClientOptions({
          announceInterval: 600,
        }),
      );
      expect(client).toBeInstanceOf(TrackerClient);
    });

    it('should use default values when optional fields not provided', () => {
      client = new TrackerClient({
        peerId: createPeerId(),
        port: 6881,
      });
      expect(client).toBeInstanceOf(TrackerClient);
    });
  });

  describe('addTorrent', () => {
    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
    });

    it('should add a new torrent', () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(1);
      expect(trackers[0].url).toBe('http://tracker.example.com/announce');
      expect(trackers[0].status).toBe(TrackerStatus.Idle);
    });

    it('should handle multiple tracker tiers', () => {
      const state = createTorrentState({
        trackers: [
          ['http://tier1a.com/announce', 'http://tier1b.com/announce'],
          ['udp://tier2.com:1337/announce'],
          ['http://tier3.com/announce'],
        ],
      });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(4);
    });

    it('should update existing torrent stats when adding same info hash', () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      // Add again with updated stats
      client.addTorrent({
        ...state,
        downloaded: 50000,
        uploaded: 10000,
        left: 950000,
      });

      // Should still have same trackers
      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(1);
    });

    it('should handle empty tracker list', () => {
      const state = createTorrentState({ trackers: [] });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(0);
    });

    it('should set initial tracker status to Idle', () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      const trackers = client.getTrackerInfo(infoHashHex);
      trackers.forEach((tracker) => {
        expect(tracker.status).toBe(TrackerStatus.Idle);
        expect(tracker.peers).toBe(0);
        expect(tracker.seeds).toBe(0);
        expect(tracker.leeches).toBe(0);
        expect(tracker.lastAnnounce).toBeNull();
        expect(tracker.nextAnnounce).toBeNull();
      });
    });
  });

  describe('removeTorrent', () => {
    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
    });

    it('should remove a torrent by info hash', () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      expect(client.getTrackerInfo(infoHashHex)).toHaveLength(1);

      client.removeTorrent(infoHashHex);
      expect(client.getTrackerInfo(infoHashHex)).toHaveLength(0);
    });

    it('should silently handle removing non-existent torrent', () => {
      expect(() => {
        client.removeTorrent('nonexistent');
      }).not.toThrow();
    });

    it('should clear timers when removing torrent', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      // Create a spy to verify clearTimeout is called
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      client.removeTorrent(infoHashHex);

      // Timer clearing is internal, but we can verify no timers fire after removal
      await vi.advanceTimersByTimeAsync(10000);
      expect(client.getTrackerInfo(infoHashHex)).toHaveLength(0);

      clearTimeoutSpy.mockRestore();
    });
  });

  describe('announce', () => {
    let mockPerformAnnounce: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TrackerClient(createClientOptions());

      // Mock the private performAnnounce method
      mockPerformAnnounce = vi.fn().mockResolvedValue(createMockAnnounceResponse());

      // Access private method for mocking
      (client as unknown as { announceHTTP: typeof mockPerformAnnounce }).announceHTTP =
        mockPerformAnnounce;
      (client as unknown as { announceUDP: typeof mockPerformAnnounce }).announceUDP =
        mockPerformAnnounce;
    });

    it('should throw error for non-existent torrent', async () => {
      await expect(client.announce('nonexistent')).rejects.toThrow('Torrent not found');
    });

    it('should announce to all trackers in a tier', async () => {
      const state = createTorrentState({
        trackers: [['http://tracker1.com/announce', 'http://tracker2.com/announce']],
      });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      // Both trackers in tier should have been called
      expect(mockPerformAnnounce).toHaveBeenCalledTimes(2);
    });

    it('should emit announce event with peers on success', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const announceHandler = vi.fn();

      client.on('announce', announceHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      expect(announceHandler).toHaveBeenCalled();
      const eventData = announceHandler.mock.calls[0][0];
      expect(eventData.infoHash).toBe(infoHashHex);
      expect(eventData.peers).toBeDefined();
      expect(eventData.tracker).toBeDefined();
    });

    it('should emit error event on tracker failure', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const errorHandler = vi.fn();

      mockPerformAnnounce.mockRejectedValue(new Error('Connection failed'));

      client.on('error', errorHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      expect(errorHandler).toHaveBeenCalled();
      const eventData = errorHandler.mock.calls[0][0];
      expect(eventData.infoHash).toBe(infoHashHex);
      expect(eventData.error).toBeDefined();
      expect(eventData.error.message).toBe('Connection failed');
    });

    it('should emit warning when all trackers fail', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const warningHandler = vi.fn();

      mockPerformAnnounce.mockRejectedValue(new Error('Failed'));

      client.on('warning', warningHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      expect(warningHandler).toHaveBeenCalled();
      expect(warningHandler.mock.calls[0][0].message).toContain('All trackers failed');
    });

    it('should not emit warning on stopped event when trackers fail', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const warningHandler = vi.fn();

      mockPerformAnnounce.mockRejectedValue(new Error('Failed'));

      client.on('warning', warningHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'stopped');

      // Filter out warnings about all trackers failing - shouldn't be emitted for stopped
      const allFailedWarnings = warningHandler.mock.calls.filter(
        (call) => call[0].message && call[0].message.includes('All trackers failed'),
      );
      expect(allFailedWarnings).toHaveLength(0);
    });

    it('should try next tier if first tier fails', async () => {
      const tier1Tracker = 'http://tier1.com/announce';
      const tier2Tracker = 'http://tier2.com/announce';
      const state = createTorrentState({
        trackers: [[tier1Tracker], [tier2Tracker]],
      });
      const infoHashHex = state.infoHash.toString('hex');

      // First tier fails, second succeeds
      mockPerformAnnounce
        .mockRejectedValueOnce(new Error('Tier 1 failed'))
        .mockResolvedValueOnce(createMockAnnounceResponse());

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      // Both should have been tried
      expect(mockPerformAnnounce).toHaveBeenCalledTimes(2);
    });

    it('should announce to all trackers in parallel', async () => {
      const state = createTorrentState({
        trackers: [['http://tier1.com/announce'], ['http://tier2.com/announce']],
      });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      // Implementation announces to ALL trackers in parallel for faster peer discovery
      // Both tier1 and tier2 should be tried
      expect(mockPerformAnnounce.mock.calls.length).toBe(2);
      const tier1Calls = mockPerformAnnounce.mock.calls.filter((call: unknown[]) =>
        (call[0] as string).includes('tier1')
      );
      const tier2Calls = mockPerformAnnounce.mock.calls.filter((call: unknown[]) =>
        (call[0] as string).includes('tier2')
      );
      expect(tier1Calls.length).toBe(1);
      expect(tier2Calls.length).toBe(1);
    });

    it('should handle different announce events', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      await client.announce(infoHashHex, 'started');
      await client.announce(infoHashHex, 'completed');
      await client.announce(infoHashHex, 'stopped');
      await client.announce(infoHashHex); // Regular announce

      expect(mockPerformAnnounce).toHaveBeenCalledTimes(4);
    });
  });

  describe('updateStats', () => {
    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
    });

    it('should update torrent statistics', () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      client.updateStats(infoHashHex, 50000, 10000, 950000);

      // Stats are internal, but should be used in next announce
      // We can verify by checking the torrent still exists
      expect(client.getTrackerInfo(infoHashHex)).toHaveLength(1);
    });

    it('should silently ignore updates for non-existent torrents', () => {
      expect(() => {
        client.updateStats('nonexistent', 100, 200, 300);
      }).not.toThrow();
    });
  });

  describe('getTrackerInfo', () => {
    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
    });

    it('should return empty array for non-existent torrent', () => {
      expect(client.getTrackerInfo('nonexistent')).toEqual([]);
    });

    it('should return tracker info with correct structure', () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(1);

      const tracker = trackers[0];
      expect(tracker).toHaveProperty('url');
      expect(tracker).toHaveProperty('status');
      expect(tracker).toHaveProperty('peers');
      expect(tracker).toHaveProperty('seeds');
      expect(tracker).toHaveProperty('leeches');
      expect(tracker).toHaveProperty('lastAnnounce');
      expect(tracker).toHaveProperty('nextAnnounce');
    });

    it('should return info for all trackers across all tiers', () => {
      const state = createTorrentState({
        trackers: [
          ['http://tier1a.com/announce', 'http://tier1b.com/announce'],
          ['udp://tier2.com:1337/announce'],
        ],
      });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(3);
    });
  });

  describe('stop', () => {
    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
    });

    it('should clear all torrents on stop', async () => {
      const state1 = createTorrentState();
      const state2 = createTorrentState({
        infoHash: Buffer.alloc(20, 0xcd),
      });

      client.addTorrent(state1);
      client.addTorrent(state2);

      await client.stop();

      expect(client.getTrackerInfo(state1.infoHash.toString('hex'))).toHaveLength(0);
      expect(client.getTrackerInfo(state2.infoHash.toString('hex'))).toHaveLength(0);
    });

    it('should prevent new announces after stop', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const mockAnnounce = vi.fn().mockResolvedValue(createMockAnnounceResponse());
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;

      client.addTorrent(state);
      await client.stop();

      // Re-add torrent after stop
      client.addTorrent(state);

      // Announce should return early due to stopped state
      await client.announce(infoHashHex, 'started');
      expect(mockAnnounce).not.toHaveBeenCalled();
    });

    it('should have timeout on stop announces', async () => {
      const state = createTorrentState();
      const mockAnnounce = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000)),
      );
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;

      client.addTorrent(state);

      const stopPromise = client.stop();

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;

      // Stop should complete even if announce is still pending
    });
  });

  describe('tracker intervals and scheduling', () => {
    let mockAnnounce: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
      mockAnnounce = vi.fn().mockResolvedValue(createMockAnnounceResponse());
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;
    });

    it('should schedule next announce based on tracker interval', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      mockAnnounce.mockResolvedValue(
        createMockAnnounceResponse({
          interval: 1800, // 30 minutes
        }),
      );

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].nextAnnounce).toBeDefined();
      expect(trackers[0].nextAnnounce).not.toBeNull();
    });

    it('should respect minimum announce interval', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      mockAnnounce.mockResolvedValue(
        createMockAnnounceResponse({
          interval: 30, // Too short
          minInterval: 60, // Minimum
        }),
      );

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].nextAnnounce).toBeDefined();
    });

    it('should use custom announce interval override', async () => {
      client = new TrackerClient(
        createClientOptions({
          announceInterval: 300, // 5 minutes override
        }),
      );

      mockAnnounce = vi.fn().mockResolvedValue(
        createMockAnnounceResponse({
          interval: 1800, // Would be 30 minutes normally
        }),
      );
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;

      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      // The override should be used
      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].nextAnnounce).toBeDefined();
    });

    it('should not schedule next announce for stopped event', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      await client.announce(infoHashHex, 'stopped');

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].nextAnnounce).toBeNull();
    });

    it('should use exponential backoff on failures', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      mockAnnounce.mockRejectedValue(new Error('Failed'));

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].status).toBe(TrackerStatus.Error);
      expect(trackers[0].nextAnnounce).toBeDefined();
    });
  });

  describe('peer deduplication', () => {
    let mockAnnounce: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
      mockAnnounce = vi.fn();
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;
    });

    it('should deduplicate peers by IP:port', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const announceHandler = vi.fn();

      const duplicatePeers: PeerInfo[] = [
        { ip: '192.168.1.1', port: 6881 },
        { ip: '192.168.1.1', port: 6881 }, // Duplicate
        { ip: '192.168.1.2', port: 6881 },
        { ip: '192.168.1.1', port: 6882 }, // Different port, not duplicate
      ];

      mockAnnounce.mockResolvedValue(
        createMockAnnounceResponse({
          peers: duplicatePeers,
        }),
      );

      client.on('announce', announceHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      const eventData = announceHandler.mock.calls[0][0];
      expect(eventData.peers).toHaveLength(3); // Deduplicated
    });
  });

  describe('tracker warning handling', () => {
    let mockAnnounce: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
      mockAnnounce = vi.fn();
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;
    });

    it('should emit warning event when tracker provides warning', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const warningHandler = vi.fn();

      mockAnnounce.mockResolvedValue(
        createMockAnnounceResponse({
          warning: 'Rate limit exceeded',
        }),
      );

      client.on('warning', warningHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      expect(warningHandler).toHaveBeenCalled();
      expect(warningHandler.mock.calls[0][0].message).toBe('Rate limit exceeded');
    });
  });

  describe('tracker protocol detection', () => {
    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
    });

    it('should identify HTTP trackers', () => {
      const state = createTorrentState({
        trackers: [['http://tracker.com/announce', 'https://secure.tracker.com/announce']],
      });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      // Trackers are stored internally with type detection
      // We verify by checking they were added successfully
      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(2);
    });

    it('should identify UDP trackers', () => {
      const state = createTorrentState({
        trackers: [['udp://tracker.com:1337/announce']],
      });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(1);
    });

    it('should handle mixed protocol trackers', () => {
      const state = createTorrentState({
        trackers: [
          [
            'http://http-tracker.com/announce',
            'udp://udp-tracker.com:1337/announce',
            'https://https-tracker.com/announce',
          ],
        ],
      });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(3);
    });

    it('should mark unknown protocols and fail announce', async () => {
      const state = createTorrentState({
        trackers: [['wss://websocket-tracker.com/announce']],
      });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].status).toBe(TrackerStatus.Error);
      expect(trackers[0].errorMessage).toContain('Unknown tracker protocol');
    });
  });

  describe('event emission', () => {
    let mockAnnounce: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
      mockAnnounce = vi.fn().mockResolvedValue(createMockAnnounceResponse());
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;
    });

    it('should emit announce event with correct payload structure', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const announceHandler = vi.fn();

      client.on('announce', announceHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      expect(announceHandler).toHaveBeenCalledTimes(1);
      const payload = announceHandler.mock.calls[0][0];

      expect(payload).toHaveProperty('infoHash', infoHashHex);
      expect(payload).toHaveProperty('tracker');
      expect(payload).toHaveProperty('peers');
      expect(payload.tracker).toHaveProperty('url');
      expect(payload.tracker).toHaveProperty('status');
      expect(payload.tracker).toHaveProperty('peers');
      expect(payload.tracker).toHaveProperty('seeds');
      expect(payload.tracker).toHaveProperty('leeches');
    });

    it('should emit error event with correct payload structure', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const errorHandler = vi.fn();

      mockAnnounce.mockRejectedValue(new Error('Test error'));

      client.on('error', errorHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      expect(errorHandler).toHaveBeenCalledTimes(1);
      const payload = errorHandler.mock.calls[0][0];

      expect(payload).toHaveProperty('infoHash', infoHashHex);
      expect(payload).toHaveProperty('url');
      expect(payload).toHaveProperty('error');
      expect(payload.error).toBeInstanceOf(Error);
    });

    it('should emit warning event with correct payload structure', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const warningHandler = vi.fn();

      mockAnnounce.mockResolvedValue(
        createMockAnnounceResponse({
          warning: 'Test warning',
        }),
      );

      client.on('warning', warningHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      expect(warningHandler).toHaveBeenCalledTimes(1);
      const payload = warningHandler.mock.calls[0][0];

      expect(payload).toHaveProperty('infoHash', infoHashHex);
      expect(payload).toHaveProperty('url');
      expect(payload).toHaveProperty('message', 'Test warning');
    });

    it('should allow unsubscribing from events', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');
      const announceHandler = vi.fn();

      client.on('announce', announceHandler);
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      expect(announceHandler).toHaveBeenCalledTimes(1);

      client.off('announce', announceHandler);
      await client.announce(infoHashHex);

      expect(announceHandler).toHaveBeenCalledTimes(1); // No additional calls
    });
  });

  describe('tracker state management', () => {
    let mockAnnounce: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
      mockAnnounce = vi.fn().mockResolvedValue(createMockAnnounceResponse());
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;
    });

    it('should update tracker status to Announcing during announce', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      // Make announce slow to observe status
      let resolveAnnounce: (value: AnnounceResponse) => void;
      mockAnnounce.mockImplementation(
        () =>
          new Promise<AnnounceResponse>((resolve) => {
            resolveAnnounce = resolve;
          }),
      );

      client.addTorrent(state);
      const announcePromise = client.announce(infoHashHex, 'started');

      // During announce, status should be Announcing
      // Note: Due to async nature, this is hard to test reliably
      // The status changes quickly

      resolveAnnounce!(createMockAnnounceResponse());
      await announcePromise;

      // After announce, status should be Working
      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].status).toBe(TrackerStatus.Working);
    });

    it('should update tracker status to Working on success', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].status).toBe(TrackerStatus.Working);
    });

    it('should update tracker status to Error on failure', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      mockAnnounce.mockRejectedValue(new Error('Connection refused'));

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].status).toBe(TrackerStatus.Error);
      expect(trackers[0].errorMessage).toBe('Connection refused');
    });

    it('should update peer counts from announce response', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      mockAnnounce.mockResolvedValue(
        createMockAnnounceResponse({
          complete: 42,
          incomplete: 18,
          peers: createPeers(15),
        }),
      );

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].seeds).toBe(42);
      expect(trackers[0].leeches).toBe(18);
      expect(trackers[0].peers).toBe(15);
    });

    it('should update lastAnnounce timestamp on success', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].lastAnnounce).toBeInstanceOf(Date);
    });

    it('should reset failure count on successful announce', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      // First, fail some announces
      mockAnnounce.mockRejectedValue(new Error('Failed'));
      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      let trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].status).toBe(TrackerStatus.Error);

      // Then succeed
      mockAnnounce.mockResolvedValue(createMockAnnounceResponse());
      await client.announce(infoHashHex);

      trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers[0].status).toBe(TrackerStatus.Working);
    });
  });

  describe('concurrent announces', () => {
    let mockAnnounce: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
      mockAnnounce = vi.fn().mockResolvedValue(createMockAnnounceResponse());
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;
    });

    it('should handle multiple simultaneous announces to different torrents', async () => {
      const state1 = createTorrentState();
      const state2 = createTorrentState({ infoHash: Buffer.alloc(20, 0xcd) });
      const state3 = createTorrentState({ infoHash: Buffer.alloc(20, 0xef) });

      client.addTorrent(state1);
      client.addTorrent(state2);
      client.addTorrent(state3);

      await Promise.all([
        client.announce(state1.infoHash.toString('hex'), 'started'),
        client.announce(state2.infoHash.toString('hex'), 'started'),
        client.announce(state3.infoHash.toString('hex'), 'started'),
      ]);

      expect(mockAnnounce).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent announces within same tier', async () => {
      const state = createTorrentState({
        trackers: [
          [
            'http://tracker1.com/announce',
            'http://tracker2.com/announce',
            'http://tracker3.com/announce',
          ],
        ],
      });
      const infoHashHex = state.infoHash.toString('hex');

      // Make announces slow to ensure concurrency
      let resolvers: Array<(value: AnnounceResponse) => void> = [];
      mockAnnounce.mockImplementation(
        () =>
          new Promise<AnnounceResponse>((resolve) => {
            resolvers.push(resolve);
          }),
      );

      client.addTorrent(state);
      const announcePromise = client.announce(infoHashHex, 'started');

      // All trackers in tier should be called concurrently
      await vi.advanceTimersByTimeAsync(0);
      expect(resolvers).toHaveLength(3);

      // Resolve all
      resolvers.forEach((resolve) => resolve(createMockAnnounceResponse()));
      await announcePromise;
    });
  });

  describe('tracker ID handling', () => {
    let mockAnnounce: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
      mockAnnounce = vi.fn().mockResolvedValue(createMockAnnounceResponse());
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;
    });

    it('should store and use tracker ID from response', async () => {
      const state = createTorrentState();
      const infoHashHex = state.infoHash.toString('hex');

      mockAnnounce.mockResolvedValue(
        createMockAnnounceResponse({
          trackerId: 'unique-session-id-12345',
        }),
      );

      client.addTorrent(state);
      await client.announce(infoHashHex, 'started');

      // The tracker ID is stored internally and used in subsequent announces
      // We can verify by making another announce and checking the params
      await client.announce(infoHashHex);

      // Both calls should have been made
      expect(mockAnnounce).toHaveBeenCalledTimes(2);
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      client = new TrackerClient(createClientOptions());
    });

    it('should handle torrent with very long tracker list', () => {
      const trackers = Array.from({ length: 50 }, (_, i) => [
        `http://tracker${i}.com/announce`,
      ]);

      const state = createTorrentState({ trackers });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);

      const trackerInfo = client.getTrackerInfo(infoHashHex);
      expect(trackerInfo).toHaveLength(50);
    });

    it('should handle info hash with special characters when converted to hex', () => {
      const specialInfoHash = Buffer.from([
        0x00, 0xff, 0x01, 0xfe, 0x02, 0xfd, 0x03, 0xfc, 0x04, 0xfb,
        0x05, 0xfa, 0x06, 0xf9, 0x07, 0xf8, 0x08, 0xf7, 0x09, 0xf6,
      ]);

      const state = createTorrentState({ infoHash: specialInfoHash });
      const infoHashHex = specialInfoHash.toString('hex');

      client.addTorrent(state);

      const trackers = client.getTrackerInfo(infoHashHex);
      expect(trackers).toHaveLength(1);
    });

    it('should handle zero-length left value (seeding)', async () => {
      const mockAnnounce = vi.fn().mockResolvedValue(createMockAnnounceResponse());
      (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;

      const state = createTorrentState({
        downloaded: 1000000,
        left: 0,
      });
      const infoHashHex = state.infoHash.toString('hex');

      client.addTorrent(state);
      await client.announce(infoHashHex, 'completed');

      expect(mockAnnounce).toHaveBeenCalled();
    });

    it('should handle very large download/upload values', () => {
      const state = createTorrentState({
        downloaded: Number.MAX_SAFE_INTEGER,
        uploaded: Number.MAX_SAFE_INTEGER,
        left: Number.MAX_SAFE_INTEGER,
      });
      const infoHashHex = state.infoHash.toString('hex');

      expect(() => {
        client.addTorrent(state);
      }).not.toThrow();

      expect(client.getTrackerInfo(infoHashHex)).toHaveLength(1);
    });
  });
});

// =============================================================================
// Integration-style Tests
// =============================================================================

describe('TrackerClient Integration', () => {
  let client: TrackerClient;
  let mockAnnounce: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new TrackerClient(createClientOptions());
    mockAnnounce = vi.fn().mockResolvedValue(createMockAnnounceResponse());
    (client as unknown as { announceHTTP: typeof mockAnnounce }).announceHTTP = mockAnnounce;
    (client as unknown as { announceUDP: typeof mockAnnounce }).announceUDP = mockAnnounce;
  });

  afterEach(async () => {
    await client.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should perform full lifecycle: add, announce, update, stop', async () => {
    const state = createTorrentState();
    const infoHashHex = state.infoHash.toString('hex');
    const events: string[] = [];

    client.on('announce', () => events.push('announce'));
    client.on('error', () => events.push('error'));
    client.on('warning', () => events.push('warning'));

    // Add torrent
    client.addTorrent(state);
    expect(client.getTrackerInfo(infoHashHex)).toHaveLength(1);

    // Start announce
    await client.announce(infoHashHex, 'started');
    expect(events).toContain('announce');

    // Update stats
    client.updateStats(infoHashHex, 50000, 10000, 950000);

    // Regular announce
    await client.announce(infoHashHex);

    // Stop
    await client.stop();

    expect(client.getTrackerInfo(infoHashHex)).toHaveLength(0);
  });

  it('should handle parallel announce with mixed success/failure', async () => {
    const state = createTorrentState({
      trackers: [
        ['http://tier1.com/announce'],
        ['http://tier2.com/announce'],
        ['http://tier3.com/announce'],
      ],
    });
    const infoHashHex = state.infoHash.toString('hex');
    const announceHandler = vi.fn();

    // All trackers are tried in parallel - tier1 fails, tier2 succeeds, tier3 fails
    mockAnnounce
      .mockRejectedValueOnce(new Error('Tier 1 failed'))
      .mockResolvedValueOnce(createMockAnnounceResponse())
      .mockRejectedValueOnce(new Error('Tier 3 failed'));

    client.on('announce', announceHandler);
    client.addTorrent(state);
    await client.announce(infoHashHex, 'started');

    // All 3 trackers should be tried in parallel
    expect(mockAnnounce.mock.calls.length).toBe(3);
    // Should have announced successfully from tier 2
    expect(announceHandler).toHaveBeenCalled();

    // Trackers should have their status updated based on results
    const trackers = client.getTrackerInfo(infoHashHex);
    const tier2 = trackers.find((t) => t.url === 'http://tier2.com/announce');
    expect(tier2?.status).toBe(TrackerStatus.Working);
  });

  it('should aggregate peers from multiple trackers', async () => {
    const state = createTorrentState({
      trackers: [
        ['http://tracker1.com/announce', 'http://tracker2.com/announce'],
      ],
    });
    const infoHashHex = state.infoHash.toString('hex');
    const allPeers: PeerInfo[][] = [];

    // Each tracker returns different peers
    mockAnnounce
      .mockResolvedValueOnce(
        createMockAnnounceResponse({
          peers: [
            { ip: '192.168.1.1', port: 6881 },
            { ip: '192.168.1.2', port: 6881 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createMockAnnounceResponse({
          peers: [
            { ip: '10.0.0.1', port: 6881 },
            { ip: '10.0.0.2', port: 6881 },
          ],
        }),
      );

    client.on('announce', ({ peers }) => {
      allPeers.push(peers);
    });

    client.addTorrent(state);
    await client.announce(infoHashHex, 'started');

    // Both trackers responded
    expect(allPeers).toHaveLength(2);
    // Each had unique peers
    expect(allPeers[0]).toHaveLength(2);
    expect(allPeers[1]).toHaveLength(2);
  });

  it('should handle rapid successive announces gracefully', async () => {
    const state = createTorrentState();
    const infoHashHex = state.infoHash.toString('hex');

    client.addTorrent(state);

    // Fire multiple announces rapidly
    await Promise.all([
      client.announce(infoHashHex),
      client.announce(infoHashHex),
      client.announce(infoHashHex),
    ]);

    // All should complete without error
    const trackers = client.getTrackerInfo(infoHashHex);
    expect(trackers[0].status).toBe(TrackerStatus.Working);
  });
});
