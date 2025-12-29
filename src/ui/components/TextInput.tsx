import React, { useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, borders } from '../theme/index.js';

/**
 * Props for the TextInput component.
 */
export interface TextInputProps {
  /** Current value of the input */
  value: string;
  /** Callback fired when the value changes */
  onChange: (value: string) => void;
  /** Callback fired when Enter is pressed */
  onSubmit?: () => void;
  /** Placeholder text shown when input is empty */
  placeholder?: string;
  /** Width of the input box (including borders) */
  width?: number;
  /** Whether the input is focused and accepting input */
  focused?: boolean;
}

/** Cursor character displayed at the end of input text */
const CURSOR_CHAR = '▌';

/**
 * TextInput component for Torm TUI
 *
 * A controlled text input field with cursor display, placeholder support,
 * and visual focus indication. Uses Ink's useInput hook for keyboard handling.
 *
 * Features:
 * - Cursor display using block character
 * - Backspace/delete support for character removal
 * - Enter key support for form submission
 * - Placeholder text when empty
 * - Visual focus indicator via border color
 *
 * @example
 * ```tsx
 * const [value, setValue] = useState('');
 *
 * <TextInput
 *   value={value}
 *   onChange={setValue}
 *   onSubmit={() => handleSubmit(value)}
 *   placeholder="Enter magnet link..."
 *   width={50}
 *   focused={true}
 * />
 * ```
 *
 * Layout:
 * ```
 * ┌───────────────────────────────────────────┐
 * │ magnet:?xt=urn:btih:...▌                  │
 * └───────────────────────────────────────────┘
 * ```
 */
export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  width = 40,
  focused = false,
}) => {
  // Use refs to avoid stale closure issues in useInput callback
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  // Handle keyboard input when focused
  useInput(
    (input, key) => {
      // Handle Enter key for submission
      if (key.return && onSubmitRef.current) {
        onSubmitRef.current();
        return;
      }

      // Handle backspace/delete
      if (key.backspace || key.delete) {
        if (valueRef.current.length > 0) {
          const newValue = valueRef.current.slice(0, -1);
          valueRef.current = newValue; // Update immediately for fast typing
          onChangeRef.current(newValue);
        }
        return;
      }

      // Ignore control keys and special keys
      if (
        key.ctrl ||
        key.meta ||
        key.escape ||
        key.upArrow ||
        key.downArrow ||
        key.leftArrow ||
        key.rightArrow ||
        key.tab
      ) {
        return;
      }

      // Append printable characters
      if (input && input.length > 0) {
        const newValue = valueRef.current + input;
        valueRef.current = newValue; // Update immediately for fast typing
        onChangeRef.current(newValue);
      }
    },
    { isActive: focused }
  );

  // Calculate inner width (accounting for borders and padding)
  const innerWidth = Math.max(width - 4, 1); // 2 for borders, 2 for padding

  // Determine display content
  const isEmpty = value.length === 0;
  const displayText = isEmpty ? placeholder : value;

  // Calculate visible portion of text (with cursor space if focused)
  const cursorSpace = focused ? 1 : 0;
  const maxVisibleLength = innerWidth - cursorSpace;
  const visibleText =
    displayText.length > maxVisibleLength
      ? displayText.slice(displayText.length - maxVisibleLength)
      : displayText;

  // Create padding to fill remaining width
  const textLength = visibleText.length + cursorSpace;
  const paddingLength = Math.max(0, innerWidth - textLength);
  const padding = ' '.repeat(paddingLength);

  // Border color based on focus state
  const borderColor = focused ? colors.primary : colors.muted;

  // Create horizontal border line
  const horizontalLine = borders.horizontal.repeat(width - 2);

  // Build complete strings for each line to avoid wrapping issues
  const topBorder = `${borders.rounded.topLeft}${horizontalLine}${borders.rounded.topRight}`;
  const bottomBorder = `${borders.rounded.bottomLeft}${horizontalLine}${borders.rounded.bottomRight}`;

  // Build middle line as single string
  const contentText = isEmpty ? visibleText : visibleText;
  const cursorChar = focused ? CURSOR_CHAR : '';
  const middleContent = ` ${contentText}${cursorChar}${padding} `;

  return (
    <Box flexDirection="column" width={width}>
      {/* Top border */}
      <Text wrap="truncate">
        <Text color={borderColor}>{topBorder}</Text>
      </Text>

      {/* Input content row */}
      <Text wrap="truncate">
        <Text color={borderColor}>{borders.vertical}</Text>
        <Text color={isEmpty ? colors.muted : undefined}>{middleContent}</Text>
        <Text color={borderColor}>{borders.vertical}</Text>
      </Text>

      {/* Bottom border */}
      <Text wrap="truncate">
        <Text color={borderColor}>{bottomBorder}</Text>
      </Text>
    </Box>
  );
};

export default TextInput;
