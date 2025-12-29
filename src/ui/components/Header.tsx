import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../theme/index.js';
import { Mascot, type MascotExpression } from './Mascot.js';

/**
 * ASCII art logo for TORM
 */
const LOGO_LINES = [
  '████████╗ ██████╗ ██████╗ ███╗   ███╗',
  '╚══██╔══╝██╔═══██╗██╔══██╗████╗ ████║',
  '   ██║   ██║   ██║██████╔╝██╔████╔██║',
  '   ██║   ██║   ██║██╔══██╗██║╚██╔╝██║',
  '   ██║   ╚██████╔╝██║  ██║██║ ╚═╝ ██║',
  '   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝',
];

export interface HeaderProps {
  /** Mascot expression to display */
  mascotExpression?: MascotExpression;
  /** Whether mascot is sleeping */
  mascotSleeping?: boolean;
  /** Number of Z's to show when sleeping (0-3) */
  mascotSleepZCount?: number;
  /** Whether downloads are active */
  isDownloading?: boolean;
}

/**
 * Header component for Torm TUI
 *
 * Left-aligned ASCII art logo with animated mascot.
 */
export const Header: React.FC<HeaderProps> = ({
  mascotExpression = 'default',
  mascotSleeping = false,
  mascotSleepZCount = 0,
  isDownloading = false,
}) => {
  return (
    <Box flexDirection="row" marginBottom={1} gap={2}>
      {/* Logo */}
      <Box flexDirection="column">
        {LOGO_LINES.map((line, index) => (
          <Text key={index} color={colors.primary}>
            {line}
          </Text>
        ))}
      </Box>

      {/* Mascot */}
      <Mascot
        expression={mascotExpression}
        isSleeping={mascotSleeping}
        sleepZCount={mascotSleepZCount}
        enableBlink={!mascotSleeping}
        isDownloading={isDownloading}
      />
    </Box>
  );
};

export default Header;
