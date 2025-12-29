import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { PeerList } from '../../../src/ui/components/PeerList.js';
import type { Peer } from '../../../src/engine/types.js';

/**
 * Helper to create a mock peer with default values
 */
function createMockPeer(overrides: Partial<Peer> = {}): Peer {
  return {
    id: 'peer-1',
    ip: '192.168.1.100',
    port: 6881,
    client: 'qBittorrent 4.5',
    downloadSpeed: 0,
    uploadSpeed: 0,
    progress: 0,
    flags: {
      amInterested: false,
      amChoking: true,
      peerInterested: false,
      peerChoking: true,
    },
    ...overrides,
  };
}

describe('PeerList', () => {
  describe('empty state', () => {
    it('renders empty state when no peers', () => {
      const { lastFrame } = render(<PeerList peers={[]} />);
      expect(lastFrame()).toContain('No peers connected');
    });

    it('does not render header when no peers', () => {
      const { lastFrame } = render(<PeerList peers={[]} />);
      expect(lastFrame()).not.toContain('Address');
      expect(lastFrame()).not.toContain('Client');
    });
  });

  describe('peer rows', () => {
    it('renders peer rows with IP:port', () => {
      const peers: Peer[] = [
        createMockPeer({ id: 'peer-1', ip: '192.168.1.100', port: 6881 }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('192.168.1.100:6881');
    });

    it('renders multiple peers', () => {
      const peers: Peer[] = [
        createMockPeer({ id: 'peer-1', ip: '192.168.1.100', port: 6881 }),
        createMockPeer({ id: 'peer-2', ip: '10.0.0.50', port: 51413 }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('192.168.1.100:6881');
      expect(lastFrame()).toContain('10.0.0.50:51413');
    });

    it('renders header row with column labels', () => {
      const peers: Peer[] = [createMockPeer()];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('Address');
      expect(lastFrame()).toContain('Client');
      expect(lastFrame()).toContain('Prog');
      expect(lastFrame()).toContain('Down');
      expect(lastFrame()).toContain('Up');
      expect(lastFrame()).toContain('Flags');
    });
  });

  describe('client name', () => {
    it('shows client name', () => {
      const peers: Peer[] = [
        createMockPeer({ client: 'qBittorrent 4.5' }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('qBittorrent 4.5');
    });

    it('shows Unknown for missing client', () => {
      const peers: Peer[] = [
        createMockPeer({ client: '' }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('Unknown');
    });

    it('truncates long client names', () => {
      const peers: Peer[] = [
        createMockPeer({ client: 'VeryLongClientNameThatShouldBeTruncated' }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      // Should contain truncation character (ellipsis)
      expect(lastFrame()).toContain('\u2026');
    });
  });

  describe('download/upload speeds', () => {
    it('displays download speed', () => {
      const peers: Peer[] = [
        createMockPeer({ downloadSpeed: 1024 * 1024 }), // 1 MB/s
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      // Speed should be formatted (1M/s or similar)
      expect(lastFrame()).toMatch(/1(\.0)?M\/s/);
    });

    it('displays upload speed', () => {
      const peers: Peer[] = [
        createMockPeer({ uploadSpeed: 256 * 1024 }), // 256 KB/s
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toMatch(/256K\/s/);
    });

    it('displays zero speed as 0B/s', () => {
      const peers: Peer[] = [
        createMockPeer({ downloadSpeed: 0, uploadSpeed: 0 }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('0B/s');
    });

    it('displays both download and upload speeds', () => {
      const peers: Peer[] = [
        createMockPeer({
          downloadSpeed: 1.2 * 1024 * 1024, // 1.2 MB/s
          uploadSpeed: 512 * 1024,           // 512 KB/s
        }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toMatch(/1\.2M\/s/);
      expect(lastFrame()).toMatch(/512K\/s/);
    });
  });

  describe('peer flags', () => {
    it('shows K flag when we are choking the peer', () => {
      const peers: Peer[] = [
        createMockPeer({
          flags: {
            amChoking: true,
            amInterested: false,
            peerChoking: false,
            peerInterested: false,
          },
        }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('K');
    });

    it('shows k flag when peer is choking us', () => {
      const peers: Peer[] = [
        createMockPeer({
          flags: {
            amChoking: false,
            amInterested: false,
            peerChoking: true,
            peerInterested: false,
          },
        }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('k');
    });

    it('shows d flag when we are interested in peer', () => {
      const peers: Peer[] = [
        createMockPeer({
          flags: {
            amChoking: false,
            amInterested: true,
            peerChoking: false,
            peerInterested: false,
          },
        }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('d');
    });

    it('shows u flag when peer is interested in us', () => {
      const peers: Peer[] = [
        createMockPeer({
          flags: {
            amChoking: false,
            amInterested: false,
            peerChoking: false,
            peerInterested: true,
          },
        }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('u');
    });

    it('shows multiple flags combined', () => {
      const peers: Peer[] = [
        createMockPeer({
          flags: {
            amChoking: true,
            amInterested: true,
            peerChoking: true,
            peerInterested: true,
          },
        }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      const frame = lastFrame();
      // Should contain all flags: K, k, d, u
      expect(frame).toContain('K');
      expect(frame).toContain('k');
      expect(frame).toContain('d');
      expect(frame).toContain('u');
    });

    it('shows dash for no flags', () => {
      const peers: Peer[] = [
        createMockPeer({
          flags: {
            amChoking: false,
            amInterested: false,
            peerChoking: false,
            peerInterested: false,
          },
        }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('-');
    });
  });

  describe('progress percentage', () => {
    it('formats progress as percentage', () => {
      const peers: Peer[] = [
        createMockPeer({ progress: 1.0 }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('100%');
    });

    it('formats partial progress as percentage', () => {
      const peers: Peer[] = [
        createMockPeer({ progress: 0.45 }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('45%');
    });

    it('formats zero progress', () => {
      const peers: Peer[] = [
        createMockPeer({ progress: 0 }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('0%');
    });

    it('rounds progress to nearest percent', () => {
      const peers: Peer[] = [
        createMockPeer({ progress: 0.677 }),
      ];
      const { lastFrame } = render(<PeerList peers={peers} />);
      expect(lastFrame()).toContain('68%');
    });
  });
});
