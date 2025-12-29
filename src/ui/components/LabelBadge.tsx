import React from 'react';
import { Text } from 'ink';
import { getLabelColor } from '../theme/index.js';

/**
 * Props for the LabelBadge component.
 */
export interface LabelBadgeProps {
  /** The label text to display */
  label: string;
  /** Whether the label is in a selected/highlighted row */
  isSelected?: boolean;
}

/**
 * LabelBadge component for Torm TUI
 *
 * Displays a single label as a colored tag/badge. The color is determined
 * by the label text using the predefined label color map, with a default
 * color for custom labels.
 *
 * Features:
 * - Automatic color assignment based on label text
 * - Bracket-style display: [label]
 * - Handles selected state for inverse display
 *
 * @example
 * ```tsx
 * <LabelBadge label="movies" />
 * // Renders: [movies] in blue
 *
 * <LabelBadge label="custom" />
 * // Renders: [custom] in white (default color)
 *
 * <LabelBadge label="music" isSelected={true} />
 * // Renders: [music] with inverse colors
 * ```
 */
export const LabelBadge: React.FC<LabelBadgeProps> = ({
  label,
  isSelected = false,
}) => {
  const color = getLabelColor(label);

  return (
    <Text inverse={isSelected} color={isSelected ? undefined : color}>
      [{label}]
    </Text>
  );
};

/**
 * Props for the LabelList component.
 */
export interface LabelListProps {
  /** Array of labels to display */
  labels: string[];
  /** Whether the labels are in a selected/highlighted row */
  isSelected?: boolean;
  /** Maximum number of labels to show (rest are indicated with +N) */
  maxLabels?: number;
}

/**
 * LabelList component for Torm TUI
 *
 * Displays multiple labels as a horizontal list of badges.
 * Can limit the number of displayed labels with a "+N more" indicator.
 *
 * @example
 * ```tsx
 * <LabelList labels={['movies', 'hd', '2024']} />
 * // Renders: [movies] [hd] [2024]
 *
 * <LabelList labels={['movies', 'hd', '2024', 'favorite']} maxLabels={2} />
 * // Renders: [movies] [hd] +2
 * ```
 */
export const LabelList: React.FC<LabelListProps> = ({
  labels,
  isSelected = false,
  maxLabels = 3,
}) => {
  if (labels.length === 0) {
    return null;
  }

  const displayLabels = labels.slice(0, maxLabels);
  const remaining = labels.length - maxLabels;

  return (
    <Text>
      {displayLabels.map((label, index) => (
        <Text key={label}>
          {index > 0 && ' '}
          <LabelBadge label={label} isSelected={isSelected} />
        </Text>
      ))}
      {remaining > 0 && (
        <Text inverse={isSelected} color={isSelected ? undefined : 'gray'}>
          {' '}
          +{remaining}
        </Text>
      )}
    </Text>
  );
};

export default LabelBadge;
