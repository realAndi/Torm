/**
 * BatchAddModal - Modal for adding multiple .torrent files at once.
 *
 * This modal is shown when multiple .torrent files are drag-and-dropped
 * into the TUI. It displays all files that will be added and allows
 * the user to select a common download path.
 *
 * @module ui/components/BatchAddModal
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { basename } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { colors } from '../theme/index.js';
import { Modal } from './Modal.js';
import { DirectoryBrowser } from './DirectoryBrowser.js';

function getDefaultDownloadsPath(): string {
  return join(homedir(), 'Downloads');
}

export interface BatchAddModalProps {
  visible: boolean;
  /** List of .torrent file paths to add */
  files: string[];
  /** Called when user confirms adding all files */
  onAdd: (files: string[], downloadPath: string) => void;
  /** Called when user cancels or closes the modal */
  onClose: () => void;
  /** Default download path from settings */
  defaultDownloadPath?: string;
}

interface FileValidation {
  path: string;
  name: string;
  exists: boolean;
}

/**
 * Validate that files exist and extract names
 */
function validateFiles(files: string[]): FileValidation[] {
  return files.map((path) => ({
    path,
    name: basename(path),
    exists: existsSync(path),
  }));
}

export const BatchAddModal: React.FC<BatchAddModalProps> = ({
  visible,
  files,
  onAdd,
  onClose,
  defaultDownloadPath,
}) => {
  const [downloadPath, setDownloadPath] = useState('');
  const [activeField, setActiveField] = useState<'list' | 'path'>('list');
  const [scrollOffset, setScrollOffset] = useState(0);
  const wasVisible = useRef(false);

  // Get the effective default path
  const effectiveDefaultPath = defaultDownloadPath || getDefaultDownloadsPath();

  // Validate files when they change
  const validatedFiles = validateFiles(files);
  const validFiles = validatedFiles.filter((f) => f.exists);
  const invalidFiles = validatedFiles.filter((f) => !f.exists);
  const hasValidFiles = validFiles.length > 0;

  // Maximum files to display at once
  const maxVisibleFiles = 8;
  const totalFiles = validatedFiles.length;
  const visibleFiles = validatedFiles.slice(
    scrollOffset,
    scrollOffset + maxVisibleFiles
  );
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset + maxVisibleFiles < totalFiles;

  // Reset when modal opens
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setDownloadPath(effectiveDefaultPath);
      setActiveField('list');
      setScrollOffset(0);
    } else if (!visible && wasVisible.current) {
      setDownloadPath('');
      setActiveField('list');
      setScrollOffset(0);
    }
    wasVisible.current = visible;
  }, [visible, effectiveDefaultPath]);

  const canSubmit = hasValidFiles && downloadPath.trim().length > 0;

  // Handle keyboard in list view
  useInput(
    (input, key) => {
      // Enter to submit when valid
      if (key.return && canSubmit) {
        const validPaths = validFiles.map((f) => f.path);
        onAdd(validPaths, downloadPath.trim());
        return;
      }

      // Navigate file list
      if (key.upArrow && canScrollUp) {
        setScrollOffset((prev) => Math.max(0, prev - 1));
        return;
      }

      if (key.downArrow) {
        if (activeField === 'list' && canScrollDown) {
          setScrollOffset((prev) =>
            Math.min(totalFiles - maxVisibleFiles, prev + 1)
          );
        } else if (!canScrollDown || scrollOffset + maxVisibleFiles >= totalFiles) {
          // Move to path field when at bottom of list
          setActiveField('path');
        }
        return;
      }

      // Escape to close
      if (key.escape) {
        onClose();
        return;
      }
    },
    { isActive: visible && activeField === 'list' }
  );

  // Handle escape from path field to go back to list
  const handlePathEscape = () => {
    setActiveField('list');
  };

  // Handle enter from path field to submit
  const handlePathSubmit = () => {
    if (canSubmit) {
      const validPaths = validFiles.map((f) => f.path);
      onAdd(validPaths, downloadPath.trim());
    }
  };

  const modalWidth = 72;
  const contentWidth = modalWidth - 8;

  return (
    <Modal
      visible={visible}
      title={`Add ${validFiles.length} Torrent${validFiles.length !== 1 ? 's' : ''}`}
      onClose={onClose}
      width={modalWidth}
      minHeight={14 + Math.min(totalFiles, maxVisibleFiles)}
    >
      <Box flexDirection="column" gap={1}>
        {/* Dropped indicator header */}
        <Box>
          <Text backgroundColor={colors.primary} color="#000"> DROPPED </Text>
          <Text color={colors.muted}> {totalFiles} file{totalFiles !== 1 ? 's' : ''} detected</Text>
        </Box>

        {/* Scroll up indicator */}
        {canScrollUp && (
          <Text color={colors.muted} dimColor>
            {'  '}... {scrollOffset} more above
          </Text>
        )}

        {/* File list */}
        <Box flexDirection="column">
          {visibleFiles.map((file, index) => (
            <Box key={file.path}>
              <Text color={file.exists ? colors.success : colors.error}>
                {file.exists ? ' + ' : ' x '}
              </Text>
              <Text
                color={file.exists ? undefined : colors.muted}
                dimColor={!file.exists}
                wrap="truncate"
              >
                {file.name.length > contentWidth - 4
                  ? file.name.slice(0, contentWidth - 7) + '...'
                  : file.name}
              </Text>
            </Box>
          ))}
        </Box>

        {/* Scroll down indicator */}
        {canScrollDown && (
          <Text color={colors.muted} dimColor>
            {'  '}... {totalFiles - scrollOffset - maxVisibleFiles} more below
          </Text>
        )}

        {/* Invalid files warning */}
        {invalidFiles.length > 0 && (
          <Text color={colors.warning}>
            {invalidFiles.length} file{invalidFiles.length !== 1 ? 's' : ''} not
            found (will be skipped)
          </Text>
        )}

        {/* Download path */}
        <Box marginTop={1} flexDirection="column" gap={0}>
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
        </Box>

        {/* Help text */}
        <Box marginTop={1}>
          {activeField === 'list' ? (
            <Box gap={2}>
              <Text>
                <Text color={canSubmit ? colors.primary : colors.muted} bold>
                  [Enter]
                </Text>
                <Text color={canSubmit ? undefined : colors.muted}> Add all</Text>
              </Text>
              <Text>
                <Text color={colors.muted} bold>[Down]</Text>
                <Text color={colors.muted}> Edit path</Text>
              </Text>
              <Text>
                <Text color={colors.muted} bold>[Esc]</Text>
                <Text color={colors.muted}> Cancel</Text>
              </Text>
            </Box>
          ) : (
            <Text color={colors.muted}>
              Tab/Right: complete Up/Down: select Enter: add Esc: back
            </Text>
          )}
        </Box>
      </Box>
    </Modal>
  );
};

export default BatchAddModal;
