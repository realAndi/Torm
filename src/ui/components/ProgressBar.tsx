import React from 'react';
import { Box, Text } from 'ink';
import { colors, progressChars } from '../theme/index.js';

export interface ProgressBarProps {
  /** Progress value between 0 and 1 */
  progress: number;
  /** Width of the bar in characters (default: 10) */
  width?: number;
  /** Whether to show percentage text after the bar (default: true) */
  showPercentage?: boolean;
}

/**
 * Visual progress indicator component
 *
 * Displays a progress bar using filled (█) and empty (░) blocks,
 * with an optional percentage text.
 *
 * @example
 * <ProgressBar progress={0.4} width={10} />
 * // Output: "████░░░░░░ 40%"
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  width = 10,
  showPercentage = true,
}) => {
  // Clamp progress between 0 and 1
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Calculate filled and empty character counts
  const filledCount = Math.round(clampedProgress * width);
  const emptyCount = width - filledCount;

  // Build the bar strings
  const filledBar = progressChars.filled.repeat(filledCount);
  const emptyBar = progressChars.empty.repeat(emptyCount);

  // Calculate percentage for display (only show 100% when truly complete)
  const percentage =
    clampedProgress >= 1 ? 100 : Math.floor(clampedProgress * 100);

  return (
    <Box>
      <Text color={colors.primary}>{filledBar}</Text>
      <Text color={colors.muted}>{emptyBar}</Text>
      {showPercentage && (
        <Text color={colors.muted}> {percentage.toString().padStart(3)}%</Text>
      )}
    </Box>
  );
};

export default ProgressBar;
