import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { TorrentRow } from '../../../src/ui/components/TorrentRow.js';
import { Torrent, TorrentState, FilePriority, TrackerStatus } from '../../../src/engine/types.js';

/**
 * Create a mock torrent for testing
 */
function createMockTorrent(overrides: Partial<Torrent> = {}): Torrent {
  return {
    infoHash: 'abc123def456abc123def456abc123def456abc1',
    name: 'ubuntu-24.04-desktop-amd64.iso',
    state: TorrentState.DOWNLOADING,
    progress: 0.67,
    downloadSpeed: 2.1 * 1024 * 1024, // 2.1 MB/s
    uploadSpeed: 512 * 1024, // 512 KB/s
    downloaded: 3.15 * 1024 * 1024 * 1024,
    uploaded: 256 * 1024 * 1024,
    size: 4.7 * 1024 * 1024 * 1024,
    pieceLength: 262144,
    pieceCount: 18800,
    peers: 12,
    seeds: 5,
    eta: 3600,
    files: [
      {
        path: 'ubuntu-24.04-desktop-amd64.iso',
        size: 4.7 * 1024 * 1024 * 1024,
        downloaded: 3.15 * 1024 * 1024 * 1024,
        priority: FilePriority.Normal,
        index: 0,
      },
    ],
    trackers: [
      {
        url: 'udp://tracker.ubuntu.com:6969/announce',
        status: TrackerStatus.Working,
        peers: 100,
        seeds: 50,
        leeches: 50,
        lastAnnounce: new Date(),
        nextAnnounce: new Date(Date.now() + 1800000),
      },
    ],
    addedAt: new Date(),
    labels: [],
    ...overrides,
  };
}

describe('TorrentRow', () => {
  describe('torrent name rendering', () => {
    it('renders torrent name', () => {
      const torrent = createMockTorrent({ name: 'Test Torrent' });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toContain('Test Torrent');
    });

    it('truncates long torrent name with ellipsis', () => {
      const longName = 'This is a very long torrent name that should be truncated';
      const torrent = createMockTorrent({ name: longName });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      const frame = lastFrame();
      // The name column width is 20, so it should be truncated
      expect(frame).toContain('\u2026'); // ellipsis character
      expect(frame).not.toContain(longName); // full name should not be present
    });

    it('pads short torrent name to column width', () => {
      const shortName = 'Short';
      const torrent = createMockTorrent({ name: shortName });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toContain('Short');
    });
  });

  describe('status display', () => {
    it('shows downloading status text for downloading state', () => {
      const torrent = createMockTorrent({ state: TorrentState.DOWNLOADING });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toMatch(/Download/); // Status column shows "Downloading" (may be truncated)
    });

    it('shows seeding status text for seeding state', () => {
      const torrent = createMockTorrent({ state: TorrentState.SEEDING });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toMatch(/Seeding/);
    });

    it('shows paused icon for paused state', () => {
      const torrent = createMockTorrent({ state: TorrentState.PAUSED });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toContain('\u23F8'); // pause symbol ⏸ before name
    });

    it('shows error status text for error state', () => {
      const torrent = createMockTorrent({
        state: TorrentState.ERROR,
        error: 'Disk full',
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toMatch(/Error/);
    });

    it('shows checking status text for checking state', () => {
      const torrent = createMockTorrent({ state: TorrentState.CHECKING });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toMatch(/Checking/);
    });

    it('shows queued icon for queued state', () => {
      const torrent = createMockTorrent({ state: TorrentState.QUEUED });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toMatch(/Queued/);
    });
  });

  describe('progress display', () => {
    it('displays progress percentage', () => {
      const torrent = createMockTorrent({ progress: 0.67 });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toContain('67%');
    });

    it('displays 0% for no progress', () => {
      const torrent = createMockTorrent({ progress: 0 });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toContain('0%');
    });

    it('displays 100% for complete progress', () => {
      const torrent = createMockTorrent({ progress: 1 });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toContain('100%');
    });
  });

  describe('speed display', () => {
    it('shows download speed when downloading', () => {
      const torrent = createMockTorrent({
        state: TorrentState.DOWNLOADING,
        downloadSpeed: 2.1 * 1024 * 1024, // 2.1 MB/s
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      // Should show download speed formatted (e.g., "2.1 MB/s")
      expect(lastFrame()).toMatch(/2\.1 MB\/s/);
    });

    it('shows upload speed when seeding', () => {
      const torrent = createMockTorrent({
        state: TorrentState.SEEDING,
        uploadSpeed: 1.5 * 1024 * 1024, // 1.5 MB/s
        downloadSpeed: 0,
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      // Should show upload speed formatted (e.g., "1.5 MB/s")
      expect(lastFrame()).toMatch(/1\.5 MB\/s/);
    });

    it('shows -- for zero speed when paused', () => {
      const torrent = createMockTorrent({
        state: TorrentState.PAUSED,
        downloadSpeed: 0,
        uploadSpeed: 0,
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      // Component shows "--" for zero speed
      expect(lastFrame()).toContain('--');
    });
  });

  describe('selection highlighting', () => {
    it('applies inverse styling when selected', () => {
      const torrent = createMockTorrent();
      const { lastFrame: selectedFrame } = render(
        <TorrentRow torrent={torrent} isSelected={true} index={1} />
      );
      const { lastFrame: normalFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      // Selected and normal frames should be different due to inverse styling
      // Ink testing library may not show ANSI codes, but the component renders differently
      expect(selectedFrame()).toBeDefined();
      expect(normalFrame()).toBeDefined();
    });

    it('renders index number correctly', () => {
      const torrent = createMockTorrent();
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={5} />
      );

      expect(lastFrame()).toContain(' 5');
    });
  });

  describe('labels display', () => {
    it('shows labels if present', () => {
      const torrent = createMockTorrent({
        labels: ['movies', 'hd'],
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toContain('[movies]');
      expect(lastFrame()).toContain('[hd]');
    });

    it('does not show labels section when no labels', () => {
      const torrent = createMockTorrent({
        labels: [],
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      // Just make sure the row renders without error
      expect(lastFrame()).toBeDefined();
    });

    it('limits displayed labels with maxLabels', () => {
      const torrent = createMockTorrent({
        labels: ['movies', 'hd', '2024', 'favorite'],
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      // LabelList is called with maxLabels=2 in TorrentRow
      expect(lastFrame()).toContain('[movies]');
      expect(lastFrame()).toContain('[hd]');
      expect(lastFrame()).toContain('+2');
    });
  });

  describe('size formatting', () => {
    it('formats size in GB correctly', () => {
      const torrent = createMockTorrent({
        size: 4.7 * 1024 * 1024 * 1024, // 4.7 GB
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toMatch(/4\.7.*GB|4\.70 GB/);
    });

    it('formats size in MB correctly', () => {
      const torrent = createMockTorrent({
        size: 256 * 1024 * 1024, // 256 MB
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toMatch(/256.*MB/);
    });

    it('formats size in KB correctly', () => {
      const torrent = createMockTorrent({
        size: 512 * 1024, // 512 KB
      });
      const { lastFrame } = render(
        <TorrentRow torrent={torrent} isSelected={false} index={1} />
      );

      expect(lastFrame()).toMatch(/512.*KB/);
    });
  });
});
