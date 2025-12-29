import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../theme/index.js';
import { Modal } from './Modal.js';
import { Checkbox } from './Checkbox.js';

/**
 * Props for the ConfirmDialog component.
 */
export interface ConfirmDialogProps {
  /** Whether the dialog is visible */
  visible: boolean;
  /** Title displayed in the dialog header */
  title: string;
  /** Message displayed in the dialog body */
  message: string;
  /** Label for the confirm button (default: "Confirm") */
  confirmLabel?: string;
  /** Label for the cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** If true, confirm hint is displayed in red */
  destructive?: boolean;
  /** Callback when confirm action is triggered */
  onConfirm: () => void;
  /** Callback when cancel action is triggered */
  onCancel: () => void;
  /** Optional: Label for checkbox option */
  checkboxLabel?: string;
  /** Optional: Current checkbox value */
  checkboxValue?: boolean;
  /** Optional: Callback when checkbox is toggled */
  onCheckboxChange?: (checked: boolean) => void;
}

/**
 * ConfirmDialog component for the Torm TUI.
 *
 * Displays a modal dialog with a confirmation message, optional checkbox,
 * and keyboard hints for confirm/cancel actions.
 *
 * @example
 * ```tsx
 * <ConfirmDialog
 *   visible={showDialog}
 *   title="Delete Torrent"
 *   message='Delete "ubuntu-24.04.iso"?'
 *   confirmLabel="Delete"
 *   cancelLabel="Cancel"
 *   destructive={true}
 *   onConfirm={() => handleDelete()}
 *   onCancel={() => setShowDialog(false)}
 *   checkboxLabel="Also delete downloaded files"
 *   checkboxValue={deleteFiles}
 *   onCheckboxChange={setDeleteFiles}
 * />
 * ```
 *
 * Keyboard controls:
 * - Enter: Confirm action
 * - Escape: Cancel action
 * - Space: Toggle checkbox (when checkbox is present)
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  checkboxLabel,
  checkboxValue = false,
  onCheckboxChange,
}) => {
  // Handle keyboard input for confirm action
  useInput(
    (input, key) => {
      if (key.return) {
        onConfirm();
      }
      // Space toggles checkbox if present
      if (input === ' ' && checkboxLabel && onCheckboxChange) {
        onCheckboxChange(!checkboxValue);
      }
    },
    { isActive: visible }
  );

  // Determine confirm hint color based on destructive prop
  const confirmColor = destructive ? colors.error : colors.primary;

  // Check if checkbox should be displayed
  const hasCheckbox = checkboxLabel !== undefined;

  return (
    <Modal visible={visible} title={title} onClose={onCancel}>
      <Box flexDirection="column">
        {/* Message */}
        <Text>{message}</Text>

        {/* Optional checkbox */}
        {hasCheckbox && (
          <Box marginTop={1}>
            <Checkbox
              checked={checkboxValue}
              onChange={onCheckboxChange ?? (() => {})}
              label={checkboxLabel}
              focused={true}
            />
          </Box>
        )}

        {/* Keyboard hints */}
        <Box marginTop={1}>
          <Text>
            <Text color={colors.muted}>[</Text>
            <Text>Enter</Text>
            <Text color={colors.muted}>]</Text>{' '}
            <Text color={confirmColor}>{confirmLabel}</Text>
            {'    '}
            {hasCheckbox && (
              <>
                <Text color={colors.muted}>[</Text>
                <Text>Space</Text>
                <Text color={colors.muted}>]</Text>{' '}
                <Text color={colors.muted}>Toggle</Text>
                {'    '}
              </>
            )}
            <Text color={colors.muted}>[</Text>
            <Text>Esc</Text>
            <Text color={colors.muted}>]</Text>{' '}
            <Text color={colors.muted}>{cancelLabel}</Text>
          </Text>
        </Box>
      </Box>
    </Modal>
  );
};

export default ConfirmDialog;
