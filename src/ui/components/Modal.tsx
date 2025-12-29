import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, borders } from '../theme/index.js';

export interface ModalProps {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
  minHeight?: number;
}

export const Modal: React.FC<ModalProps> = ({
  visible,
  title,
  children,
  onClose,
  width = 60,
  minHeight,
}) => {
  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
      }
    },
    { isActive: visible }
  );

  if (!visible) {
    return null;
  }

  const innerWidth = width - 2; // width minus left/right borders

  // Build top border with embedded title: ╭── Title ─────────╮
  const titleText = ` ${title} `;
  const leftDash = borders.horizontal.repeat(2);
  const rightDashLen = Math.max(0, innerWidth - 2 - titleText.length);
  const rightDash = borders.horizontal.repeat(rightDashLen);

  // Bottom border
  const bottomLine = borders.horizontal.repeat(innerWidth);

  return (
    <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
      {/* Top border with title */}
      <Text>
        <Text color={colors.border}>{borders.rounded.topLeft}</Text>
        <Text color={colors.border}>{leftDash}</Text>
        <Text color={colors.primary} bold>
          {titleText}
        </Text>
        <Text color={colors.border}>{rightDash}</Text>
        <Text color={colors.border}>{borders.rounded.topRight}</Text>
      </Text>

      {/* Content area with side borders using Ink's borderStyle */}
      <Box
        flexDirection="column"
        width={width}
        minHeight={minHeight ? minHeight - 2 : undefined}
        borderStyle="round"
        borderColor={colors.border}
        borderTop={false}
        borderBottom={false}
        paddingX={1}
        paddingY={1}
      >
        {children}
      </Box>

      {/* Bottom border */}
      <Text>
        <Text color={colors.border}>{borders.rounded.bottomLeft}</Text>
        <Text color={colors.border}>{bottomLine}</Text>
        <Text color={colors.border}>{borders.rounded.bottomRight}</Text>
      </Text>
    </Box>
  );
};

export default Modal;
