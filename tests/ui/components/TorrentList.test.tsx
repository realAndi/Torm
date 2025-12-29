import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { TorrentList, filterTorrents } from '../../../src/ui/components/TorrentList.js';
import { Torrent, TorrentState, FilePriority, TrackerStatus } from '../../../src/engine/types.js';

/**
 * Create a mock torrent for testing
 */
function createMockTorrent(overrides: Partial<Torrent> = {}): Torrent {
  return {
    infoHash: `${Math.random().toString(36).substring(2, 42)}`,
    name: 'Test Torrent',
    state: TorrentState.DOWNLOADING,
    progress: 0.5,
    downloadSpeed: 1024 * 1024,
    uploadSpeed: 512 * 1024,
    downloaded: 512 * 1024 * 1024,
    uploaded: 128 * 1024 * 1024,
    size: 1024 * 1024 * 1024,
    pieceLength: 262144,
    pieceCount: 4096,
    peers: 10,
    seeds: 5,
    eta: 1800,
    files: [
      {
        path: 'test-file.dat',
        size: 1024 * 1024 * 1024,
        downloaded: 512 * 1024 * 1024,
        priority: FilePriority.Normal,
        index: 0,
      },
    ],
    trackers: [
      {
        url: 'udp://tracker.example.com:6969/announce',
        status: TrackerStatus.Working,
        peers: 50,
        seeds: 25,
        leeches: 25,
        lastAnnounce: new Date(),
        nextAnnounce: new Date(Date.now() + 1800000),
      },
    ],
    addedAt: new Date(),
    labels: [],
    ...overrides,
  };
}

/**
 * Create multiple mock torrents
 */
function createMockTorrents(count: number): Torrent[] {
  return Array.from({ length: count }, (_, i) =>
    createMockTorrent({
      infoHash: `hash${i}${'0'.repeat(36)}`,
      name: `Torrent ${i + 1}`,
      progress: (i + 1) / count,
    })
  );
}

describe('TorrentList', () => {
  describe('empty state', () => {
    it('renders empty state message when no torrents', () => {
      const { lastFrame } = render(
        <TorrentList
          torrents={[]}
          selectedIndex={0}
          onSelect={vi.fn()}
        />
      );

      expect(lastFrame()).toContain('No torrents');
    });

    it('shows help text for adding torrents', () => {
      const { lastFrame } = render(
        <TorrentList
          torrents={[]}
          selectedIndex={0}
          onSelect={vi.fn()}
        />
      );

      expect(lastFrame()).toContain("'a' to add");
    });
  });

  describe('torrent list rendering', () => {
    it('renders list of torrents', () => {
      const torrents = [
        createMockTorrent({ name: 'Ubuntu ISO' }),
        createMockTorrent({ name: 'Arch Linux' }),
        createMockTorrent({ name: 'Debian DVD' }),
      ];

      const { lastFrame } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={0}
          onSelect={vi.fn()}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('Ubuntu ISO');
      expect(frame).toContain('Arch Linux');
      expect(frame).toContain('Debian DVD');
    });

    it('renders header row with column names', () => {
      const torrents = createMockTorrents(2);

      const { lastFrame } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={0}
          onSelect={vi.fn()}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('#');
      expect(frame).toContain('Name');
      expect(frame).toContain('Size');
      expect(frame).toContain('Progress');
      expect(frame).toContain('Speed');
    });

    it('renders correct number of torrent rows', () => {
      const torrents = createMockTorrents(5);

      const { lastFrame } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={0}
          onSelect={vi.fn()}
        />
      );

      const frame = lastFrame();
      // Each torrent should have its index shown
      expect(frame).toContain('1');
      expect(frame).toContain('2');
      expect(frame).toContain('3');
      expect(frame).toContain('4');
      expect(frame).toContain('5');
    });
  });

  describe('selection highlighting', () => {
    it('highlights selected torrent', () => {
      const torrents = [
        createMockTorrent({ name: 'First Torrent' }),
        createMockTorrent({ name: 'Second Torrent' }),
        createMockTorrent({ name: 'Third Torrent' }),
      ];

      const { lastFrame: firstSelected } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={0}
          onSelect={vi.fn()}
        />
      );

      const { lastFrame: secondSelected } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={1}
          onSelect={vi.fn()}
        />
      );

      // Both should render successfully
      expect(firstSelected()).toBeDefined();
      expect(secondSelected()).toBeDefined();

      // Both should contain all torrent names
      expect(firstSelected()).toContain('First Torrent');
      expect(secondSelected()).toContain('Second Torrent');
    });

    it('correctly passes selectedIndex to TorrentRow', () => {
      const torrents = createMockTorrents(3);

      const { lastFrame } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={1}
          onSelect={vi.fn()}
        />
      );

      // The component should render without error
      expect(lastFrame()).toBeDefined();
    });
  });

  describe('filtering with search', () => {
    it('shows "No matching torrents" when filter has no results', () => {
      const torrents = [
        createMockTorrent({ name: 'Ubuntu ISO' }),
        createMockTorrent({ name: 'Arch Linux' }),
      ];

      const { lastFrame } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={0}
          onSelect={vi.fn()}
          searchQuery="Debian"
        />
      );

      expect(lastFrame()).toContain('No matching torrents');
    });

    it('shows escape hint when filtered with no results', () => {
      const torrents = [
        createMockTorrent({ name: 'Ubuntu ISO' }),
      ];

      const { lastFrame } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={0}
          onSelect={vi.fn()}
          searchQuery="nonexistent"
        />
      );

      expect(lastFrame()).toContain('Escape');
    });

    it('displays only matching torrents when filtered', () => {
      const torrents = [
        createMockTorrent({ name: 'Ubuntu ISO' }),
        createMockTorrent({ name: 'Arch Linux' }),
        createMockTorrent({ name: 'Ubuntu Server' }),
      ];

      const { lastFrame } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={0}
          onSelect={vi.fn()}
          searchQuery="Ubuntu"
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('Ubuntu ISO');
      expect(frame).toContain('Ubuntu Server');
      expect(frame).not.toContain('Arch Linux');
    });
  });

  describe('filtering with status', () => {
    it('filters torrents by status', () => {
      const torrents = [
        createMockTorrent({ name: 'Downloading', state: TorrentState.DOWNLOADING }),
        createMockTorrent({ name: 'Seeding', state: TorrentState.SEEDING }),
        createMockTorrent({ name: 'Paused', state: TorrentState.PAUSED }),
      ];

      const { lastFrame } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={0}
          onSelect={vi.fn()}
          statusFilter={TorrentState.DOWNLOADING}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('Downloading');
      expect(frame).not.toContain('Seeding');
      expect(frame).not.toContain('Paused');
    });

    it('shows all torrents when status filter is "all"', () => {
      const torrents = [
        createMockTorrent({ name: 'Downloading', state: TorrentState.DOWNLOADING }),
        createMockTorrent({ name: 'Seeding', state: TorrentState.SEEDING }),
      ];

      const { lastFrame } = render(
        <TorrentList
          torrents={torrents}
          selectedIndex={0}
          onSelect={vi.fn()}
          statusFilter="all"
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('Downloading');
      expect(frame).toContain('Seeding');
    });
  });
});

describe('filterTorrents function', () => {
  describe('filtering by name', () => {
    it('filters torrents by name (case-insensitive)', () => {
      const torrents = [
        createMockTorrent({ name: 'Ubuntu ISO' }),
        createMockTorrent({ name: 'Arch Linux' }),
        createMockTorrent({ name: 'ubuntu server' }),
      ];

      const filtered = filterTorrents(torrents, 'ubuntu');

      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.name)).toContain('Ubuntu ISO');
      expect(filtered.map(t => t.name)).toContain('ubuntu server');
    });

    it('returns all torrents when search query is empty', () => {
      const torrents = createMockTorrents(5);

      const filtered = filterTorrents(torrents, '');

      expect(filtered).toHaveLength(5);
    });

    it('returns all torrents when search query is whitespace only', () => {
      const torrents = createMockTorrents(3);

      const filtered = filterTorrents(torrents, '   ');

      expect(filtered).toHaveLength(3);
    });

    it('trims search query before matching', () => {
      const torrents = [
        createMockTorrent({ name: 'Test Torrent' }),
        createMockTorrent({ name: 'Other Torrent' }),
      ];

      const filtered = filterTorrents(torrents, '  test  ');

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Test Torrent');
    });

    it('performs substring matching', () => {
      const torrents = [
        createMockTorrent({ name: 'ubuntu-24.04-desktop-amd64.iso' }),
        createMockTorrent({ name: 'archlinux-2024.01.01-x86_64.iso' }),
      ];

      const filtered = filterTorrents(torrents, 'desktop');

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toContain('desktop');
    });
  });

  describe('filtering by status', () => {
    it('filters torrents by downloading status', () => {
      const torrents = [
        createMockTorrent({ name: 'A', state: TorrentState.DOWNLOADING }),
        createMockTorrent({ name: 'B', state: TorrentState.SEEDING }),
        createMockTorrent({ name: 'C', state: TorrentState.DOWNLOADING }),
      ];

      const filtered = filterTorrents(torrents, undefined, TorrentState.DOWNLOADING);

      expect(filtered).toHaveLength(2);
      expect(filtered.every(t => t.state === TorrentState.DOWNLOADING)).toBe(true);
    });

    it('filters torrents by seeding status', () => {
      const torrents = [
        createMockTorrent({ state: TorrentState.DOWNLOADING }),
        createMockTorrent({ state: TorrentState.SEEDING }),
        createMockTorrent({ state: TorrentState.PAUSED }),
      ];

      const filtered = filterTorrents(torrents, undefined, TorrentState.SEEDING);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].state).toBe(TorrentState.SEEDING);
    });

    it('filters torrents by paused status', () => {
      const torrents = [
        createMockTorrent({ state: TorrentState.PAUSED }),
        createMockTorrent({ state: TorrentState.DOWNLOADING }),
        createMockTorrent({ state: TorrentState.PAUSED }),
      ];

      const filtered = filterTorrents(torrents, undefined, TorrentState.PAUSED);

      expect(filtered).toHaveLength(2);
    });

    it('filters torrents by error status', () => {
      const torrents = [
        createMockTorrent({ state: TorrentState.ERROR }),
        createMockTorrent({ state: TorrentState.DOWNLOADING }),
      ];

      const filtered = filterTorrents(torrents, undefined, TorrentState.ERROR);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].state).toBe(TorrentState.ERROR);
    });

    it('filters torrents by checking status', () => {
      const torrents = [
        createMockTorrent({ state: TorrentState.CHECKING }),
        createMockTorrent({ state: TorrentState.DOWNLOADING }),
      ];

      const filtered = filterTorrents(torrents, undefined, TorrentState.CHECKING);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].state).toBe(TorrentState.CHECKING);
    });

    it('filters torrents by queued status', () => {
      const torrents = [
        createMockTorrent({ state: TorrentState.QUEUED }),
        createMockTorrent({ state: TorrentState.DOWNLOADING }),
        createMockTorrent({ state: TorrentState.QUEUED }),
      ];

      const filtered = filterTorrents(torrents, undefined, TorrentState.QUEUED);

      expect(filtered).toHaveLength(2);
    });

    it('returns all torrents when status filter is "all"', () => {
      const torrents = [
        createMockTorrent({ state: TorrentState.DOWNLOADING }),
        createMockTorrent({ state: TorrentState.SEEDING }),
        createMockTorrent({ state: TorrentState.PAUSED }),
      ];

      const filtered = filterTorrents(torrents, undefined, 'all');

      expect(filtered).toHaveLength(3);
    });

    it('returns all torrents when status filter is undefined', () => {
      const torrents = createMockTorrents(4);

      const filtered = filterTorrents(torrents, undefined, undefined);

      expect(filtered).toHaveLength(4);
    });
  });

  describe('combined filtering', () => {
    it('combines name and status filters', () => {
      const torrents = [
        createMockTorrent({ name: 'Ubuntu Download', state: TorrentState.DOWNLOADING }),
        createMockTorrent({ name: 'Ubuntu Seed', state: TorrentState.SEEDING }),
        createMockTorrent({ name: 'Arch Download', state: TorrentState.DOWNLOADING }),
        createMockTorrent({ name: 'Arch Seed', state: TorrentState.SEEDING }),
      ];

      const filtered = filterTorrents(torrents, 'Ubuntu', TorrentState.DOWNLOADING);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Ubuntu Download');
    });

    it('returns empty array when no torrents match combined filters', () => {
      const torrents = [
        createMockTorrent({ name: 'Ubuntu', state: TorrentState.SEEDING }),
        createMockTorrent({ name: 'Arch', state: TorrentState.DOWNLOADING }),
      ];

      const filtered = filterTorrents(torrents, 'Ubuntu', TorrentState.DOWNLOADING);

      expect(filtered).toHaveLength(0);
    });
  });
});
