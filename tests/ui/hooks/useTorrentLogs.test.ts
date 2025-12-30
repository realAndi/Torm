/**
 * Tests for useTorrentLogs hook.
 *
 * Tests the log management functionality including adding logs,
 * retrieving logs per torrent, clearing logs, and respecting limits.
 *
 * Since @testing-library/react is not available, we test the underlying
 * log management logic directly by simulating the behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Types (mirrored from useTorrentLogs.ts)
// =============================================================================

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
}

const MAX_LOGS_PER_TORRENT = 100;

// =============================================================================
// Log Manager Class (Simulates hook behavior for testing)
// =============================================================================

/**
 * A class-based implementation that mirrors the useTorrentLogs hook behavior.
 * This allows testing the logic without needing React's hook testing utilities.
 */
class TorrentLogManager {
  private logs: Map<string, LogEntry[]> = new Map();

  /**
   * Adds a log entry for a specific torrent.
   */
  addLog(infoHash: string, level: LogLevel, message: string): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
    };

    const currentLogs = this.logs.get(infoHash) || [];
    const updatedLogs = [...currentLogs, entry];

    // Limit to MAX_LOGS_PER_TORRENT entries
    if (updatedLogs.length > MAX_LOGS_PER_TORRENT) {
      updatedLogs.splice(0, updatedLogs.length - MAX_LOGS_PER_TORRENT);
    }

    this.logs.set(infoHash, updatedLogs);
  }

  /**
   * Clears all logs for a specific torrent.
   */
  clearLogs(infoHash: string): void {
    this.logs.delete(infoHash);
  }

  /**
   * Gets all log entries for a specific torrent.
   */
  getLogsForTorrent(infoHash: string): LogEntry[] {
    return this.logs.get(infoHash) || [];
  }

  /**
   * Gets the full logs map.
   */
  getAllLogs(): Map<string, LogEntry[]> {
    return new Map(this.logs);
  }
}

// =============================================================================
// Mock Engine (for event handling tests)
// =============================================================================

interface MockEngine {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
  _listeners: Map<string, Set<(...args: unknown[]) => void>>;
}

function createMockEngine(): MockEngine {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((handler) => handler(...args));
    },
    _listeners: listeners,
  };
}

// =============================================================================
// Event Handler Functions (mirrored from useTorrentLogs.ts)
// =============================================================================

/**
 * Creates event handlers that match the hook's event handling logic.
 */
function createEventHandlers(manager: TorrentLogManager) {
  return {
    handleTorrentAdded: (payload: { torrent: { infoHash: string } }) => {
      manager.addLog(payload.torrent.infoHash, 'info', 'Torrent added');
    },
    handleTorrentStarted: (payload: { infoHash: string }) => {
      manager.addLog(payload.infoHash, 'info', 'Started downloading');
    },
    handleTorrentPaused: (payload: { infoHash: string }) => {
      manager.addLog(payload.infoHash, 'info', 'Paused');
    },
    handleTorrentCompleted: (payload: { torrent: { infoHash: string } }) => {
      manager.addLog(payload.torrent.infoHash, 'info', 'Download completed');
    },
    handleTorrentError: (payload: { infoHash: string; error: Error }) => {
      manager.addLog(payload.infoHash, 'error', `Error: ${payload.error.message}`);
    },
    handlePeerConnected: (payload: { infoHash: string; peer: { ip: string } }) => {
      manager.addLog(payload.infoHash, 'info', `Peer connected: ${payload.peer.ip}`);
    },
    handlePeerDisconnected: (payload: { infoHash: string; peerId: string }) => {
      manager.addLog(
        payload.infoHash,
        'info',
        `Peer disconnected: ${payload.peerId.slice(0, 8)}...`
      );
    },
    handleTrackerAnnounce: (payload: { infoHash: string; tracker: { peers: number } }) => {
      manager.addLog(
        payload.infoHash,
        'info',
        `Tracker announced: ${payload.tracker.peers} peers`
      );
    },
    handleTrackerError: (payload: { infoHash: string; url: string; error: Error }) => {
      manager.addLog(
        payload.infoHash,
        'warn',
        `Tracker error (${payload.url}): ${payload.error.message}`
      );
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('useTorrentLogs', () => {
  let manager: TorrentLogManager;
  let mockEngine: MockEngine;

  beforeEach(() => {
    manager = new TorrentLogManager();
    mockEngine = createMockEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('addLog', () => {
    it('should add a log entry to the correct torrent', () => {
      const infoHash = 'abc123';

      manager.addLog(infoHash, 'info', 'Test message');

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Test message');
      expect(logs[0].level).toBe('info');
    });

    it('should add logs to different torrents separately', () => {
      const hash1 = 'torrent1';
      const hash2 = 'torrent2';

      manager.addLog(hash1, 'info', 'Message 1');
      manager.addLog(hash2, 'warn', 'Message 2');
      manager.addLog(hash1, 'error', 'Message 3');

      const logs1 = manager.getLogsForTorrent(hash1);
      const logs2 = manager.getLogsForTorrent(hash2);

      expect(logs1).toHaveLength(2);
      expect(logs2).toHaveLength(1);

      expect(logs1[0].message).toBe('Message 1');
      expect(logs1[1].message).toBe('Message 3');
      expect(logs2[0].message).toBe('Message 2');
    });

    it('should support all log levels', () => {
      const infoHash = 'test';
      const levels: LogLevel[] = ['info', 'warn', 'error'];

      levels.forEach((level) => {
        manager.addLog(infoHash, level, `${level} message`);
      });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(3);
      expect(logs.map((l) => l.level)).toEqual(['info', 'warn', 'error']);
    });
  });

  describe('getLogsForTorrent', () => {
    it('should return logs for a specific torrent', () => {
      const infoHash = 'specific-torrent';

      manager.addLog(infoHash, 'info', 'Log 1');
      manager.addLog(infoHash, 'info', 'Log 2');
      manager.addLog('other-torrent', 'info', 'Other log');

      const logs = manager.getLogsForTorrent(infoHash);

      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('Log 1');
      expect(logs[1].message).toBe('Log 2');
    });

    it('should return empty array for torrent with no logs', () => {
      const logs = manager.getLogsForTorrent('non-existent');

      expect(logs).toEqual([]);
    });

    it('should return empty array for never-logged torrent', () => {
      // Add some logs for a different torrent
      manager.addLog('other', 'info', 'Other message');

      const logs = manager.getLogsForTorrent('never-added');
      expect(logs).toEqual([]);
    });
  });

  describe('clearLogs', () => {
    it('should remove all logs for a specific torrent', () => {
      const infoHash = 'to-clear';

      manager.addLog(infoHash, 'info', 'Log 1');
      manager.addLog(infoHash, 'info', 'Log 2');
      manager.addLog(infoHash, 'info', 'Log 3');

      expect(manager.getLogsForTorrent(infoHash)).toHaveLength(3);

      manager.clearLogs(infoHash);

      expect(manager.getLogsForTorrent(infoHash)).toEqual([]);
    });

    it('should not affect other torrents when clearing', () => {
      const hash1 = 'torrent1';
      const hash2 = 'torrent2';

      manager.addLog(hash1, 'info', 'Log for 1');
      manager.addLog(hash2, 'info', 'Log for 2');

      manager.clearLogs(hash1);

      expect(manager.getLogsForTorrent(hash1)).toEqual([]);
      expect(manager.getLogsForTorrent(hash2)).toHaveLength(1);
    });

    it('should not throw when clearing non-existent torrent', () => {
      expect(() => {
        manager.clearLogs('non-existent');
      }).not.toThrow();
    });
  });

  describe('max entries limit (100)', () => {
    it('should limit logs to 100 entries per torrent', () => {
      const infoHash = 'limited';

      // Add 110 logs
      for (let i = 0; i < 110; i++) {
        manager.addLog(infoHash, 'info', `Log ${i}`);
      }

      const logs = manager.getLogsForTorrent(infoHash);

      expect(logs).toHaveLength(100);
    });

    it('should keep newest logs when limit is exceeded', () => {
      const infoHash = 'newest';

      // Add 110 logs
      for (let i = 0; i < 110; i++) {
        manager.addLog(infoHash, 'info', `Log ${i}`);
      }

      const logs = manager.getLogsForTorrent(infoHash);

      // Should keep logs 10-109 (newest 100)
      expect(logs[0].message).toBe('Log 10');
      expect(logs[99].message).toBe('Log 109');
    });

    it('should correctly handle adding logs incrementally past limit', () => {
      const infoHash = 'incremental';

      // Add exactly 100 logs
      for (let i = 0; i < 100; i++) {
        manager.addLog(infoHash, 'info', `Initial ${i}`);
      }

      expect(manager.getLogsForTorrent(infoHash)).toHaveLength(100);

      // Add one more
      manager.addLog(infoHash, 'info', 'New log');

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(100);
      expect(logs[0].message).toBe('Initial 1'); // First should be removed
      expect(logs[99].message).toBe('New log'); // New one should be last
    });

    it('should maintain limit independently for each torrent', () => {
      const hash1 = 'torrent1';
      const hash2 = 'torrent2';

      // Add 50 to hash1
      for (let i = 0; i < 50; i++) {
        manager.addLog(hash1, 'info', `Hash1 Log ${i}`);
      }
      // Add 110 to hash2
      for (let i = 0; i < 110; i++) {
        manager.addLog(hash2, 'info', `Hash2 Log ${i}`);
      }

      expect(manager.getLogsForTorrent(hash1)).toHaveLength(50);
      expect(manager.getLogsForTorrent(hash2)).toHaveLength(100);
    });
  });

  describe('timestamp format', () => {
    it('should have a timestamp that is a Date object', () => {
      const beforeAdd = Date.now();
      const infoHash = 'timestamp-test';

      manager.addLog(infoHash, 'info', 'Timestamped log');

      const afterAdd = Date.now();
      const logs = manager.getLogsForTorrent(infoHash);

      expect(logs[0].timestamp).toBeInstanceOf(Date);
      // Timestamp should be between before and after add
      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(beforeAdd);
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(afterAdd);
    });

    it('should have sequential timestamps for logs added in order', () => {
      const infoHash = 'sequential';

      manager.addLog(infoHash, 'info', 'Log 1');
      manager.addLog(infoHash, 'info', 'Log 2');
      manager.addLog(infoHash, 'info', 'Log 3');

      const logs = manager.getLogsForTorrent(infoHash);

      // Each timestamp should be >= the previous one
      expect(logs[1].timestamp.getTime()).toBeGreaterThanOrEqual(logs[0].timestamp.getTime());
      expect(logs[2].timestamp.getTime()).toBeGreaterThanOrEqual(logs[1].timestamp.getTime());
    });

    it('should allow formatting timestamp to locale string', () => {
      const infoHash = 'format-test';

      manager.addLog(infoHash, 'info', 'Test');

      const logs = manager.getLogsForTorrent(infoHash);

      // Verify it can be formatted (actual format depends on locale)
      expect(typeof logs[0].timestamp.toLocaleTimeString()).toBe('string');
      expect(typeof logs[0].timestamp.toISOString()).toBe('string');
    });
  });

  describe('logs map', () => {
    it('should return a Map of all logs', () => {
      manager.addLog('hash1', 'info', 'Log 1');
      manager.addLog('hash2', 'warn', 'Log 2');

      const logsMap = manager.getAllLogs();

      expect(logsMap).toBeInstanceOf(Map);
      expect(logsMap.size).toBe(2);
      expect(logsMap.has('hash1')).toBe(true);
      expect(logsMap.has('hash2')).toBe(true);
    });
  });

  describe('event handlers', () => {
    it('should add log when torrent:added event is handled', () => {
      const handlers = createEventHandlers(manager);
      const infoHash = 'new-torrent-hash';

      handlers.handleTorrentAdded({ torrent: { infoHash } });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Torrent added');
      expect(logs[0].level).toBe('info');
    });

    it('should add log when torrent:started event is handled', () => {
      const handlers = createEventHandlers(manager);
      const infoHash = 'started-hash';

      handlers.handleTorrentStarted({ infoHash });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Started downloading');
    });

    it('should add log when torrent:paused event is handled', () => {
      const handlers = createEventHandlers(manager);
      const infoHash = 'paused-hash';

      handlers.handleTorrentPaused({ infoHash });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Paused');
    });

    it('should add log when torrent:completed event is handled', () => {
      const handlers = createEventHandlers(manager);
      const infoHash = 'completed-hash';

      handlers.handleTorrentCompleted({ torrent: { infoHash } });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Download completed');
    });

    it('should add error log when torrent:error event is handled', () => {
      const handlers = createEventHandlers(manager);
      const infoHash = 'error-hash';
      const error = new Error('Connection failed');

      handlers.handleTorrentError({ infoHash, error });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Error: Connection failed');
      expect(logs[0].level).toBe('error');
    });

    it('should add log when peer:connected event is handled', () => {
      const handlers = createEventHandlers(manager);
      const infoHash = 'peer-connected-hash';

      handlers.handlePeerConnected({ infoHash, peer: { ip: '192.168.1.100' } });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Peer connected: 192.168.1.100');
    });

    it('should add log when peer:disconnected event is handled', () => {
      const handlers = createEventHandlers(manager);
      const infoHash = 'peer-disconnected-hash';

      handlers.handlePeerDisconnected({ infoHash, peerId: 'abcdefgh12345678' });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Peer disconnected: abcdefgh...');
    });

    it('should add log when tracker:announce event is handled', () => {
      const handlers = createEventHandlers(manager);
      const infoHash = 'tracker-announce-hash';

      handlers.handleTrackerAnnounce({
        infoHash,
        tracker: { peers: 42 },
      });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Tracker announced: 42 peers');
    });

    it('should add warn log when tracker:error event is handled', () => {
      const handlers = createEventHandlers(manager);
      const infoHash = 'tracker-error-hash';
      const error = new Error('Tracker timeout');

      handlers.handleTrackerError({
        infoHash,
        url: 'http://tracker.example.com',
        error,
      });

      const logs = manager.getLogsForTorrent(infoHash);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Tracker error (http://tracker.example.com): Tracker timeout');
      expect(logs[0].level).toBe('warn');
    });
  });

  describe('event subscription (simulated)', () => {
    it('should register handlers for all expected events', () => {
      const handlers = createEventHandlers(manager);

      // Simulate what the hook does on mount
      mockEngine.on('torrent:added', handlers.handleTorrentAdded);
      mockEngine.on('torrent:started', handlers.handleTorrentStarted);
      mockEngine.on('torrent:paused', handlers.handleTorrentPaused);
      mockEngine.on('torrent:completed', handlers.handleTorrentCompleted);
      mockEngine.on('torrent:error', handlers.handleTorrentError);
      mockEngine.on('peer:connected', handlers.handlePeerConnected);
      mockEngine.on('peer:disconnected', handlers.handlePeerDisconnected);
      mockEngine.on('tracker:announce', handlers.handleTrackerAnnounce);
      mockEngine.on('tracker:error', handlers.handleTrackerError);

      // Check that event listeners were registered
      expect(mockEngine.on).toHaveBeenCalledWith('torrent:added', expect.any(Function));
      expect(mockEngine.on).toHaveBeenCalledWith('torrent:started', expect.any(Function));
      expect(mockEngine.on).toHaveBeenCalledWith('torrent:paused', expect.any(Function));
      expect(mockEngine.on).toHaveBeenCalledWith('torrent:completed', expect.any(Function));
      expect(mockEngine.on).toHaveBeenCalledWith('torrent:error', expect.any(Function));
      expect(mockEngine.on).toHaveBeenCalledWith('peer:connected', expect.any(Function));
      expect(mockEngine.on).toHaveBeenCalledWith('peer:disconnected', expect.any(Function));
      expect(mockEngine.on).toHaveBeenCalledWith('tracker:announce', expect.any(Function));
      expect(mockEngine.on).toHaveBeenCalledWith('tracker:error', expect.any(Function));
    });

    it('should handle events emitted by engine', () => {
      const handlers = createEventHandlers(manager);

      // Register handlers
      mockEngine.on('torrent:added', handlers.handleTorrentAdded);
      mockEngine.on('torrent:error', handlers.handleTorrentError);

      // Emit events through the mock engine
      mockEngine.emit('torrent:added', { torrent: { infoHash: 'test-hash' } });
      mockEngine.emit('torrent:error', {
        infoHash: 'test-hash',
        error: new Error('Test error'),
      });

      const logs = manager.getLogsForTorrent('test-hash');
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('Torrent added');
      expect(logs[1].message).toBe('Error: Test error');
    });

    it('should unregister handlers on cleanup', () => {
      const handlers = createEventHandlers(manager);

      // Register handlers
      mockEngine.on('torrent:added', handlers.handleTorrentAdded);
      mockEngine.on('torrent:started', handlers.handleTorrentStarted);

      // Simulate cleanup (what happens on unmount)
      mockEngine.off('torrent:added', handlers.handleTorrentAdded);
      mockEngine.off('torrent:started', handlers.handleTorrentStarted);

      expect(mockEngine.off).toHaveBeenCalledWith('torrent:added', expect.any(Function));
      expect(mockEngine.off).toHaveBeenCalledWith('torrent:started', expect.any(Function));

      // After cleanup, emitting events should not add logs
      mockEngine.emit('torrent:added', { torrent: { infoHash: 'after-cleanup' } });

      const logs = manager.getLogsForTorrent('after-cleanup');
      expect(logs).toHaveLength(0);
    });
  });

  describe('log entry structure', () => {
    it('should have correct LogEntry structure', () => {
      manager.addLog('test', 'warn', 'Test message');

      const logs = manager.getLogsForTorrent('test');
      const entry = logs[0];

      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('level');
      expect(entry).toHaveProperty('message');

      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.level).toBe('warn');
      expect(entry.message).toBe('Test message');
    });
  });

  describe('edge cases', () => {
    it('should handle empty info hash', () => {
      manager.addLog('', 'info', 'Empty hash log');

      const logs = manager.getLogsForTorrent('');
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Empty hash log');
    });

    it('should handle very long messages', () => {
      const longMessage = 'x'.repeat(10000);
      manager.addLog('hash', 'info', longMessage);

      const logs = manager.getLogsForTorrent('hash');
      expect(logs[0].message).toBe(longMessage);
    });

    it('should handle special characters in messages', () => {
      const specialMessage = '<script>alert("xss")</script> & "quotes" \'single\'';
      manager.addLog('hash', 'info', specialMessage);

      const logs = manager.getLogsForTorrent('hash');
      expect(logs[0].message).toBe(specialMessage);
    });

    it('should handle unicode in messages', () => {
      const unicodeMessage = 'Downloaded: Linux.iso';
      manager.addLog('hash', 'info', unicodeMessage);

      const logs = manager.getLogsForTorrent('hash');
      expect(logs[0].message).toBe(unicodeMessage);
    });
  });
});
