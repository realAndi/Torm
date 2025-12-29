import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, borders } from '../theme/index.js';

export interface HelpOverlayProps {
  /** Whether the overlay is visible */
  visible: boolean;
  /** Callback when overlay should close */
  onClose: () => void;
}

/**
 * Keyboard shortcut entry for display
 */
interface ShortcutEntry {
  key: string;
  description: string;
}

/**
 * Section of related shortcuts
 */
interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

/**
 * All keyboard shortcuts organized by section
 */
const shortcutSections: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { key: '\u2191/k', description: 'Select previous' },
      { key: '\u2193/j', description: 'Select next' },
      { key: 'Enter', description: 'Open details' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { key: 'p', description: 'Pause torrent' },
      { key: 'r', description: 'Resume torrent' },
      { key: 'd', description: 'Delete torrent' },
      { key: 'a', description: 'Add torrent' },
      { key: 'l', description: 'Edit labels' },
      { key: 's', description: 'Settings' },
    ],
  },
  {
    title: 'Global',
    shortcuts: [
      { key: '?', description: 'Toggle this help' },
      { key: 'q/Ctrl+C', description: 'Quit' },
    ],
  },
];

/** Width of the modal content area (excluding borders) */
const MODAL_WIDTH = 37;

/**
 * HelpOverlay component for Torm TUI
 *
 * Displays a modal overlay with keyboard shortcuts organized by section.
 * The overlay captures any keypress to close itself.
 *
 * @example
 * <HelpOverlay visible={showHelp} onClose={() => setShowHelp(false)} />
 */
export const HelpOverlay: React.FC<HelpOverlayProps> = ({ visible, onClose }) => {
  // Capture any keypress to close the overlay
  useInput(
    () => {
      onClose();
    },
    { isActive: visible }
  );

  // Return null when not visible
  if (!visible) {
    return null;
  }

  const horizontalLine = borders.horizontal.repeat(MODAL_WIDTH);

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
    >
      <Box flexDirection="column">
        {/* Top border with title */}
        <Text>
          {borders.corners.topLeft}
          {horizontalLine}
          {borders.corners.topRight}
        </Text>

        {/* Title row */}
        <Text>
          {borders.vertical}
          <Text color={colors.primary} bold>
            {'          Keyboard Shortcuts         '}
          </Text>
          {borders.vertical}
        </Text>

        {/* Title separator */}
        <Text>
          {borders.junctions.left}
          {horizontalLine}
          {borders.junctions.right}
        </Text>

        {/* Shortcut sections */}
        {shortcutSections.map((section, sectionIndex) => (
          <React.Fragment key={section.title}>
            {/* Section header */}
            <Text>
              {borders.vertical}
              {'  '}
              <Text color={colors.primary} bold>
                {section.title.padEnd(MODAL_WIDTH - 2)}
              </Text>
              {borders.vertical}
            </Text>

            {/* Shortcuts in section */}
            {section.shortcuts.map((shortcut) => (
              <Text key={shortcut.key}>
                {borders.vertical}
                {'    '}
                <Text color={colors.muted}>{shortcut.key.padEnd(8)}</Text>
                <Text>{shortcut.description.padEnd(MODAL_WIDTH - 12)}</Text>
                {borders.vertical}
              </Text>
            ))}

            {/* Empty line after each section except the last */}
            {sectionIndex < shortcutSections.length - 1 && (
              <Text>
                {borders.vertical}
                {' '.repeat(MODAL_WIDTH)}
                {borders.vertical}
              </Text>
            )}
          </React.Fragment>
        ))}

        {/* Empty line before footer */}
        <Text>
          {borders.vertical}
          {' '.repeat(MODAL_WIDTH)}
          {borders.vertical}
        </Text>

        {/* Footer hint */}
        <Text>
          {borders.vertical}
          <Text color={colors.muted}>
            {'        Press any key to close       '}
          </Text>
          {borders.vertical}
        </Text>

        {/* Bottom border */}
        <Text>
          {borders.corners.bottomLeft}
          {horizontalLine}
          {borders.corners.bottomRight}
        </Text>
      </Box>
    </Box>
  );
};

export default HelpOverlay;
