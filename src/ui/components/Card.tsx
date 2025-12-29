import React from 'react';
import { Box, Text } from 'ink';
import { colors, borders } from '../theme/index.js';

export interface CardProps {
  /** Content to render inside the card */
  children: React.ReactNode;
  /** Optional title for the card header */
  title?: string;
  /** Card width (default: 100%) */
  width?: number | string;
  /** Border style */
  borderStyle?: 'single' | 'rounded' | 'double';
  /** Border color */
  borderColor?: string;
  /** Padding inside the card */
  padding?: number;
  /** Whether to show shadow effect */
  shadow?: boolean;
}

/**
 * Card component for consistent box styling throughout the UI.
 * Provides bordered containers with optional titles and various styles.
 */
export const Card: React.FC<CardProps> = ({
  children,
  title,
  width,
  borderStyle = 'rounded',
  borderColor = colors.muted,
  padding = 1,
  shadow = false,
}) => {
  const cornerSet =
    borderStyle === 'double'
      ? borders.double
      : borderStyle === 'rounded'
        ? borders.rounded
        : borders.corners;

  const horizontal =
    borderStyle === 'double' ? borders.double.horizontal : borders.horizontal;
  const vertical =
    borderStyle === 'double' ? borders.double.vertical : borders.vertical;

  return (
    <Box flexDirection="column" width={width}>
      {/* Top border with optional title */}
      <Text color={borderColor}>
        {cornerSet.topLeft}
        {title ? (
          <>
            {horizontal}
            <Text color={colors.primary} bold>
              {` ${title} `}
            </Text>
            {horizontal.repeat(10)}
          </>
        ) : (
          horizontal.repeat(20)
        )}
        {cornerSet.topRight}
      </Text>

      {/* Content area */}
      <Box flexDirection="row">
        <Text color={borderColor}>{vertical}</Text>
        <Box flexDirection="column" paddingX={padding} flexGrow={1}>
          {children}
        </Box>
        <Text color={borderColor}>{vertical}</Text>
        {shadow && <Text color={colors.muted}> </Text>}
      </Box>

      {/* Bottom border */}
      <Box>
        <Text color={borderColor}>
          {cornerSet.bottomLeft}
          {horizontal.repeat(20)}
          {cornerSet.bottomRight}
        </Text>
        {shadow && <Text color={colors.muted}> </Text>}
      </Box>
    </Box>
  );
};

export default Card;
