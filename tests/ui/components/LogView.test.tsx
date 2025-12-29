import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { LogView, LogEntry } from '../../../src/ui/components/LogView.js';

/**
 * Helper to create a mock log entry with default values
 */
function createMockLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: new Date('2024-01-15T14:32:15Z'),
    level: 'info',
    message: 'Test message',
    ...overrides,
  };
}

describe('LogView', () => {
  describe('empty state', () => {
    it('renders empty state', () => {
      const { lastFrame } = render(<LogView logs={[]} />);
      expect(lastFrame()).toContain('No activity recorded');
    });

    it('does not render header when no logs', () => {
      const { lastFrame } = render(<LogView logs={[]} />);
      expect(lastFrame()).not.toContain('Time');
      expect(lastFrame()).not.toContain('Level');
      expect(lastFrame()).not.toContain('Message');
    });
  });

  describe('log entries with timestamps', () => {
    it('renders log entry with timestamp', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({
          timestamp: new Date('2024-01-15T14:32:15Z'),
          message: 'Torrent started',
        }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      // Timestamp should be in HH:MM:SS format
      expect(lastFrame()).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    it('renders multiple log entries', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({
          timestamp: new Date('2024-01-15T14:32:15Z'),
          message: 'First message',
        }),
        createMockLogEntry({
          timestamp: new Date('2024-01-15T14:32:45Z'),
          message: 'Second message',
        }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('First message');
      expect(lastFrame()).toContain('Second message');
    });

    it('renders header row with column labels', () => {
      const logs: LogEntry[] = [createMockLogEntry()];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('Time');
      expect(lastFrame()).toContain('Level');
      expect(lastFrame()).toContain('Message');
    });

    it('shows correct timestamp format', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({
          timestamp: new Date('2024-01-15T09:05:03Z'),
        }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      // Should show time in local timezone format
      expect(lastFrame()).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('color-coding by level', () => {
    it('shows INF prefix for info level', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({ level: 'info' }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('INF');
    });

    it('shows WRN prefix for warn level', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({ level: 'warn' }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('WRN');
    });

    it('shows ERR prefix for error level', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({ level: 'error' }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('ERR');
    });

    it('shows mixed log levels correctly', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({ level: 'info', message: 'Info message' }),
        createMockLogEntry({ level: 'warn', message: 'Warning message' }),
        createMockLogEntry({ level: 'error', message: 'Error message' }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('INF');
      expect(lastFrame()).toContain('WRN');
      expect(lastFrame()).toContain('ERR');
    });
  });

  describe('entry count indicator', () => {
    it('shows entry count when exceeds max', () => {
      const logs: LogEntry[] = Array.from({ length: 25 }, (_, i) =>
        createMockLogEntry({
          message: `Log entry ${i + 1}`,
          timestamp: new Date(Date.now() + i * 1000),
        })
      );
      const { lastFrame } = render(<LogView logs={logs} maxEntries={20} />);
      expect(lastFrame()).toContain('Showing 20 of 25 entries');
    });

    it('does not show entry count when under max', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({ message: 'Entry 1' }),
        createMockLogEntry({ message: 'Entry 2' }),
      ];
      const { lastFrame } = render(<LogView logs={logs} maxEntries={20} />);
      expect(lastFrame()).not.toContain('Showing');
      expect(lastFrame()).not.toContain('of');
      expect(lastFrame()).not.toContain('entries');
    });

    it('shows entry count when exactly at max', () => {
      const logs: LogEntry[] = Array.from({ length: 20 }, (_, i) =>
        createMockLogEntry({ message: `Log entry ${i + 1}` })
      );
      const { lastFrame } = render(<LogView logs={logs} maxEntries={20} />);
      // Exactly at max should not show the indicator
      expect(lastFrame()).not.toContain('Showing 20 of 20');
    });
  });

  describe('limits displayed entries', () => {
    it('limits displayed entries to maxEntries', () => {
      const logs: LogEntry[] = Array.from({ length: 30 }, (_, i) =>
        createMockLogEntry({
          message: `Log message ${i + 1}`,
          timestamp: new Date(Date.now() + i * 1000),
        })
      );
      const { lastFrame } = render(<LogView logs={logs} maxEntries={5} />);
      // Should show indicator for limited entries
      expect(lastFrame()).toContain('Showing 5 of 30 entries');
    });

    it('uses default maxEntries of 20', () => {
      const logs: LogEntry[] = Array.from({ length: 25 }, (_, i) =>
        createMockLogEntry({
          message: `Log message ${i + 1}`,
          timestamp: new Date(Date.now() + i * 1000),
        })
      );
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('Showing 20 of 25 entries');
    });

    it('shows all entries when under limit', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({ message: 'Message 1' }),
        createMockLogEntry({ message: 'Message 2' }),
        createMockLogEntry({ message: 'Message 3' }),
      ];
      const { lastFrame } = render(<LogView logs={logs} maxEntries={10} />);
      expect(lastFrame()).toContain('Message 1');
      expect(lastFrame()).toContain('Message 2');
      expect(lastFrame()).toContain('Message 3');
    });

    it('shows most recent entries first', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({
          message: 'Oldest message',
          timestamp: new Date('2024-01-15T12:00:00Z'),
        }),
        createMockLogEntry({
          message: 'Middle message',
          timestamp: new Date('2024-01-15T12:01:00Z'),
        }),
        createMockLogEntry({
          message: 'Newest message',
          timestamp: new Date('2024-01-15T12:02:00Z'),
        }),
      ];
      const { lastFrame } = render(<LogView logs={logs} maxEntries={20} />);
      const frame = lastFrame();

      // All messages should be present
      expect(frame).toContain('Oldest message');
      expect(frame).toContain('Middle message');
      expect(frame).toContain('Newest message');

      // Most recent should be at top (first after header)
      const newestIndex = frame.indexOf('Newest message');
      const oldestIndex = frame.indexOf('Oldest message');
      expect(newestIndex).toBeLessThan(oldestIndex);
    });

    it('drops oldest entries when over limit', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({
          message: 'Old entry to drop',
          timestamp: new Date('2024-01-15T12:00:00Z'),
        }),
        createMockLogEntry({
          message: 'Recent entry to keep',
          timestamp: new Date('2024-01-15T12:01:00Z'),
        }),
      ];
      const { lastFrame } = render(<LogView logs={logs} maxEntries={1} />);
      expect(lastFrame()).toContain('Recent entry to keep');
      expect(lastFrame()).not.toContain('Old entry to drop');
    });
  });

  describe('message content', () => {
    it('displays full message text', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({ message: 'Torrent started downloading' }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('Torrent started downloading');
    });

    it('displays long messages', () => {
      const longMessage = 'This is a very long log message that might need to be handled carefully in the UI display';
      const logs: LogEntry[] = [
        createMockLogEntry({ message: longMessage }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('This is a very long log message');
    });

    it('displays messages with special characters', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({ message: 'File: /path/to/file.txt (1.5 GB)' }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('/path/to/file.txt');
      expect(lastFrame()).toContain('1.5 GB');
    });
  });

  describe('typical log scenarios', () => {
    it('displays tracker timeout warning', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({
          level: 'warn',
          message: 'Tracker timeout: tracker.example.com',
        }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('WRN');
      expect(lastFrame()).toContain('Tracker timeout');
    });

    it('displays peer connection info', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({
          level: 'info',
          message: 'Connected to peer 192.168.1.100:6881',
        }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('INF');
      expect(lastFrame()).toContain('Connected to peer');
    });

    it('displays disk error', () => {
      const logs: LogEntry[] = [
        createMockLogEntry({
          level: 'error',
          message: 'Disk write error: No space left on device',
        }),
      ];
      const { lastFrame } = render(<LogView logs={logs} />);
      expect(lastFrame()).toContain('ERR');
      expect(lastFrame()).toContain('Disk write error');
    });
  });
});
