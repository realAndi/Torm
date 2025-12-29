/**
 * Shared style constants for the Torm TUI.
 *
 * This module provides layout dimensions, border characters,
 * and other styling constants for consistent UI rendering.
 *
 * @module ui/theme/styles
 */

// =============================================================================
// Layout Dimensions
// =============================================================================

/**
 * Layout dimensions for the terminal UI.
 * These constants ensure consistent sizing across components.
 */
export const dimensions = {
  /** Height of the header bar in lines */
  headerHeight: 1,

  /** Height of the status bar in lines */
  statusBarHeight: 2,

  /** Minimum terminal width required for proper display */
  minWidth: 60,

  /** Minimum terminal height required for proper display */
  minHeight: 10,

  /** Default padding for content areas */
  padding: 1,

  /** Spacing between list items */
  listItemSpacing: 0,
} as const;

/**
 * Type representing dimension values.
 */
export type Dimension = (typeof dimensions)[keyof typeof dimensions];

// =============================================================================
// Border Characters
// =============================================================================

/**
 * Box-drawing characters for creating borders and frames.
 * Uses Unicode box-drawing characters for clean terminal rendering.
 */
export const borders = {
  /** Horizontal line character */
  horizontal: '─',

  /** Vertical line character */
  vertical: '│',

  /** Corner characters for box drawing */
  corners: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
  },

  /** T-junction characters for complex layouts */
  junctions: {
    left: '├',
    right: '┤',
    top: '┬',
    bottom: '┴',
    cross: '┼',
  },

  /** Double-line border variants for emphasis */
  double: {
    horizontal: '═',
    vertical: '║',
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
  },

  /** Rounded corner variants */
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
  },
} as const;

// =============================================================================
// Progress Bar Characters
// =============================================================================

/**
 * Characters for rendering progress bars.
 */
export const progressChars = {
  /** Filled portion of progress bar */
  filled: '█',

  /** Empty portion of progress bar */
  empty: '░',

  /** Partial fill characters for smoother progress */
  partial: ['▏', '▎', '▍', '▌', '▋', '▊', '▉'],
} as const;

// =============================================================================
// Text Symbols
// =============================================================================

/**
 * Common symbols used throughout the UI.
 */
export const symbols = {
  /** Indicator for selected items */
  selected: '▶',

  /** Bullet point for lists */
  bullet: '•',

  /** Check mark for completed items */
  check: '✓',

  /** Cross mark for failed/error items */
  cross: '✗',

  /** Arrow symbols for navigation */
  arrows: {
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
  },

  /** Spinner frames for loading animation */
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],

  /** Download/upload indicators */
  transfer: {
    download: '↓',
    upload: '↑',
  },
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a horizontal line of specified width.
 *
 * @param width - Width of the line in characters
 * @param char - Character to use (defaults to horizontal border)
 * @returns A string of repeated characters
 *
 * @example
 * ```ts
 * const line = createHorizontalLine(20);
 * // Returns: '────────────────────'
 * ```
 */
export function createHorizontalLine(
  width: number,
  char: string = borders.horizontal
): string {
  return char.repeat(width);
}

/**
 * Create a box frame with the specified dimensions.
 *
 * @param width - Inner width of the box
 * @param height - Inner height of the box
 * @param style - Border style to use ('single' | 'double' | 'rounded')
 * @returns An object with top, bottom, and side strings
 *
 * @example
 * ```ts
 * const frame = createBoxFrame(20, 5);
 * console.log(frame.top);    // '┌────────────────────┐'
 * console.log(frame.bottom); // '└────────────────────┘'
 * ```
 */
export function createBoxFrame(
  width: number,
  _height: number,
  style: 'single' | 'double' | 'rounded' = 'single'
): { top: string; bottom: string; left: string; right: string } {
  const cornerSet =
    style === 'double'
      ? borders.double
      : style === 'rounded'
        ? { ...borders.corners, ...borders.rounded }
        : borders.corners;

  const horizontal =
    style === 'double' ? borders.double.horizontal : borders.horizontal;
  const vertical =
    style === 'double' ? borders.double.vertical : borders.vertical;

  const horizontalLine = horizontal.repeat(width);

  return {
    top: `${cornerSet.topLeft}${horizontalLine}${cornerSet.topRight}`,
    bottom: `${cornerSet.bottomLeft}${horizontalLine}${cornerSet.bottomRight}`,
    left: vertical,
    right: vertical,
  };
}

/**
 * Truncate text to fit within a specified width, adding ellipsis if needed.
 *
 * @param text - Text to truncate
 * @param maxWidth - Maximum width in characters
 * @param ellipsis - Ellipsis string to append (defaults to '...')
 * @returns Truncated text
 *
 * @example
 * ```ts
 * const truncated = truncateText('Very long filename.txt', 15);
 * // Returns: 'Very long fi...'
 * ```
 */
export function truncateText(
  text: string,
  maxWidth: number,
  ellipsis: string = '...'
): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= ellipsis.length) return ellipsis.slice(0, maxWidth);
  return text.slice(0, maxWidth - ellipsis.length) + ellipsis;
}

/**
 * Pad text to a specified width.
 *
 * @param text - Text to pad
 * @param width - Target width
 * @param align - Alignment ('left' | 'right' | 'center')
 * @param padChar - Character to use for padding (defaults to space)
 * @returns Padded text
 */
export function padText(
  text: string,
  width: number,
  align: 'left' | 'right' | 'center' = 'left',
  padChar: string = ' '
): string {
  if (text.length >= width) return text;

  const padding = width - text.length;

  switch (align) {
    case 'right':
      return padChar.repeat(padding) + text;
    case 'center': {
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return padChar.repeat(leftPad) + text + padChar.repeat(rightPad);
    }
    default:
      return text + padChar.repeat(padding);
  }
}
