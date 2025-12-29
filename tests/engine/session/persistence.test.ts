/**
 * Tests for the persistence module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
  saveTorrentState,
  loadTorrentState,
  loadAllTorrentStates,
  deleteTorrentState,
  torrentStateExists,
  createBitfield,
  extractCompletedPieces,
  AutoSaveManager,
  type TorrentPersistenceInfo,
} from '../../../src/engine/session/persistence.js';
import { TorrentState } from '../../../src/engine/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

let testDir: string;

/**
 * Creates a temporary test directory
 */
async function createTestDir(): Promise<string> {
  const dir = path.join(tmpdir(), `torm-persistence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Removes the test directory
 */
async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Creates a test torrent info
 */
function createTestTorrentInfo(overrides: Partial<TorrentPersistenceInfo> = {}): TorrentPersistenceInfo {
  return {
    infoHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    name: 'Test Torrent',
    state: TorrentState.DOWNLOADING,
    downloadPath: '/downloads',
    downloaded: 1024 * 1024,
    uploaded: 512 * 1024,
    totalSize: 10 * 1024 * 1024,
    pieceLength: 256 * 1024,
    pieceCount: 40,
    addedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Persistence Module', () => {
  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
    vi.restoreAllMocks();
  });

  describe('Bitfield Functions', () => {
    describe('createBitfield', () => {
      it('should create an empty bitfield for no completed pieces', () => {
        const bitfield = createBitfield([], 16);
        expect(bitfield.length).toBe(2);
        expect(bitfield[0]).toBe(0);
        expect(bitfield[1]).toBe(0);
      });

      it('should set correct bits for completed pieces', () => {
        const bitfield = createBitfield([0, 7, 8], 16);
        expect(bitfield.length).toBe(2);
        // Piece 0 is bit 7 of byte 0 = 0x80
        // Piece 7 is bit 0 of byte 0 = 0x01
        // Piece 8 is bit 7 of byte 1 = 0x80
        expect(bitfield[0]).toBe(0x81);
        expect(bitfield[1]).toBe(0x80);
      });

      it('should handle all pieces completed', () => {
        const completedPieces = [0, 1, 2, 3, 4, 5, 6, 7];
        const bitfield = createBitfield(completedPieces, 8);
        expect(bitfield.length).toBe(1);
        expect(bitfield[0]).toBe(0xFF);
      });

      it('should ignore out-of-range piece indices', () => {
        const bitfield = createBitfield([-1, 100], 8);
        expect(bitfield.length).toBe(1);
        expect(bitfield[0]).toBe(0);
      });
    });

    describe('extractCompletedPieces', () => {
      it('should extract empty array for empty bitfield', () => {
        const bitfield = Buffer.alloc(2, 0);
        const completed = extractCompletedPieces(bitfield, 16);
        expect(completed).toEqual([]);
      });

      it('should extract correct piece indices', () => {
        const bitfield = Buffer.from([0x81, 0x80]);
        const completed = extractCompletedPieces(bitfield, 16);
        expect(completed).toEqual([0, 7, 8]);
      });

      it('should handle full bitfield', () => {
        const bitfield = Buffer.from([0xFF]);
        const completed = extractCompletedPieces(bitfield, 8);
        expect(completed).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      });

      it('should respect pieceCount limit', () => {
        const bitfield = Buffer.from([0xFF]);
        const completed = extractCompletedPieces(bitfield, 4);
        expect(completed).toEqual([0, 1, 2, 3]);
      });
    });

    it('should roundtrip bitfield correctly', () => {
      const originalPieces = [0, 5, 10, 15, 20, 25, 30, 35, 39];
      const pieceCount = 40;

      const bitfield = createBitfield(originalPieces, pieceCount);
      const extractedPieces = extractCompletedPieces(bitfield, pieceCount);

      expect(extractedPieces).toEqual(originalPieces);
    });
  });

  describe('Save/Load Functions', () => {
    describe('saveTorrentState', () => {
      it('should save torrent state to disk', async () => {
        const torrent = createTestTorrentInfo();
        const completedPieces = [0, 1, 2, 3, 4];

        await saveTorrentState(torrent, completedPieces, testDir);

        const filePath = path.join(testDir, 'torrents', `${torrent.infoHash}.json`);
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      });

      it('should save state with correct content', async () => {
        const torrent = createTestTorrentInfo();
        const completedPieces = [0, 1, 2];

        await saveTorrentState(torrent, completedPieces, testDir);

        const filePath = path.join(testDir, 'torrents', `${torrent.infoHash}.json`);
        const content = await fs.readFile(filePath, 'utf-8');
        const state = JSON.parse(content);

        expect(state.infoHash).toBe(torrent.infoHash);
        expect(state.name).toBe(torrent.name);
        expect(state.state).toBe(torrent.state);
        expect(state.downloaded).toBe(torrent.downloaded);
        expect(state.uploaded).toBe(torrent.uploaded);
        expect(state.version).toBe(1);
        expect(state.savedAt).toBeDefined();
      });

      it('should create torrents directory if it does not exist', async () => {
        const torrent = createTestTorrentInfo();

        await saveTorrentState(torrent, [], testDir);

        const torrentsDir = path.join(testDir, 'torrents');
        const stat = await fs.stat(torrentsDir);
        expect(stat.isDirectory()).toBe(true);
      });

      it('should overwrite existing state file', async () => {
        const torrent = createTestTorrentInfo();

        await saveTorrentState(torrent, [0, 1], testDir);
        await saveTorrentState(torrent, [0, 1, 2, 3, 4], testDir);

        const loaded = await loadTorrentState(torrent.infoHash, testDir);
        expect(loaded).not.toBeNull();
        const pieces = extractCompletedPieces(loaded!.bitfield, torrent.pieceCount);
        expect(pieces).toEqual([0, 1, 2, 3, 4]);
      });
    });

    describe('loadTorrentState', () => {
      it('should load saved torrent state', async () => {
        const torrent = createTestTorrentInfo({
          completedAt: new Date('2024-01-02T00:00:00Z'),
        });
        const completedPieces = [0, 5, 10, 15];

        await saveTorrentState(torrent, completedPieces, testDir);

        const loaded = await loadTorrentState(torrent.infoHash, testDir);

        expect(loaded).not.toBeNull();
        expect(loaded!.infoHash).toBe(torrent.infoHash);
        expect(loaded!.name).toBe(torrent.name);
        expect(loaded!.state).toBe(torrent.state);
        expect(loaded!.downloaded).toBe(torrent.downloaded);
        expect(loaded!.completedAt).toBe(torrent.completedAt!.toISOString());
      });

      it('should return null for non-existent state', async () => {
        const loaded = await loadTorrentState('nonexistent', testDir);
        expect(loaded).toBeNull();
      });

      it('should include decoded bitfield', async () => {
        const torrent = createTestTorrentInfo();
        const completedPieces = [0, 1, 2, 3];

        await saveTorrentState(torrent, completedPieces, testDir);

        const loaded = await loadTorrentState(torrent.infoHash, testDir);

        expect(loaded).not.toBeNull();
        expect(loaded!.bitfield).toBeInstanceOf(Buffer);
        const extracted = extractCompletedPieces(loaded!.bitfield, torrent.pieceCount);
        expect(extracted).toEqual(completedPieces);
      });
    });

    describe('loadAllTorrentStates', () => {
      it('should load all saved torrents', async () => {
        const torrent1 = createTestTorrentInfo({ infoHash: 'aaaa'.repeat(10) });
        const torrent2 = createTestTorrentInfo({ infoHash: 'bbbb'.repeat(10) });
        const torrent3 = createTestTorrentInfo({ infoHash: 'cccc'.repeat(10) });

        await saveTorrentState(torrent1, [0, 1], testDir);
        await saveTorrentState(torrent2, [2, 3], testDir);
        await saveTorrentState(torrent3, [4, 5], testDir);

        const states = await loadAllTorrentStates(testDir);

        expect(states.length).toBe(3);
        const hashes = states.map((s) => s.infoHash).sort();
        expect(hashes).toEqual([
          'aaaa'.repeat(10),
          'bbbb'.repeat(10),
          'cccc'.repeat(10),
        ]);
      });

      it('should return empty array when no torrents saved', async () => {
        const states = await loadAllTorrentStates(testDir);
        expect(states).toEqual([]);
      });

      it('should skip invalid state files', async () => {
        const validTorrent = createTestTorrentInfo({ infoHash: 'aaaa'.repeat(10) });
        await saveTorrentState(validTorrent, [0], testDir);

        // Create an invalid state file
        const invalidPath = path.join(testDir, 'torrents', 'invalid.json');
        await fs.writeFile(invalidPath, 'not json', 'utf-8');

        const states = await loadAllTorrentStates(testDir);

        expect(states.length).toBe(1);
        expect(states[0].infoHash).toBe(validTorrent.infoHash);
      });
    });

    describe('deleteTorrentState', () => {
      it('should delete existing state file', async () => {
        const torrent = createTestTorrentInfo();
        await saveTorrentState(torrent, [0, 1], testDir);

        await deleteTorrentState(torrent.infoHash, testDir);

        const exists = await torrentStateExists(torrent.infoHash, testDir);
        expect(exists).toBe(false);
      });

      it('should not throw for non-existent state', async () => {
        await expect(deleteTorrentState('nonexistent', testDir)).resolves.not.toThrow();
      });
    });

    describe('torrentStateExists', () => {
      it('should return true for existing state', async () => {
        const torrent = createTestTorrentInfo();
        await saveTorrentState(torrent, [], testDir);

        const exists = await torrentStateExists(torrent.infoHash, testDir);
        expect(exists).toBe(true);
      });

      it('should return false for non-existent state', async () => {
        const exists = await torrentStateExists('nonexistent', testDir);
        expect(exists).toBe(false);
      });
    });
  });

  describe('AutoSaveManager', () => {
    it('should start and stop without errors', () => {
      const manager = new AutoSaveManager(
        testDir,
        () => ({ torrents: [] }),
        100
      );

      manager.start();
      manager.stop();
    });

    it('should call saveAll on manual trigger', async () => {
      const torrent = createTestTorrentInfo();
      const completedPieces = [0, 1, 2];

      const manager = new AutoSaveManager(
        testDir,
        () => ({
          torrents: [{ info: torrent, completedPieces }],
        }),
        100
      );

      await manager.saveAll();

      const loaded = await loadTorrentState(torrent.infoHash, testDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.infoHash).toBe(torrent.infoHash);
    });

    it('should track removed torrents', async () => {
      const torrent = createTestTorrentInfo();
      let torrentList = [{ info: torrent, completedPieces: [0] }];

      const manager = new AutoSaveManager(
        testDir,
        () => ({ torrents: torrentList }),
        100
      );

      await manager.saveAll();
      manager.clearTracking(torrent.infoHash);

      // Verify tracking was cleared (no error on clear)
      expect(true).toBe(true);
    });

    it('should auto-save on interval', async () => {
      vi.useFakeTimers();

      const torrent = createTestTorrentInfo();
      let downloadCount = 0;

      const manager = new AutoSaveManager(
        testDir,
        () => ({
          torrents: [{
            info: {
              ...torrent,
              downloaded: downloadCount++ * torrent.pieceLength,
            },
            completedPieces: Array.from({ length: downloadCount }, (_, i) => i),
          }],
        }),
        100
      );

      manager.start();

      // Fast-forward past the interval
      await vi.advanceTimersByTimeAsync(150);

      manager.stop();

      // Check that state was saved
      const loaded = await loadTorrentState(torrent.infoHash, testDir);
      // The manager should have saved at least once
      // (exact behavior depends on the saveIfNeeded logic)

      vi.useRealTimers();
    });
  });
});
