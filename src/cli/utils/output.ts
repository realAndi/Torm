/**
 * CLI output utilities for Torm commands.
 *
 * Provides shared formatting and output helpers for consistent
 * command-line output across all CLI commands.
 *
 * @module cli/utils/output
 */

import { TorrentState } from '../../engine/types.js';
import {
  formatBytes,
  formatSpeed,
  formatProgress,
  formatEta,
  formatDuration,
  truncateText,
} from '../../ui/utils/format.js';

// Re-export formatting utilities for convenience
export {
  formatBytes,
  formatSpeed,
  formatProgress,
  formatEta,
  formatDuration,
  truncateText,
};

// =============================================================================
// Status Colors and Formatting
// =============================================================================

/**
 * ANSI color codes for terminal output
 */
export const ansiColors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
} as const;

/**
 * Map torrent states to display colors
 */
export const stateColors: Record<TorrentState, string> = {
  [TorrentState.DOWNLOADING]: ansiColors.blue,
  [TorrentState.SEEDING]: ansiColors.green,
  [TorrentState.PAUSED]: ansiColors.yellow,
  [TorrentState.ERROR]: ansiColors.red,
  [TorrentState.CHECKING]: ansiColors.cyan,
  [TorrentState.QUEUED]: ansiColors.gray,
};

/**
 * Map torrent states to display names
 */
export const stateNames: Record<TorrentState, string> = {
  [TorrentState.DOWNLOADING]: 'Downloading',
  [TorrentState.SEEDING]: 'Seeding',
  [TorrentState.PAUSED]: 'Paused',
  [TorrentState.ERROR]: 'Error',
  [TorrentState.CHECKING]: 'Checking',
  [TorrentState.QUEUED]: 'Queued',
};

/**
 * Apply ANSI color to text
 */
export function colorize(text: string, color: string): string {
  return `${color}${text}${ansiColors.reset}`;
}

/**
 * Get colored status text for a torrent state
 */
export function getColoredStatus(state: TorrentState): string {
  const color = stateColors[state];
  const name = stateNames[state];
  return colorize(name, color);
}

// =============================================================================
// Table Formatting
// =============================================================================

/**
 * Column definition for table formatting
 */
export interface TableColumn {
  /** Column header text */
  header: string;
  /** Column width */
  width: number;
  /** Alignment: 'left' | 'right' | 'center' */
  align?: 'left' | 'right' | 'center';
}

/**
 * Pad text to a fixed width with alignment
 */
export function padText(
  text: string,
  width: number,
  align: 'left' | 'right' | 'center' = 'left'
): string {
  const truncated = text.length > width ? truncateText(text, width) : text;
  const padding = width - truncated.length;

  if (padding <= 0) return truncated;

  switch (align) {
    case 'right':
      return ' '.repeat(padding) + truncated;
    case 'center': {
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return ' '.repeat(leftPad) + truncated + ' '.repeat(rightPad);
    }
    default:
      return truncated + ' '.repeat(padding);
  }
}

/**
 * Format a table header row
 */
export function formatTableHeader(columns: TableColumn[]): string {
  const headerParts = columns.map((col) =>
    padText(col.header, col.width, col.align)
  );
  const header = headerParts.join(' | ');
  const separator = columns.map((col) => '-'.repeat(col.width)).join('-+-');
  return `${header}\n${separator}`;
}

/**
 * Format a table row
 */
export function formatTableRow(
  values: string[],
  columns: TableColumn[]
): string {
  const cells = values.map((val, i) => {
    const col = columns[i];
    return padText(val, col.width, col.align);
  });
  return cells.join(' | ');
}

// =============================================================================
// Input Validation
// =============================================================================

/**
 * Check if a string is a valid magnet URI
 */
export function isMagnetUri(input: string): boolean {
  return input.startsWith('magnet:?');
}

/**
 * Check if a string looks like a .torrent file path
 */
export function isTorrentFile(input: string): boolean {
  return input.endsWith('.torrent');
}

/**
 * Check if a string is a valid info hash (40-character hex string)
 */
export function isValidInfoHash(input: string): boolean {
  return /^[a-fA-F0-9]{40}$/.test(input);
}

/**
 * Parse a torrent identifier (accepts full hash or short prefix)
 */
export function parseTorrentId(input: string): {
  type: 'hash' | 'prefix';
  value: string;
} {
  const cleaned = input.toLowerCase().trim();
  if (isValidInfoHash(cleaned)) {
    return { type: 'hash', value: cleaned };
  }
  // Treat as a prefix if it's a valid hex string
  if (/^[a-fA-F0-9]+$/.test(cleaned)) {
    return { type: 'prefix', value: cleaned };
  }
  throw new Error(`Invalid torrent identifier: ${input}`);
}

// =============================================================================
// Message Formatting
// =============================================================================

/**
 * Format a success message
 */
export function successMessage(message: string): string {
  return colorize(`[OK] ${message}`, ansiColors.green);
}

/**
 * Format an error message
 */
export function errorMessage(message: string): string {
  return colorize(`[ERROR] ${message}`, ansiColors.red);
}

/**
 * Format an info message
 */
export function infoMessage(message: string): string {
  return colorize(`[INFO] ${message}`, ansiColors.cyan);
}

/**
 * Format a warning message
 */
export function warnMessage(message: string): string {
  return colorize(`[WARN] ${message}`, ansiColors.yellow);
}

// =============================================================================
// Progress Display
// =============================================================================

/**
 * Create a text-based progress bar
 */
export function createProgressBar(
  progress: number,
  width: number = 20
): string {
  const filled = Math.round(progress * width);
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  const percentage = Math.round(progress * 100);
  return `[${bar}] ${percentage.toString().padStart(3)}%`;
}

// =============================================================================
// Key-Value Display
// =============================================================================

/**
 * Format a key-value pair for display
 */
export function formatKeyValue(
  key: string,
  value: string,
  keyWidth: number = 15
): string {
  return `${colorize(padText(key + ':', keyWidth), ansiColors.dim)} ${value}`;
}

/**
 * Format multiple key-value pairs as a block
 */
export function formatInfoBlock(
  pairs: Array<[string, string]>,
  keyWidth: number = 15
): string {
  return pairs
    .map(([key, value]) => formatKeyValue(key, value, keyWidth))
    .join('\n');
}
