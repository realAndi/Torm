import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { homedir } from 'os';
import { join } from 'path';
import { colors } from '../theme/index.js';
import { Modal } from './Modal.js';
import { TextInput } from './TextInput.js';
import { DirectoryBrowser } from './DirectoryBrowser.js';
import { parsePastedPaths, filterTorrentFiles } from '../hooks/usePaste.js';

function getDefaultDownloadsPath(): string {
  return join(homedir(), 'Downloads');
}

export interface AddTorrentModalProps {
  visible: boolean;
  onAdd: (source: string, downloadPath: string) => void;
  onClose: () => void;
  /** Default download path from settings */
  defaultDownloadPath?: string;
  /** Called when multiple .torrent files are detected (drag-and-drop) */
  onBatchFiles?: (files: string[]) => void;
}

function isValidTorrentSource(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('magnet:?')) return true;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true;
  if (trimmed.endsWith('.torrent')) return true;
  return false;
}

/**
 * Expand ~ to home directory in paths
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return home + path.slice(1);
  }
  return path;
}

export const AddTorrentModal: React.FC<AddTorrentModalProps> = ({
  visible,
  onAdd,
  onClose,
  defaultDownloadPath,
  onBatchFiles,
}) => {
  const [source, setSource] = useState('');
  const [downloadPath, setDownloadPath] = useState('');
  const [activeField, setActiveField] = useState<'source' | 'path'>('source');
  const wasVisible = useRef(false);

  // Get the effective default path
  const effectiveDefaultPath = defaultDownloadPath || getDefaultDownloadsPath();

  // Reset when modal opens, restore defaults when it closes
  useEffect(() => {
    if (visible && !wasVisible.current) {
      // Modal just opened - set to defaults
      setSource('');
      setDownloadPath(effectiveDefaultPath);
      setActiveField('source');
    } else if (!visible && wasVisible.current) {
      // Modal just closed - reset state
      setSource('');
      setDownloadPath('');
      setActiveField('source');
    }
    wasVisible.current = visible;
  }, [visible, effectiveDefaultPath]);

  // Detect .torrent files in source (drag-and-drop detection)
  const handleSourceChange = useCallback((value: string) => {
    // Check if this looks like .torrent file(s) were dropped
    const paths = parsePastedPaths(value);
    const expandedPaths = paths.map(expandPath);
    const torrentFiles = filterTorrentFiles(expandedPaths);

    if (torrentFiles.length >= 1 && onBatchFiles) {
      // .torrent file(s) detected - switch to batch mode for visual feedback
      onBatchFiles(torrentFiles);
      return;
    }

    // Other input (magnet link, URL, etc.) - handle normally
    setSource(value);
  }, [onBatchFiles]);

  const isValid = isValidTorrentSource(source);
  const isEmpty = source.trim().length === 0;
  const hasPath = downloadPath.trim().length > 0;
  const canSubmit = isValid && hasPath;

  // Handle keyboard when source field is active
  useInput(
    (input, key) => {
      // Enter to submit when valid
      if (key.return && canSubmit) {
        onAdd(source.trim(), downloadPath.trim());
        return;
      }

      // Down arrow to go to path field
      if (key.downArrow) {
        setActiveField('path');
        return;
      }
    },
    { isActive: visible && activeField === 'source' }
  );

  // Handle Esc from path field to go back to source
  const handlePathEscape = () => {
    setActiveField('source');
  };

  // Handle Enter from path field to submit
  const handlePathSubmit = () => {
    if (canSubmit) {
      onAdd(source.trim(), downloadPath.trim());
    }
  };

  const modalWidth = 72;
  const contentWidth = modalWidth - 8;

  return (
    <Modal visible={visible} title="Add Torrent" onClose={onClose} width={modalWidth} minHeight={20}>
      <Box flexDirection="column" gap={1}>
        {/* Source input */}
        <Text color={activeField === 'source' ? colors.primary : colors.muted}>
          Magnet link, URL, or file path:
        </Text>
        <TextInput
          value={source}
          onChange={handleSourceChange}
          placeholder="magnet:?xt=urn:btih:..."
          width={contentWidth}
          focused={visible && activeField === 'source'}
        />

        {/* Validation hint */}
        <Text color={isEmpty ? colors.muted : isValid ? colors.success : colors.warning}>
          {isEmpty
            ? 'Paste magnet/URL, or drag .torrent files here'
            : isValid
              ? 'Valid torrent source'
              : 'Enter a magnet link, URL, or .torrent file path'}
        </Text>

        {/* Download path with DirectoryBrowser */}
        <Text color={activeField === 'path' ? colors.primary : colors.muted}>
          Download to:
        </Text>
        <DirectoryBrowser
          value={downloadPath}
          onChange={setDownloadPath}
          width={contentWidth}
          focused={visible && activeField === 'path'}
          onSubmit={handlePathSubmit}
          onNavigateUp={handlePathEscape}
        />

        {/* Contextual help text */}
        <Box marginTop={1}>
          {activeField === 'source' ? (
            <Box gap={2}>
              <Text>
                <Text color={canSubmit ? colors.primary : colors.muted} bold>[Enter]</Text>
                <Text color={canSubmit ? undefined : colors.muted}> Add</Text>
              </Text>
              <Text>
                <Text color={colors.muted} bold>[↓]</Text>
                <Text color={colors.muted}> Edit path</Text>
              </Text>
              <Text>
                <Text color={colors.muted} bold>[Esc]</Text>
                <Text color={colors.muted}> Cancel</Text>
              </Text>
            </Box>
          ) : (
            <Text color={colors.muted}>
              ↑↓: select  Tab/→: complete  Enter: add  Esc: back
            </Text>
          )}
        </Box>
      </Box>
    </Modal>
  );
};

export default AddTorrentModal;
