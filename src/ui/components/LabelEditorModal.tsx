import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, getLabelColor } from '../theme/index.js';
import { Modal } from './Modal.js';
import { TextInput } from './TextInput.js';
import { LabelBadge } from './LabelBadge.js';

/**
 * Props for the LabelEditorModal component.
 */
export interface LabelEditorModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Name of the torrent being edited */
  torrentName: string;
  /** Current labels on the torrent */
  currentLabels: string[];
  /** All existing labels across all torrents (for suggestions) */
  existingLabels: string[];
  /** Callback fired when labels are saved */
  onSave: (labels: string[]) => void;
  /** Callback fired when the modal should close */
  onClose: () => void;
}

/**
 * LabelEditorModal component for Torm TUI
 *
 * A modal dialog for editing labels on a torrent. Allows adding new labels
 * by typing and pressing Enter, or removing existing labels.
 *
 * Features:
 * - Text input for adding new labels
 * - Display of current labels with ability to remove
 * - Suggestions from existing labels across all torrents
 * - Comma-separated input for adding multiple labels at once
 * - Visual preview of label colors
 *
 * Keyboard shortcuts:
 * - Enter: Add the typed label(s)
 * - Escape: Close without saving
 * - Tab: Cycle through suggestions
 * - Ctrl+S or Enter (when input empty): Save and close
 *
 * @example
 * ```tsx
 * <LabelEditorModal
 *   visible={showModal}
 *   torrentName="ubuntu-24.04.iso"
 *   currentLabels={['linux', 'iso']}
 *   existingLabels={['movies', 'music', 'linux', 'iso']}
 *   onSave={(labels) => {
 *     updateLabels(torrentId, labels);
 *   }}
 *   onClose={() => setShowModal(false)}
 * />
 * ```
 */
export const LabelEditorModal: React.FC<LabelEditorModalProps> = ({
  visible,
  torrentName,
  currentLabels,
  existingLabels,
  onSave,
  onClose,
}) => {
  // Local state for labels being edited
  const [labels, setLabels] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedLabelIndex, setSelectedLabelIndex] = useState<number | null>(
    null
  );

  // Reset state when modal opens/closes
  useEffect(() => {
    if (visible) {
      setLabels([...currentLabels]);
      setInputValue('');
      setSelectedLabelIndex(null);
    }
  }, [visible, currentLabels]);

  // Filter suggestions based on input and exclude already-added labels
  const suggestions = useMemo(() => {
    if (inputValue.length === 0) {
      return existingLabels.filter((l) => !labels.includes(l)).slice(0, 5);
    }
    const normalized = inputValue.toLowerCase().trim();
    return existingLabels
      .filter((l) => l.includes(normalized) && !labels.includes(l))
      .slice(0, 5);
  }, [inputValue, existingLabels, labels]);

  /**
   * Add a label to the list
   */
  const addLabel = (label: string) => {
    const normalized = label.trim().toLowerCase();
    if (normalized.length > 0 && !labels.includes(normalized)) {
      setLabels((prev) => [...prev, normalized]);
    }
  };

  /**
   * Remove a label from the list
   */
  const removeLabel = (label: string) => {
    setLabels((prev) => prev.filter((l) => l !== label));
    setSelectedLabelIndex(null);
  };

  /**
   * Handle adding labels from input
   */
  const handleAddFromInput = () => {
    // Split by comma for multiple labels
    const newLabels = inputValue
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l.length > 0);

    for (const label of newLabels) {
      addLabel(label);
    }
    setInputValue('');
  };

  /**
   * Handle save action
   */
  const handleSave = () => {
    // Add any pending input before saving
    if (inputValue.trim().length > 0) {
      handleAddFromInput();
    }
    onSave(labels);
  };

  // Handle keyboard input
  useInput(
    (input, key) => {
      // Submit input on Enter
      if (key.return) {
        if (inputValue.trim().length > 0) {
          handleAddFromInput();
        } else {
          // Save when Enter pressed with empty input
          handleSave();
        }
        return;
      }

      // Navigate through existing labels with Tab
      if (key.tab && labels.length > 0) {
        if (selectedLabelIndex === null) {
          setSelectedLabelIndex(0);
        } else {
          setSelectedLabelIndex((prev) =>
            prev === null ? 0 : (prev + 1) % labels.length
          );
        }
        return;
      }

      // Delete selected label with Backspace (when input is empty)
      if (
        (key.backspace || key.delete) &&
        inputValue.length === 0 &&
        selectedLabelIndex !== null
      ) {
        removeLabel(labels[selectedLabelIndex]);
        return;
      }

      // Remove last label with Backspace when input is empty and no selection
      if (
        (key.backspace || key.delete) &&
        inputValue.length === 0 &&
        labels.length > 0 &&
        selectedLabelIndex === null
      ) {
        setSelectedLabelIndex(labels.length - 1);
        return;
      }

      // Clear selection when typing
      if (input && input.length > 0 && selectedLabelIndex !== null) {
        setSelectedLabelIndex(null);
      }

      // Ctrl+S to save
      if (key.ctrl && input === 's') {
        handleSave();
        return;
      }
    },
    { isActive: visible }
  );

  // Truncate torrent name for display
  const displayName =
    torrentName.length > 40 ? torrentName.slice(0, 39) + '\u2026' : torrentName;

  return (
    <Modal visible={visible} title="Edit Labels" onClose={onClose} width={55}>
      <Box flexDirection="column" gap={1}>
        {/* Torrent name */}
        <Text color={colors.muted}>{displayName}</Text>

        {/* Current labels */}
        <Box flexDirection="column">
          <Text bold>Current Labels:</Text>
          {labels.length === 0 ? (
            <Text color={colors.muted}>No labels</Text>
          ) : (
            <Box flexWrap="wrap" gap={1}>
              {labels.map((label, index) => (
                <Text key={label}>
                  <Text
                    inverse={selectedLabelIndex === index}
                    color={
                      selectedLabelIndex === index
                        ? undefined
                        : getLabelColor(label)
                    }
                  >
                    [{label}]
                  </Text>
                  {selectedLabelIndex === index && (
                    <Text color={colors.muted}> (Backspace to remove)</Text>
                  )}
                </Text>
              ))}
            </Box>
          )}
        </Box>

        {/* Input field */}
        <Box flexDirection="column">
          <Text>Add label (comma-separated for multiple):</Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleAddFromInput}
            placeholder="Type label name..."
            width={49}
            focused={visible}
          />
        </Box>

        {/* Suggestions */}
        {suggestions.length > 0 && inputValue.length > 0 && (
          <Box flexDirection="column">
            <Text color={colors.muted}>Suggestions:</Text>
            <Box gap={1}>
              {suggestions.map((suggestion) => (
                <LabelBadge key={suggestion} label={suggestion} />
              ))}
            </Box>
          </Box>
        )}

        {/* Action hints */}
        <Box gap={2} marginTop={1}>
          <Text>
            <Text color={colors.primary} bold>
              [Enter]
            </Text>
            <Text> {inputValue ? 'Add' : 'Save'}</Text>
          </Text>
          <Text>
            <Text color={colors.primary} bold>
              [Tab]
            </Text>
            <Text> Select label</Text>
          </Text>
          <Text>
            <Text color={colors.primary} bold>
              [Esc]
            </Text>
            <Text> Cancel</Text>
          </Text>
        </Box>
      </Box>
    </Modal>
  );
};

export default LabelEditorModal;
