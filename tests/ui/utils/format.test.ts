import { describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  formatBytes,
  formatBytesAligned,
  formatSpeed,
  formatSpeedCompact,
  formatEta,
  formatRelativeTime,
  formatTimeUntil,
  formatTimestamp,
  formatProgress,
  truncateText,
  formatAddress,
} from '../../../src/ui/utils/format.js';

describe('Format Utilities', () => {
  describe('formatBytes', () => {
    it('should return "0 B" for 0', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes correctly (< 1024)', () => {
      expect(formatBytes(1)).toBe('1 B');
      expect(formatBytes(100)).toBe('100 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('should format KB correctly', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(10240)).toBe('10.0 KB');
      expect(formatBytes(102400)).toBe('100.0 KB');
      expect(formatBytes(1048575)).toBe('1024.0 KB');
    });

    it('should format MB correctly', () => {
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(1572864)).toBe('1.5 MB');
      expect(formatBytes(10485760)).toBe('10.0 MB');
      expect(formatBytes(104857600)).toBe('100.0 MB');
      expect(formatBytes(524288000)).toBe('500.0 MB');
    });

    it('should format GB correctly', () => {
      expect(formatBytes(1073741824)).toBe('1.0 GB');
      expect(formatBytes(1610612736)).toBe('1.5 GB');
      expect(formatBytes(10737418240)).toBe('10.0 GB');
      expect(formatBytes(107374182400)).toBe('100.0 GB');
    });

    it('should format TB correctly', () => {
      expect(formatBytes(1099511627776)).toBe('1.0 TB');
      expect(formatBytes(1649267441664)).toBe('1.5 TB');
      expect(formatBytes(10995116277760)).toBe('10.0 TB');
    });

    it('should format PB correctly', () => {
      expect(formatBytes(1125899906842624)).toBe('1.0 PB');
    });

    it('should handle negative numbers gracefully', () => {
      // The function uses Math.log which returns NaN for negative numbers
      // This results in NaN being passed to Math.min and the unitIndex becoming NaN
      // The behavior is implementation-specific, but we document what actually happens
      const result = formatBytes(-1024);
      // With negative numbers, Math.log returns NaN, resulting in 'NaN undefined'
      expect(result).toBe('NaN undefined');
    });

    it('should handle very large numbers', () => {
      // Numbers beyond PB should still format as PB
      expect(formatBytes(1125899906842624 * 1024)).toBe('1024.0 PB');
    });

    it('should round bytes to whole numbers', () => {
      expect(formatBytes(1)).toBe('1 B');
      expect(formatBytes(999)).toBe('999 B');
    });
  });

  describe('formatBytesAligned', () => {
    it('should pad output to specified width', () => {
      expect(formatBytesAligned(0)).toBe('     0 B');
      expect(formatBytesAligned(0, 10)).toBe('       0 B');
    });

    it('should use default width of 8', () => {
      const result = formatBytesAligned(1024);
      expect(result.length).toBeGreaterThanOrEqual(8);
    });

    it('should handle larger numbers', () => {
      expect(formatBytesAligned(1073741824, 10)).toBe('    1.0 GB');
    });
  });

  describe('formatSpeed', () => {
    it('should return "0 B/s" for 0', () => {
      expect(formatSpeed(0)).toBe('0 B/s');
    });

    it('should format bytes/sec correctly', () => {
      expect(formatSpeed(1)).toBe('1.00 B/s');
      expect(formatSpeed(100)).toBe('100 B/s');
      expect(formatSpeed(512)).toBe('512 B/s');
    });

    it('should format KB/s correctly', () => {
      expect(formatSpeed(1024)).toBe('1.00 KB/s');
      expect(formatSpeed(1536)).toBe('1.50 KB/s');
      expect(formatSpeed(10240)).toBe('10.0 KB/s');
      expect(formatSpeed(102400)).toBe('100 KB/s');
    });

    it('should format MB/s correctly', () => {
      expect(formatSpeed(1048576)).toBe('1.00 MB/s');
      expect(formatSpeed(5242880)).toBe('5.00 MB/s');
      expect(formatSpeed(10485760)).toBe('10.0 MB/s');
      expect(formatSpeed(104857600)).toBe('100 MB/s');
    });

    it('should format GB/s correctly', () => {
      expect(formatSpeed(1073741824)).toBe('1.00 GB/s');
      expect(formatSpeed(10737418240)).toBe('10.0 GB/s');
      expect(formatSpeed(107374182400)).toBe('100 GB/s');
    });

    it('should use appropriate decimal precision based on value', () => {
      // Values < 10: 2 decimal places
      expect(formatSpeed(1024)).toBe('1.00 KB/s');
      expect(formatSpeed(5120)).toBe('5.00 KB/s');

      // Values 10-99: 1 decimal place
      expect(formatSpeed(10240)).toBe('10.0 KB/s');
      expect(formatSpeed(51200)).toBe('50.0 KB/s');

      // Values >= 100: no decimal places (rounded)
      expect(formatSpeed(102400)).toBe('100 KB/s');
      expect(formatSpeed(512000)).toBe('500 KB/s');
    });
  });

  describe('formatSpeedCompact', () => {
    it('should return "0B/s" for 0', () => {
      expect(formatSpeedCompact(0)).toBe('0B/s');
    });

    it('should format with compact B/s notation', () => {
      expect(formatSpeedCompact(1)).toBe('1.0B/s');
      expect(formatSpeedCompact(512)).toBe('512B/s');
    });

    it('should format with compact K/s notation', () => {
      expect(formatSpeedCompact(1024)).toBe('1.0K/s');
      expect(formatSpeedCompact(5120)).toBe('5.0K/s');
      expect(formatSpeedCompact(10240)).toBe('10K/s');
      expect(formatSpeedCompact(102400)).toBe('100K/s');
    });

    it('should format with compact M/s notation', () => {
      expect(formatSpeedCompact(1048576)).toBe('1.0M/s');
      expect(formatSpeedCompact(5242880)).toBe('5.0M/s');
      expect(formatSpeedCompact(10485760)).toBe('10M/s');
    });

    it('should format with compact G/s notation', () => {
      expect(formatSpeedCompact(1073741824)).toBe('1.0G/s');
      expect(formatSpeedCompact(10737418240)).toBe('10G/s');
    });

    it('should handle edge cases at unit boundaries', () => {
      // Just below 10 - should use 1 decimal place
      expect(formatSpeedCompact(9 * 1024)).toBe('9.0K/s');
      // At 10 - should round to whole number
      expect(formatSpeedCompact(10 * 1024)).toBe('10K/s');
    });
  });

  describe('formatEta', () => {
    it('should return "--" for null', () => {
      expect(formatEta(null)).toBe('--');
    });

    it('should return "--" for 0', () => {
      expect(formatEta(0)).toBe('--');
    });

    it('should return "--" for negative values', () => {
      expect(formatEta(-1)).toBe('--');
      expect(formatEta(-100)).toBe('--');
    });

    it('should format seconds correctly', () => {
      expect(formatEta(1)).toBe('1s');
      expect(formatEta(30)).toBe('30s');
      expect(formatEta(59)).toBe('59s');
    });

    it('should format minutes correctly', () => {
      expect(formatEta(60)).toBe('1m');
      expect(formatEta(90)).toBe('1m');  // 90s = 1m 30s, but shows as 1m (no seconds)
      expect(formatEta(120)).toBe('2m');
      expect(formatEta(300)).toBe('5m');
      expect(formatEta(3540)).toBe('59m');
    });

    it('should format hours correctly', () => {
      expect(formatEta(3600)).toBe('1h');
      expect(formatEta(5400)).toBe('1h 30m');
      expect(formatEta(7200)).toBe('2h');
      expect(formatEta(7260)).toBe('2h 1m');
      expect(formatEta(86340)).toBe('23h 59m');
    });

    it('should format days correctly', () => {
      expect(formatEta(86400)).toBe('1d');
      expect(formatEta(129600)).toBe('1d 12h');
      expect(formatEta(172800)).toBe('2d');
      expect(formatEta(259200)).toBe('3d');
      expect(formatEta(604800)).toBe('7d');
    });

    it('should handle very large values', () => {
      // 365 days
      expect(formatEta(31536000)).toBe('365d');
      // 1000 days
      expect(formatEta(86400000)).toBe('1000d');
    });

    it('should not show zero components', () => {
      // 1 day exactly - no hours shown
      expect(formatEta(86400)).toBe('1d');
      // 1 hour exactly - no minutes shown
      expect(formatEta(3600)).toBe('1h');
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers(); // Reset to real time
    });

    it('should return "--" for null', () => {
      expect(formatRelativeTime(null)).toBe('--');
    });

    it('should format seconds ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now - 1000))).toBe('1s ago');
      expect(formatRelativeTime(new Date(now - 30000))).toBe('30s ago');
      expect(formatRelativeTime(new Date(now - 59000))).toBe('59s ago');
    });

    it('should format "0s ago" for very recent times', () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now))).toBe('0s ago');
      expect(formatRelativeTime(new Date(now - 500))).toBe('0s ago');
    });

    it('should format minutes ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now - 60000))).toBe('1m ago');
      expect(formatRelativeTime(new Date(now - 120000))).toBe('2m ago');
      expect(formatRelativeTime(new Date(now - 3540000))).toBe('59m ago');
    });

    it('should format hours ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now - 3600000))).toBe('1h ago');
      expect(formatRelativeTime(new Date(now - 7200000))).toBe('2h ago');
      expect(formatRelativeTime(new Date(now - 82800000))).toBe('23h ago');
    });

    it('should format days ago', () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now - 86400000))).toBe('1d ago');
      expect(formatRelativeTime(new Date(now - 172800000))).toBe('2d ago');
      expect(formatRelativeTime(new Date(now - 604800000))).toBe('7d ago');
    });

    it('should handle future times using formatEta', () => {
      const now = Date.now();
      // Future time - should format as ETA
      expect(formatRelativeTime(new Date(now + 60000))).toBe('1m');
      expect(formatRelativeTime(new Date(now + 3600000))).toBe('1h');
    });
  });

  describe('formatTimeUntil', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers(); // Reset to real time
    });

    it('should return "--" for null', () => {
      expect(formatTimeUntil(null)).toBe('--');
    });

    it('should return "now" for past times', () => {
      const now = Date.now();
      expect(formatTimeUntil(new Date(now - 1000))).toBe('now');
      expect(formatTimeUntil(new Date(now - 60000))).toBe('now');
    });

    it('should return "now" for current time', () => {
      const now = Date.now();
      expect(formatTimeUntil(new Date(now))).toBe('now');
    });

    it('should format future times with "in" prefix', () => {
      const now = Date.now();
      expect(formatTimeUntil(new Date(now + 30000))).toBe('in 30s');
      expect(formatTimeUntil(new Date(now + 60000))).toBe('in 1m');
      expect(formatTimeUntil(new Date(now + 3600000))).toBe('in 1h');
      expect(formatTimeUntil(new Date(now + 86400000))).toBe('in 1d');
    });
  });

  describe('formatTimestamp', () => {
    it('should format time as HH:MM:SS', () => {
      expect(formatTimestamp(new Date('2024-01-15T09:05:03'))).toBe('09:05:03');
      expect(formatTimestamp(new Date('2024-01-15T23:59:59'))).toBe('23:59:59');
      expect(formatTimestamp(new Date('2024-01-15T00:00:00'))).toBe('00:00:00');
    });

    it('should pad single digit values with zeros', () => {
      expect(formatTimestamp(new Date('2024-01-15T01:02:03'))).toBe('01:02:03');
      expect(formatTimestamp(new Date('2024-01-15T00:00:01'))).toBe('00:00:01');
    });

    it('should handle midnight correctly', () => {
      expect(formatTimestamp(new Date('2024-01-15T00:00:00'))).toBe('00:00:00');
    });

    it('should handle noon correctly', () => {
      expect(formatTimestamp(new Date('2024-01-15T12:00:00'))).toBe('12:00:00');
    });
  });

  describe('formatProgress', () => {
    it('should format 0% correctly', () => {
      expect(formatProgress(0)).toBe('0%');
    });

    it('should format 50% correctly', () => {
      expect(formatProgress(0.5)).toBe('50%');
    });

    it('should format 100% correctly', () => {
      expect(formatProgress(1)).toBe('100%');
    });

    it('should round decimal values', () => {
      expect(formatProgress(0.333)).toBe('33%');
      expect(formatProgress(0.666)).toBe('67%');
      expect(formatProgress(0.999)).toBe('100%');
    });

    it('should handle small decimal values', () => {
      expect(formatProgress(0.001)).toBe('0%');
      expect(formatProgress(0.005)).toBe('1%');
      expect(formatProgress(0.01)).toBe('1%');
    });

    it('should handle values over 100%', () => {
      expect(formatProgress(1.5)).toBe('150%');
      expect(formatProgress(2)).toBe('200%');
    });

    it('should handle various precision levels', () => {
      expect(formatProgress(0.1)).toBe('10%');
      expect(formatProgress(0.25)).toBe('25%');
      expect(formatProgress(0.75)).toBe('75%');
      expect(formatProgress(0.99)).toBe('99%');
    });
  });

  describe('truncateText', () => {
    it('should return full text if under limit', () => {
      expect(truncateText('hello', 10)).toBe('hello');
      expect(truncateText('short', 100)).toBe('short');
    });

    it('should return full text if at exact length', () => {
      expect(truncateText('hello', 5)).toBe('hello');
      expect(truncateText('test', 4)).toBe('test');
    });

    it('should truncate with ellipsis when over limit', () => {
      expect(truncateText('hello world', 5)).toBe('hell\u2026');
      expect(truncateText('this is a long string', 10)).toBe('this is a\u2026');
    });

    it('should handle empty string', () => {
      expect(truncateText('', 10)).toBe('');
      expect(truncateText('', 0)).toBe('');
    });

    it('should handle maxLength of 1', () => {
      expect(truncateText('hello', 1)).toBe('\u2026');
    });

    it('should handle maxLength of 2', () => {
      expect(truncateText('hello', 2)).toBe('h\u2026');
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(1000);
      const result = truncateText(longString, 50);
      expect(result.length).toBe(50);
      expect(result.endsWith('\u2026')).toBe(true);
    });

    it('should preserve spaces correctly when truncating', () => {
      expect(truncateText('hello world', 6)).toBe('hello\u2026');
    });

    it('should use Unicode ellipsis character', () => {
      const result = truncateText('hello world', 8);
      expect(result).toBe('hello w\u2026');
      expect(result.charCodeAt(7)).toBe(0x2026);
    });
  });

  describe('formatAddress', () => {
    it('should format IPv4 address with port correctly', () => {
      expect(formatAddress('192.168.1.1', 6881)).toBe('192.168.1.1:6881');
      expect(formatAddress('127.0.0.1', 8080)).toBe('127.0.0.1:8080');
      expect(formatAddress('0.0.0.0', 0)).toBe('0.0.0.0:0');
    });

    it('should format localhost correctly', () => {
      expect(formatAddress('localhost', 3000)).toBe('localhost:3000');
    });

    it('should handle IPv6 addresses', () => {
      // Note: The current implementation does not add brackets around IPv6
      // This test documents the current behavior
      expect(formatAddress('::1', 6881)).toBe('::1:6881');
      expect(formatAddress('2001:db8::1', 8080)).toBe('2001:db8::1:8080');
      expect(formatAddress('fe80::1', 443)).toBe('fe80::1:443');
    });

    it('should handle various port numbers', () => {
      expect(formatAddress('192.168.1.1', 0)).toBe('192.168.1.1:0');
      expect(formatAddress('192.168.1.1', 1)).toBe('192.168.1.1:1');
      expect(formatAddress('192.168.1.1', 65535)).toBe('192.168.1.1:65535');
    });

    it('should handle empty IP string', () => {
      expect(formatAddress('', 6881)).toBe(':6881');
    });

    it('should handle hostnames', () => {
      expect(formatAddress('example.com', 80)).toBe('example.com:80');
      expect(formatAddress('tracker.example.org', 6969)).toBe('tracker.example.org:6969');
    });
  });

  describe('edge cases and integration', () => {
    it('should handle NaN values in formatBytes', () => {
      const result = formatBytes(NaN);
      expect(result).toContain('NaN');
    });

    it('should handle Infinity in formatBytes', () => {
      const result = formatBytes(Infinity);
      // Infinity / Infinity = NaN for the value calculation
      expect(result).toBeDefined();
    });

    it('should handle NaN values in formatSpeed', () => {
      const result = formatSpeed(NaN);
      expect(result).toBeDefined();
    });

    it('should handle Infinity in formatSpeed', () => {
      const result = formatSpeed(Infinity);
      expect(result).toBeDefined();
    });

    it('should handle NaN values in formatProgress', () => {
      expect(formatProgress(NaN)).toBe('NaN%');
    });

    it('should handle Infinity in formatProgress', () => {
      expect(formatProgress(Infinity)).toBe('Infinity%');
    });

    it('should handle negative numbers in formatProgress', () => {
      expect(formatProgress(-0.5)).toBe('-50%');
    });

    it('should handle fractional seconds in formatEta', () => {
      // The function displays seconds as-is (including decimals)
      expect(formatEta(1.5)).toBe('1.5s');
      expect(formatEta(59.9)).toBe('59.9s');
    });
  });
});
