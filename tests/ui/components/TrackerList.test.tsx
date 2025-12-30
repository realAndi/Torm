import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { TrackerList } from '../../../src/ui/components/TrackerList.js';
import type { TrackerInfo } from '../../../src/engine/types.js';
import { TrackerStatus } from '../../../src/engine/types.js';

/**
 * Helper to create a mock tracker with default values
 */
function createMockTracker(overrides: Partial<TrackerInfo> = {}): TrackerInfo {
  return {
    url: 'http://tracker.example.com/announce',
    status: TrackerStatus.Idle,
    peers: 0,
    seeds: 0,
    leeches: 0,
    lastAnnounce: null,
    nextAnnounce: null,
    ...overrides,
  };
}

describe('TrackerList', () => {
  describe('empty state', () => {
    it('renders empty state', () => {
      const { lastFrame } = render(<TrackerList trackers={[]} />);
      expect(lastFrame()).toContain('No trackers configured');
    });

    it('does not render header when no trackers', () => {
      const { lastFrame } = render(<TrackerList trackers={[]} />);
      expect(lastFrame()).not.toContain('Tracker');
      expect(lastFrame()).not.toContain('Status');
    });
  });

  describe('tracker URL', () => {
    it('renders tracker URL', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ url: 'http://tracker.example.com/announce' }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('tracker.example.com');
    });

    it('renders tracker URL without protocol', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ url: 'http://tracker.example.com/announce' }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      // Should show domain but not http://
      expect(lastFrame()).toContain('tracker.example.com');
      expect(lastFrame()).not.toContain('http://');
    });

    it('renders multiple trackers', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ url: 'http://tracker1.example.com/announce' }),
        createMockTracker({ url: 'http://tracker2.example.org/announce' }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('tracker1.example.com');
      expect(lastFrame()).toContain('tracker2.example.org');
    });

    it('truncates long tracker URLs', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({
          url: 'http://very-long-tracker-url.with-subdomain.example.com:12345/announce'
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      // Should contain truncation (ellipsis unicode character)
      expect(lastFrame()).toContain('\u2026'); // Unicode ellipsis
    });

    it('renders header row with column labels', () => {
      const trackers: TrackerInfo[] = [createMockTracker()];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('Tracker');
      expect(lastFrame()).toContain('Status');
      expect(lastFrame()).toContain('Peers');
      expect(lastFrame()).toContain('Seeds');
      expect(lastFrame()).toContain('Leech');
    });
  });

  describe('tracker status', () => {
    it('shows idle status', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ status: TrackerStatus.Idle }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('Idle');
    });

    it('shows announcing status', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ status: TrackerStatus.Announcing }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('Announcing');
    });

    it('shows working status', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ status: TrackerStatus.Working }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('Working');
    });

    it('shows error status', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ status: TrackerStatus.Error }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('Error');
    });

    it('shows different statuses for different trackers', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({
          url: 'http://tracker1.example.com/announce',
          status: TrackerStatus.Working
        }),
        createMockTracker({
          url: 'http://tracker2.example.com/announce',
          status: TrackerStatus.Error
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('Working');
      expect(lastFrame()).toContain('Error');
    });
  });

  describe('peer/seed counts', () => {
    it('displays peer count', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ peers: 45 }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('45');
    });

    it('displays seed count', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ seeds: 12 }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('12');
    });

    it('displays leech count', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ leeches: 33 }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('33');
    });

    it('displays zero counts', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ peers: 0, seeds: 0, leeches: 0 }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      // Should have zeros for each column
      expect(lastFrame()).toContain('0');
    });

    it('displays all counts for tracker', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ peers: 100, seeds: 50, leeches: 50 }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('100');
      expect(lastFrame()).toContain('50');
    });
  });

  describe('last announce time', () => {
    it('shows last announce time in relative format', () => {
      const now = Date.now();
      const trackers: TrackerInfo[] = [
        createMockTracker({
          lastAnnounce: new Date(now - 2 * 60 * 1000), // 2 minutes ago
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('2m ago');
    });

    it('shows -- for null last announce', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ lastAnnounce: null }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('--');
    });

    it('shows last announce in hours when older', () => {
      const now = Date.now();
      const trackers: TrackerInfo[] = [
        createMockTracker({
          lastAnnounce: new Date(now - 2 * 60 * 60 * 1000), // 2 hours ago
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('2h ago');
    });

    it('shows last announce in seconds when recent', () => {
      const now = Date.now();
      const trackers: TrackerInfo[] = [
        createMockTracker({
          lastAnnounce: new Date(now - 30 * 1000), // 30 seconds ago
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('30s ago');
    });
  });

  describe('next announce time', () => {
    it('shows next announce time', () => {
      const now = Date.now();
      const trackers: TrackerInfo[] = [
        createMockTracker({
          nextAnnounce: new Date(now + 25 * 60 * 1000), // in 25 minutes
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      // Allow for slight timing variance (24m or 25m)
      expect(lastFrame()).toMatch(/in 2[45]m/);
    });

    it('shows -- for null next announce', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ nextAnnounce: null }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('--');
    });

    it('shows now for past next announce', () => {
      const now = Date.now();
      const trackers: TrackerInfo[] = [
        createMockTracker({
          nextAnnounce: new Date(now - 60 * 1000), // 1 minute ago
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('now');
    });
  });

  describe('error messages', () => {
    it('shows error message when status is error', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({
          status: TrackerStatus.Error,
          errorMessage: 'Connection refused',
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('Connection refused');
    });

    it('shows error message on separate line', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({
          status: TrackerStatus.Error,
          errorMessage: 'Tracker returned error: 503 Service Unavailable',
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('Tracker returned error');
    });

    it('shows error with tree connector', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({
          status: TrackerStatus.Error,
          errorMessage: 'Connection timeout',
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      // Error row should have tree connector
      expect(lastFrame()).toContain('\u2514'); // corner connector
    });

    it('does not show error row when no error message', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({
          status: TrackerStatus.Working,
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).not.toContain('\u2514');
    });

    it('truncates long error messages', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({
          status: TrackerStatus.Error,
          errorMessage: 'This is a very long error message that should definitely be truncated to fit within the display width of the terminal interface',
        }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      // Should contain truncation indicator (ellipsis unicode character)
      expect(lastFrame()).toContain('\u2026'); // Unicode ellipsis
    });
  });

  describe('UDP tracker URLs', () => {
    it('renders UDP tracker URLs', () => {
      const trackers: TrackerInfo[] = [
        createMockTracker({ url: 'udp://tracker.example.com:6969' }),
      ];
      const { lastFrame } = render(<TrackerList trackers={trackers} />);
      expect(lastFrame()).toContain('tracker.example.com');
      expect(lastFrame()).toContain('6969');
    });
  });
});
