import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../theme/index.js';

/**
 * Props for the Checkbox component.
 */
export interface CheckboxProps {
  /** Whether the checkbox is checked */
  checked: boolean;
  /** Callback when the checkbox state changes */
  onChange: (checked: boolean) => void;
  /** Label text displayed next to the checkbox */
  label: string;
  /** Whether the checkbox is currently focused for keyboard input */
  focused?: boolean;
}

/**
 * Checkbox component for the Torm TUI.
 *
 * Displays an interactive checkbox with a label that can be toggled
 * using Space or Enter when focused. The checkbox shows a checkmark
 * when checked and an empty box when unchecked.
 *
 * @example
 * ```tsx
 * const [checked, setChecked] = useState(false);
 *
 * <Checkbox
 *   checked={checked}
 *   onChange={setChecked}
 *   label="Enable feature"
 *   focused={true}
 * />
 * // Output when unchecked: [ ] Enable feature
 * // Output when checked:   [✓] Enable feature
 * ```
 *
 * @example
 * ```tsx
 * // Multiple checkboxes with focus management
 * const [focusIndex, setFocusIndex] = useState(0);
 * const options = ['Option 1', 'Option 2', 'Option 3'];
 *
 * {options.map((option, index) => (
 *   <Checkbox
 *     key={option}
 *     checked={selected.includes(option)}
 *     onChange={(checked) => toggleOption(option, checked)}
 *     label={option}
 *     focused={focusIndex === index}
 *   />
 * ))}
 * ```
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  focused = false,
}) => {
  // Handle keyboard input when focused
  useInput(
    (input) => {
      // Toggle on Space only (Enter is reserved for form submission)
      if (input === ' ') {
        onChange(!checked);
      }
    },
    { isActive: focused }
  );

  // Render the checkbox indicator
  const checkIndicator = checked ? '✓' : ' ';

  return (
    <Box flexDirection="row">
      <Text>
        <Text color={focused ? colors.primary : colors.muted}>[</Text>
        <Text color={checked ? colors.success : undefined}>
          {checkIndicator}
        </Text>
        <Text color={focused ? colors.primary : colors.muted}>]</Text>{' '}
        <Text color={focused ? colors.primary : undefined} bold={focused}>
          {label}
        </Text>
      </Text>
    </Box>
  );
};

export default Checkbox;
