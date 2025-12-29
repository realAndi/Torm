/**
 * Theme system for the Torm TUI.
 *
 * This module re-exports all theme-related constants and utilities
 * for use throughout the UI components.
 *
 * @module ui/theme
 *
 * @example
 * ```ts
 * import { colors, statusColors, dimensions, borders } from '../theme';
 *
 * // Use in Ink components
 * <Text color={colors.primary}>Hello</Text>
 * <Text color={getStatusColor('downloading')}>Downloading...</Text>
 * ```
 */

// Color palette and status colors
export {
  colors,
  statusColors,
  labelColors,
  defaultLabelColor,
  getStatusColor,
  getProgressColor,
  getSpeedColor,
  getLabelColor,
  type Color,
  type StatusColor,
} from './colors.js';

// Layout dimensions and styling constants
export {
  dimensions,
  borders,
  progressChars,
  symbols,
  createHorizontalLine,
  createBoxFrame,
  truncateText,
  padText,
  type Dimension,
} from './styles.js';
