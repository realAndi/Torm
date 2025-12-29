import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { colors } from '../theme/index.js';

/**
 * Mascot expression types
 */
export type MascotExpression =
  | 'default'   // Normal happy face
  | 'blink'     // Eyes closed briefly
  | 'dead'      // X eyes, connection lost or dead torrent
  | 'celebrate' // Excited face, download complete
  | 'drool'     // Tearful, deleted while seeding < 1 min
  | 'sleep';    // Sleeping with Z's

export interface MascotProps {
  /** Current expression to display */
  expression?: MascotExpression;
  /** Whether mascot should auto-blink */
  enableBlink?: boolean;
  /** Whether to show sleeping state (overrides other expressions after idle) */
  isSleeping?: boolean;
  /** Number of Z's to show (0-3) when sleeping */
  sleepZCount?: number;
  /** Whether downloads are active (affects blink frequency) */
  isDownloading?: boolean;
}

/**
 * ASCII art mascot expressions
 */
const EXPRESSIONS = {
  default: [
    '   █████   ',
    '▐█▀▀▀▀▀▀▀█▌',
    '▐▌ ■   ■ ▐▌',
    '▐▌   U   ▐▌',
    '▀▀▀▀▀▀▀▀▀▀▀',
  ],
  blink: [
    '   █████   ',
    '▐█▀▀▀▀▀▀▀█▌',
    '▐▌ ─   ─ ▐▌',
    '▐▌   U   ▐▌',
    '▀▀▀▀▀▀▀▀▀▀▀',
  ],
  dead: [
    '   █████   ',
    '▐█▀▀▀▀▀▀▀█▌',
    '▐▌ x   x ▐▌',
    '▐▌   ∙   ▐▌',
    '▀▀▀▀▀▀▀▀▀▀▀',
  ],
  celebrate: [
    '   █████   ',
    '▐█▀▀▀▀▀▀▀█▌',
    '▐▌ >   < ▐▌',
    '▐▌   U   ▐▌',
    '▀▀▀▀▀▀▀▀▀▀▀',
  ],
  drool: [
    '   █████   ',
    '▐█▀▀▀▀▀▀▀█▌',
    '▐▌ ■   ■ ▐▌',
    '▐▌ ░ ∩ ░ ▐▌',
    '▀▀▀▀▀▀▀▀▀▀▀',
  ],
  sleep: [
    '   █████   ',
    '▐█▀▀▀▀▀▀▀█▌',
    '▐▌ -   - ▐▌',
    '▐▌   .   ▐▌',
    '▀▀▀▀▀▀▀▀▀▀▀',
  ],
};

/**
 * Z positions for sleep animation (relative to mascot)
 * Each Z appears progressively higher and to the right
 */
const Z_POSITIONS = [
  { row: 2, col: 2 },  // First Z: close to face
  { row: 1, col: 4 },  // Second Z: higher and right
  { row: 0, col: 6 },  // Third Z: highest and furthest right
];

/**
 * Mascot component with dynamic expressions
 *
 * Displays an ASCII art mascot that can show different expressions
 * based on application state. Supports auto-blinking and sleeping
 * animations.
 */
export const Mascot: React.FC<MascotProps> = ({
  expression = 'default',
  enableBlink = true,
  isSleeping = false,
  sleepZCount = 0,
  isDownloading = false,
}) => {
  const [isBlinking, setIsBlinking] = useState(false);
  const blinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-blink effect
  useEffect(() => {
    if (!enableBlink || isSleeping) {
      return;
    }

    const scheduleBlink = () => {
      // Blink every 30 seconds while downloading, otherwise random 2-6 seconds
      const nextBlink = isDownloading ? 30000 : 2000 + Math.random() * 4000;
      blinkTimeoutRef.current = setTimeout(() => {
        setIsBlinking(true);
        // Blink duration: 100-200ms
        setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 100 + Math.random() * 100);
      }, nextBlink);
    };

    scheduleBlink();

    return () => {
      if (blinkTimeoutRef.current) {
        clearTimeout(blinkTimeoutRef.current);
      }
    };
  }, [enableBlink, isSleeping, isDownloading]);

  // Determine which expression to show
  let currentExpression = expression;
  if (isSleeping) {
    currentExpression = 'sleep';
  } else if (isBlinking && expression === 'default') {
    currentExpression = 'blink';
  }

  const lines = EXPRESSIONS[currentExpression];

  // Build Z overlay for sleeping
  const zOverlay: string[] = [];
  if (isSleeping && sleepZCount > 0) {
    // Create empty lines for Z overlay
    for (let i = 0; i < 5; i++) {
      zOverlay.push('      '); // 6 chars wide for Z positions
    }

    // Place Z's based on sleepZCount
    for (let i = 0; i < Math.min(sleepZCount, 3); i++) {
      const pos = Z_POSITIONS[i];
      const line = zOverlay[pos.row].split('');
      line[pos.col] = 'Z';
      zOverlay[pos.row] = line.join('');
    }
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Box key={index} flexDirection="row">
          <Text color={colors.primary}>{line}</Text>
          {isSleeping && sleepZCount > 0 && zOverlay[index] && (
            <Text color={colors.primary}>{zOverlay[index]}</Text>
          )}
        </Box>
      ))}
      {/* Empty line for spacing like original */}
      <Text> </Text>
    </Box>
  );
};

export default Mascot;
