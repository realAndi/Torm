import React from 'react';
import { Box, Text } from 'ink';
import type { TorrentFile } from '../../engine/types.js';
import { colors, borders, progressChars } from '../theme/index.js';
import { formatBytes, formatProgress, truncateText } from '../utils/format.js';

export interface FileListProps {
  /** Array of files in the torrent */
  files: TorrentFile[];
}

/**
 * Column widths for file list display
 */
const COLUMN_WIDTHS = {
  priority: 3,
  name: 40,
  size: 10,
  progress: 12,
} as const;

/**
 * Priority display configuration
 */
const PRIORITY_DISPLAY: Record<
  number,
  { icon: string; color: string; label: string }
> = {
  0: { icon: '\u2717', color: colors.muted, label: 'Skip' }, // ✗ Skip
  1: { icon: '\u2193', color: colors.muted, label: 'Low' }, // ↓ Low
  2: { icon: '\u2022', color: colors.primary, label: 'Normal' }, // • Normal
  3: { icon: '\u2191', color: colors.success, label: 'High' }, // ↑ High
};

/**
 * Parse file path to extract directory structure
 */
function parseFilePath(path: string): { dirs: string[]; filename: string } {
  const parts = path.split('/');
  const filename = parts.pop() || path;
  return { dirs: parts, filename };
}

/**
 * Build a tree-style prefix for file display
 *
 * @param depth - Nesting depth (number of parent directories)
 * @param isLast - Whether this is the last item at this level
 */
function buildTreePrefix(depth: number, isLast: boolean = false): string {
  if (depth === 0) return '';

  const indent = '  '.repeat(depth - 1);
  const connector = isLast ? '\u2514' : '\u251c'; // └ or ├
  return `${indent}${connector}\u2500 `; // ─
}

/**
 * Create a mini progress bar for file progress
 */
function createMiniProgressBar(progress: number, width: number = 6): string {
  const filled = Math.round(progress * width);
  const empty = width - filled;
  return (
    progressChars.filled.repeat(filled) + progressChars.empty.repeat(empty)
  );
}

/**
 * Header row for file list
 */
const FileListHeader: React.FC = () => {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" paddingX={1}>
        <Box width={COLUMN_WIDTHS.priority}>
          <Text color={colors.primary} bold>
            Pri
          </Text>
        </Box>
        <Box width={COLUMN_WIDTHS.name}>
          <Text color={colors.primary} bold>
            File
          </Text>
        </Box>
        <Box width={COLUMN_WIDTHS.size} justifyContent="flex-end">
          <Text color={colors.primary} bold>
            Size
          </Text>
        </Box>
        <Box width={COLUMN_WIDTHS.progress} justifyContent="flex-end">
          <Text color={colors.primary} bold>
            Progress
          </Text>
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text color={colors.muted}>
          {borders.horizontal.repeat(
            COLUMN_WIDTHS.priority +
              COLUMN_WIDTHS.name +
              COLUMN_WIDTHS.size +
              COLUMN_WIDTHS.progress
          )}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Single file row component
 */
const FileRow: React.FC<{ file: TorrentFile; treePrefix: string }> = ({
  file,
  treePrefix,
}) => {
  const { filename } = parseFilePath(file.path);
  const progress = file.size > 0 ? file.downloaded / file.size : 0;
  const priorityInfo = PRIORITY_DISPLAY[file.priority] || PRIORITY_DISPLAY[2];

  // Build display name with tree structure
  const displayName =
    treePrefix + truncateText(filename, COLUMN_WIDTHS.name - treePrefix.length);

  // Determine progress color
  const progressColor =
    progress >= 1
      ? colors.success
      : progress > 0
        ? colors.primary
        : colors.muted;

  return (
    <Box flexDirection="row" paddingX={1}>
      <Box width={COLUMN_WIDTHS.priority}>
        <Text color={priorityInfo.color}>{priorityInfo.icon} </Text>
      </Box>
      <Box width={COLUMN_WIDTHS.name}>
        <Text>{displayName.padEnd(COLUMN_WIDTHS.name)}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.size} justifyContent="flex-end">
        <Text color={colors.muted}>
          {formatBytes(file.size).padStart(COLUMN_WIDTHS.size)}
        </Text>
      </Box>
      <Box width={COLUMN_WIDTHS.progress} justifyContent="flex-end">
        <Text color={progressColor}>
          {createMiniProgressBar(progress)}{' '}
          {formatProgress(progress).padStart(4)}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Directory row component for multi-file torrents
 */
const DirectoryRow: React.FC<{ name: string; depth: number }> = ({
  name,
  depth,
}) => {
  const prefix = depth > 0 ? '  '.repeat(depth - 1) + '\u251c\u2500 ' : '';
  const displayName = prefix + '\u{1F4C1} ' + name; // 📁

  return (
    <Box flexDirection="row" paddingX={1}>
      <Box width={COLUMN_WIDTHS.priority}>
        <Text> </Text>
      </Box>
      <Box width={COLUMN_WIDTHS.name}>
        <Text color={colors.primary}>{displayName}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.size} />
      <Box width={COLUMN_WIDTHS.progress} />
    </Box>
  );
};

/**
 * Empty state when no files
 */
const EmptyState: React.FC = () => {
  return (
    <Box paddingX={1} paddingY={1}>
      <Text color={colors.muted}>No files</Text>
    </Box>
  );
};

/**
 * Build file tree structure for display
 */
interface FileTreeNode {
  type: 'file' | 'directory';
  name: string;
  file?: TorrentFile;
  depth: number;
  isLast: boolean;
}

function buildFileTree(files: TorrentFile[]): FileTreeNode[] {
  // Sort files by path for consistent tree structure
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  // Track seen directories to avoid duplicates
  const seenDirs = new Set<string>();
  const nodes: FileTreeNode[] = [];

  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const { dirs, filename } = parseFilePath(file.path);

    // Add directory nodes
    let currentPath = '';
    for (let d = 0; d < dirs.length; d++) {
      currentPath = currentPath ? `${currentPath}/${dirs[d]}` : dirs[d];
      if (!seenDirs.has(currentPath)) {
        seenDirs.add(currentPath);
        nodes.push({
          type: 'directory',
          name: dirs[d],
          depth: d,
          isLast: false,
        });
      }
    }

    // Add file node
    const isLast = i === sortedFiles.length - 1;
    nodes.push({
      type: 'file',
      name: filename,
      file,
      depth: dirs.length,
      isLast,
    });
  }

  return nodes;
}

/**
 * FileList component for displaying torrent files
 *
 * Shows a tree-structured list of files within the torrent,
 * including file path, size, progress, and download priority.
 *
 * @example
 * <FileList files={torrent.files} />
 *
 * // Output (single file):
 * // Pri File                                     Size     Progress
 * // ──────────────────────────────────────────────────────────────
 * // •  ubuntu-24.04.iso                        4.7 GB  ██████ 100%
 *
 * // Output (multi-file):
 * // Pri File                                     Size     Progress
 * // ──────────────────────────────────────────────────────────────
 * //    📁 Album Name
 * // •  ├─ 01 - Track One.mp3                  8.2 MB  ██████ 100%
 * // •  └─ 02 - Track Two.mp3                  7.1 MB  ████░░  67%
 */
export const FileList: React.FC<FileListProps> = ({ files }) => {
  if (files.length === 0) {
    return <EmptyState />;
  }

  // For single file torrents, render simply
  if (files.length === 1) {
    return (
      <Box flexDirection="column">
        <FileListHeader />
        <FileRow file={files[0]} treePrefix="" />
      </Box>
    );
  }

  // For multi-file torrents, build and render tree
  const tree = buildFileTree(files);

  return (
    <Box flexDirection="column">
      <FileListHeader />
      {tree.map((node) => {
        if (node.type === 'directory') {
          return (
            <DirectoryRow
              key={`dir-${node.name}-${node.depth}`}
              name={node.name}
              depth={node.depth}
            />
          );
        }
        return (
          <FileRow
            key={node.file!.index}
            file={node.file!}
            treePrefix={buildTreePrefix(node.depth, node.isLast)}
          />
        );
      })}
    </Box>
  );
};

export default FileList;
