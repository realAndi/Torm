/**
 * Color palette and theme definitions for the Torm TUI.
 *
 * This module provides color constants for use with Ink components.
 * Uses a green-based theme appropriate for a BitTorrent client.
 *
 * @module ui/theme/colors
 */

// =============================================================================
// Base Color Palette
// =============================================================================

/**
 * Primary color palette for the application.
 * Uses green as the primary color for a BitTorrent client aesthetic.
 */
export const colors = {
  /** Primary accent color - emerald green */
  primary: 'green',

  /** Secondary accent color - for highlights */
  secondary: 'cyan',

  /** Success state color for completed operations */
  success: 'greenBright',

  /** Warning state color for attention-needed items */
  warning: 'yellow',

  /** Error state color for failures and critical issues */
  error: 'red',

  /** Muted color for secondary/disabled content */
  muted: 'gray',

  /** Dim color for less important UI elements */
  dim: 'blackBright',

  /** Highlight color for focused elements */
  highlight: 'greenBright',

  /** Text color for normal content */
  text: 'white',

  /** Border color for UI containers */
  border: 'green',

  /** Subtle border color */
  borderDim: 'gray',
} as const;

/**
 * Type representing valid color values from the palette.
 */
export type Color = (typeof colors)[keyof typeof colors];

// =============================================================================
// Status Colors
// =============================================================================

/**
 * Colors mapped to torrent states for visual status indication.
 * These correspond to the TorrentState enum values.
 */
export const statusColors = {
  /** Color for torrents actively downloading */
  downloading: 'green',

  /** Color for torrents seeding to peers */
  seeding: 'cyan',

  /** Color for paused torrents */
  paused: 'yellow',

  /** Color for torrents in error state */
  error: 'red',

  /** Color for torrents checking/verifying data */
  checking: 'blue',

  /** Color for torrents queued and waiting */
  queued: 'gray',
} as const;

/**
 * Type representing valid status color values.
 */
export type StatusColor = (typeof statusColors)[keyof typeof statusColors];

// =============================================================================
// Label Colors
// =============================================================================

/**
 * Pre-defined colors for common torrent labels.
 * Labels not in this map will use the default color.
 */
export const labelColors: Record<string, string> = {
  // Media types
  movies: 'blue',
  movie: 'blue',
  films: 'blue',
  film: 'blue',
  music: 'green',
  audio: 'green',
  games: 'magenta',
  game: 'magenta',
  tv: 'cyan',
  shows: 'cyan',
  series: 'cyan',
  anime: 'cyan',
  books: 'yellow',
  ebooks: 'yellow',
  software: 'magenta',
  apps: 'magenta',

  // Quality indicators
  hd: 'blue',
  '4k': 'blue',
  uhd: 'blue',
  '1080p': 'blue',
  '720p': 'cyan',

  // Status labels
  important: 'red',
  favorite: 'yellow',
  archive: 'gray',
  new: 'green',
  complete: 'green',
  incomplete: 'yellow',
} as const;

/**
 * Default color for labels not in the labelColors map.
 */
export const defaultLabelColor = 'white';

/**
 * Get the color for a specific label.
 *
 * @param label - The label string (case-insensitive)
 * @returns The color for the label, or defaultLabelColor if not found
 *
 * @example
 * ```ts
 * const color = getLabelColor('movies');  // 'blue'
 * const color = getLabelColor('custom');  // 'white' (default)
 * ```
 */
export function getLabelColor(label: string): string {
  const normalizedLabel = label.toLowerCase().trim();
  return labelColors[normalizedLabel] || defaultLabelColor;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the appropriate color for a torrent state.
 *
 * @param state - The torrent state string (e.g., 'downloading', 'seeding')
 * @returns The corresponding color for the state, or muted if unknown
 *
 * @example
 * ```ts
 * const color = getStatusColor('downloading'); // 'green'
 * const color = getStatusColor('seeding');     // 'greenBright'
 * ```
 */
export function getStatusColor(state: string): string {
  const normalizedState = state.toLowerCase();
  if (normalizedState in statusColors) {
    return statusColors[normalizedState as keyof typeof statusColors];
  }
  return colors.muted;
}

/**
 * Get color based on a progress percentage.
 * Useful for progress bars and completion indicators.
 *
 * @param progress - Progress value between 0 and 1
 * @returns Color based on completion level
 *
 * @example
 * ```ts
 * const color = getProgressColor(0.25); // 'red'
 * const color = getProgressColor(0.75); // 'yellow'
 * const color = getProgressColor(1.0);  // 'greenBright'
 * ```
 */
export function getProgressColor(progress: number): string {
  if (progress >= 1) return colors.success;
  if (progress >= 0.5) return colors.warning;
  if (progress >= 0.25) return colors.primary;
  return colors.error;
}

/**
 * Get color based on download/upload speed.
 * Useful for speed indicators.
 *
 * @param bytesPerSecond - Speed in bytes per second
 * @returns Color based on speed level
 */
export function getSpeedColor(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return colors.muted;
  if (bytesPerSecond >= 1024 * 1024) return colors.success; // >= 1 MB/s
  if (bytesPerSecond >= 100 * 1024) return colors.primary; // >= 100 KB/s
  return colors.warning;
}
