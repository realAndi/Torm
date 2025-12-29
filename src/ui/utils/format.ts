/**
 * Shared formatting utilities for Torm UI
 *
 * These functions provide consistent formatting across all UI components
 * for bytes, speeds, time durations, and other common display formats.
 */

/**
 * Formats bytes into a human-readable string with appropriate units.
 *
 * @param bytes - The number of bytes to format
 * @returns Formatted string (e.g., "3.1 GB", "256 KB", "0 B")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const base = 1024;

  const exponent = Math.floor(Math.log(bytes) / Math.log(base));
  const unitIndex = Math.min(exponent, units.length - 1);

  const value = bytes / Math.pow(base, unitIndex);

  if (unitIndex === 0) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Formats bytes with padding for aligned display in tables.
 *
 * @param bytes - The number of bytes to format
 * @param width - Target width for padding (default: 8)
 * @returns Padded formatted string
 */
export function formatBytesAligned(bytes: number, width = 8): string {
  return formatBytes(bytes).padStart(width);
}

/**
 * Formats speed in bytes/second to human-readable string.
 *
 * @param bytesPerSecond - The speed in bytes per second
 * @returns Formatted string (e.g., "2.1 MB/s", "256 KB/s")
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const base = 1024;

  const exponent = Math.floor(Math.log(bytesPerSecond) / Math.log(base));
  const unitIndex = Math.min(exponent, units.length - 1);

  const value = bytesPerSecond / Math.pow(base, unitIndex);

  if (value >= 100) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  } else if (value >= 10) {
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  } else {
    return `${value.toFixed(2)} ${units[unitIndex]}`;
  }
}

/**
 * Formats speed with compact units for narrow columns.
 *
 * @param bytesPerSecond - The speed in bytes per second
 * @returns Compact formatted string (e.g., "2.1M/s", "256K/s")
 */
export function formatSpeedCompact(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0B/s';

  const units = ['B/s', 'K/s', 'M/s', 'G/s'];
  const base = 1024;

  const exponent = Math.floor(Math.log(bytesPerSecond) / Math.log(base));
  const unitIndex = Math.min(exponent, units.length - 1);

  const value = bytesPerSecond / Math.pow(base, unitIndex);

  if (value >= 10) {
    return `${Math.round(value)}${units[unitIndex]}`;
  } else {
    return `${value.toFixed(1)}${units[unitIndex]}`;
  }
}

/**
 * Formats seconds into a human-readable ETA string.
 *
 * @param seconds - The number of seconds, or null if unknown
 * @returns Formatted string (e.g., "12m", "1h 30m", "2d 5h") or "--" if null
 */
export function formatEta(seconds: number | null): string {
  if (seconds === null || seconds <= 0) {
    return '--';
  }

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

/**
 * Formats seconds into a human-readable duration string.
 *
 * @param seconds - The number of seconds
 * @returns Formatted string (e.g., "12m 30s", "1h 30m", "2d 5h 12m")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) {
    return '0s';
  }

  const secs = Math.floor(seconds % 60);
  const mins = Math.floor((seconds / 60) % 60);
  const hours = Math.floor((seconds / 3600) % 24);
  const days = Math.floor(seconds / 86400);

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (mins > 0) {
    parts.push(`${mins}m`);
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs}s`);
  }

  return parts.join(' ');
}

/**
 * Formats a Date into a relative time string (e.g., "2m ago", "1h ago").
 *
 * @param date - The date to format, or null. Can also be an ISO string (from JSON serialization).
 * @returns Relative time string or "--" if null
 */
export function formatRelativeTime(date: Date | string | null): string {
  if (!date) return '--';

  // Handle ISO strings from JSON serialization
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '--';

  const now = Date.now();
  const diff = Math.floor((now - dateObj.getTime()) / 1000);

  if (diff < 0) {
    // Future time - format as countdown
    return formatEta(-diff);
  }

  if (diff < 60) {
    return `${diff}s ago`;
  }

  const minutes = Math.floor(diff / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Formats a Date into a time-until string (e.g., "in 2m", "in 1h").
 *
 * @param date - The future date, or null. Can also be an ISO string (from JSON serialization).
 * @returns Time until string or "--" if null or past
 */
export function formatTimeUntil(date: Date | string | null): string {
  if (!date) return '--';

  // Handle ISO strings from JSON serialization
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '--';

  const now = Date.now();
  const diff = Math.floor((dateObj.getTime() - now) / 1000);

  if (diff <= 0) {
    return 'now';
  }

  return `in ${formatEta(diff)}`;
}

/**
 * Formats a timestamp for log display.
 *
 * @param date - The date to format
 * @returns Formatted timestamp string (HH:MM:SS)
 */
export function formatTimestamp(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Formats a progress value as a percentage string.
 *
 * @param progress - Progress as a ratio (0-1)
 * @returns Formatted percentage string (e.g., "67%")
 */
export function formatProgress(progress: number): string {
  return `${Math.round(progress * 100)}%`;
}

/**
 * Truncates a string to a maximum length, adding ellipsis if needed.
 *
 * @param text - The string to truncate
 * @param maxLength - Maximum length including ellipsis
 * @returns Truncated string
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + '\u2026'; // ellipsis
}

/**
 * Formats an IP address and port.
 *
 * @param ip - IP address
 * @param port - Port number
 * @returns Formatted string (e.g., "192.168.1.1:6881")
 */
export function formatAddress(ip: string, port: number): string {
  return `${ip}:${port}`;
}

/**
 * Converts a two-letter ISO 3166-1 alpha-2 country code to a flag emoji.
 *
 * Uses Unicode regional indicator symbols. Each letter A-Z maps to
 * a regional indicator (🇦-🇿), and two indicators combine to form a flag.
 *
 * @param countryCode - Two-letter country code (e.g., "US", "GB", "DE")
 * @returns Flag emoji (e.g., "🇺🇸", "🇬🇧", "🇩🇪") or "🌐" for unknown/missing
 */
export function countryCodeToFlag(countryCode: string | undefined): string {
  if (!countryCode || countryCode.length !== 2) {
    return '🌐';
  }

  const code = countryCode.toUpperCase();

  // Validate that both characters are A-Z
  if (!/^[A-Z]{2}$/.test(code)) {
    return '🌐';
  }

  // Regional Indicator Symbol Letter A starts at U+1F1E6
  const REGIONAL_INDICATOR_A = 0x1f1e6;
  const CHAR_CODE_A = 'A'.charCodeAt(0);

  const first = REGIONAL_INDICATOR_A + (code.charCodeAt(0) - CHAR_CODE_A);
  const second = REGIONAL_INDICATOR_A + (code.charCodeAt(1) - CHAR_CODE_A);

  return String.fromCodePoint(first, second);
}
