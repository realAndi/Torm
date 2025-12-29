import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import {
  StatusBar,
  formatBytes,
  formatEta,
} from '../../../src/ui/components/StatusBar.js';
import { TorrentState } from '../../../src/engine/types.js';

describe('StatusBar', () => {
  describe('formatBytes', () => {
    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(2048)).toBe('2.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('should format terabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    });
  });

  describe('formatEta', () => {
    it('should return "--" for null', () => {
      expect(formatEta(null)).toBe('--');
    });

    it('should return "--" for 0 seconds', () => {
      expect(formatEta(0)).toBe('--');
    });

    it('should return "--" for negative seconds', () => {
      expect(formatEta(-100)).toBe('--');
    });

    it('should format seconds', () => {
      expect(formatEta(30)).toBe('30s');
      expect(formatEta(59)).toBe('59s');
    });

    it('should format minutes', () => {
      expect(formatEta(60)).toBe('1m');
      expect(formatEta(120)).toBe('2m');
      expect(formatEta(12 * 60)).toBe('12m');
    });

    it('should format hours', () => {
      expect(formatEta(3600)).toBe('1h');
      expect(formatEta(3660)).toBe('1h 1m');
      expect(formatEta(2 * 3600 + 30 * 60)).toBe('2h 30m');
    });

    it('should format days', () => {
      expect(formatEta(24 * 3600)).toBe('1d');
      expect(formatEta(24 * 3600 + 5 * 3600)).toBe('1d 5h');
      expect(formatEta(2 * 24 * 3600)).toBe('2d');
    });
  });

  describe('component rendering', () => {
    it('should show "No torrent selected" when no torrent', () => {
      const { lastFrame } = render(<StatusBar selectedTorrent={null} />);
      expect(lastFrame()).toContain('No torrent selected');
    });

    it('should show torrent info when selected', () => {
      const torrent = {
        id: 'test-id',
        name: 'ubuntu-24.04.iso',
        infoHash: 'abc123',
        state: TorrentState.DOWNLOADING,
        progress: 0.67,
        downloaded: 3.1 * 1024 * 1024 * 1024,
        uploaded: 0,
        size: 4.7 * 1024 * 1024 * 1024,
        downloadSpeed: 1024 * 1024,
        uploadSpeed: 0,
        peers: 10,
        seeds: 5,
        eta: 720,
        addedAt: Date.now(),
        labels: [],
      };

      const { lastFrame } = render(
        <StatusBar selectedTorrent={torrent} selectedIndex={1} />
      );
      const frame = lastFrame();

      expect(frame).toContain('ubuntu-24.04.iso');
      expect(frame).toContain('67%');
      expect(frame).toContain('[1]');
      expect(frame).toContain('ETA:');
    });

    it('should display keyboard shortcuts', () => {
      const { lastFrame } = render(<StatusBar selectedTorrent={null} />);
      const frame = lastFrame();

      expect(frame).toContain('q:Quit');
      expect(frame).toContain('a:Add');
      expect(frame).toContain('p:Pause');
      expect(frame).toContain('r:Resume');
      expect(frame).toContain('d:Delete');
      expect(frame).toContain('/:Search');
      expect(frame).toContain('s:Settings');
      expect(frame).toContain('?:Help');
    });

    it('should format ETA correctly in torrent info', () => {
      const torrent = {
        id: 'test-id',
        name: 'test.torrent',
        infoHash: 'abc123',
        state: TorrentState.DOWNLOADING,
        progress: 0.5,
        downloaded: 500,
        uploaded: 0,
        size: 1000,
        downloadSpeed: 100,
        uploadSpeed: 0,
        peers: 5,
        seeds: 2,
        eta: 12 * 60, // 12 minutes
        addedAt: Date.now(),
        labels: [],
      };

      const { lastFrame } = render(<StatusBar selectedTorrent={torrent} />);
      // Note: ETA format is "ETA:12m" without space after colon
      expect(lastFrame()).toContain('ETA:12m');
    });

    it('should show "--" for unknown ETA', () => {
      const torrent = {
        id: 'test-id',
        name: 'test.torrent',
        infoHash: 'abc123',
        state: TorrentState.DOWNLOADING,
        progress: 0.5,
        downloaded: 500,
        uploaded: 0,
        size: 1000,
        downloadSpeed: 100,
        uploadSpeed: 0,
        peers: 5,
        seeds: 2,
        eta: null,
        addedAt: Date.now(),
        labels: [],
      };

      const { lastFrame } = render(<StatusBar selectedTorrent={torrent} />);
      // Note: ETA format is "ETA:--" without space after colon
      expect(lastFrame()).toContain('ETA:--');
    });

    it('should show filter count when filtering with selected torrent', () => {
      const torrent = {
        id: 'test-id',
        name: 'test.torrent',
        infoHash: 'abc123',
        state: TorrentState.DOWNLOADING,
        progress: 0.5,
        downloaded: 500,
        uploaded: 0,
        size: 1000,
        downloadSpeed: 100,
        uploadSpeed: 0,
        peers: 5,
        seeds: 2,
        eta: 60,
        addedAt: Date.now(),
        labels: [],
      };

      const { lastFrame } = render(
        <StatusBar
          selectedTorrent={torrent}
          isFiltered={true}
          filteredCount={5}
          totalCount={10}
          statusFilter="all"
        />
      );
      const frame = lastFrame();

      // Component shows [filteredCount/totalCount] format
      expect(frame).toContain('[5/10]');
    });

    it('should show filter count with status filter active', () => {
      const torrent = {
        id: 'test-id',
        name: 'test.torrent',
        infoHash: 'abc123',
        state: TorrentState.DOWNLOADING,
        progress: 0.5,
        downloaded: 500,
        uploaded: 0,
        size: 1000,
        downloadSpeed: 100,
        uploadSpeed: 0,
        peers: 5,
        seeds: 2,
        eta: 60,
        addedAt: Date.now(),
        labels: [],
      };

      const { lastFrame } = render(
        <StatusBar
          selectedTorrent={torrent}
          isFiltered={true}
          filteredCount={3}
          totalCount={10}
          statusFilter={TorrentState.DOWNLOADING}
        />
      );
      const frame = lastFrame();

      // Shows filter count in [filtered/total] format
      expect(frame).toContain('[3/10]');
    });

    it('should not show filter status when not filtering', () => {
      const { lastFrame } = render(
        <StatusBar
          selectedTorrent={null}
          isFiltered={false}
          filteredCount={10}
          totalCount={10}
        />
      );
      const frame = lastFrame();

      expect(frame).not.toContain('Showing');
    });
  });
});
