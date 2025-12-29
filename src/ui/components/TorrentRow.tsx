import React from 'react';
import { Box, Text } from 'ink';
import { Torrent, TorrentState } from '../../engine/types.js';
import { ProgressBar } from './ProgressBar.js';
import { LabelList } from './LabelBadge.js';
import { colors, statusColors, borders } from '../theme/index.js';

export interface TorrentRowProps {
  /** The torrent to display */
  torrent: Torrent;
  /** Whether this row is currently selected */
  isSelected: boolean;
  /** The index number to display (1-based) */
  index: number;
  /** Terminal width in columns for responsive layout */
  width?: number;
}

/**
 * Calculate column widths based on terminal width
 * Columns scale down for smaller terminals
 */
export function calculateColumnWidths(terminalWidth: number) {
  // 8 borders: 2 outer (left/right) + 6 internal separators (7 columns)
  const borders = 8;
  const availableWidth = terminalWidth - borders;

  // For very small terminals, use minimal widths
  if (availableWidth < 100) {
    const progress = 12;
    const size = 8;
    const speed = 8;
    const seeds = 10;
    const peers = 10;
    const status = 10;
    const name = Math.max(10, availableWidth - progress - size - speed - seeds - peers - status);
    return { name, progress, size, speed, seeds, peers, status };
  }

  // For medium terminals
  if (availableWidth < 140) {
    const progress = 16;
    const size = 10;
    const speed = 10;
    const seeds = 10;
    const peers = 10;
    const status = 12;
    const name = availableWidth - progress - size - speed - seeds - peers - status;
    return { name, progress, size, speed, seeds, peers, status };
  }

  // For large terminals
  const progress = 20;
  const size = 12;
  const speed = 12;
  const seeds = 12;
  const peers = 12;
  const status = 14;
  const name = availableWidth - progress - size - speed - seeds - peers - status;

  return { name, progress, size, speed, seeds, peers, status };
}

/**
 * Status display text for each torrent state
 */
const STATUS_TEXT: Record<TorrentState, string> = {
  [TorrentState.DOWNLOADING]: 'Downloading',
  [TorrentState.SEEDING]: 'Seeding',
  [TorrentState.PAUSED]: 'Paused',
  [TorrentState.ERROR]: 'Error',
  [TorrentState.CHECKING]: 'Checking',
  [TorrentState.QUEUED]: 'Queued',
};

/**
 * Colors for each torrent state
 */
const STATUS_COLORS: Record<TorrentState, string> = {
  [TorrentState.DOWNLOADING]: statusColors.downloading,
  [TorrentState.SEEDING]: statusColors.seeding,
  [TorrentState.PAUSED]: statusColors.paused,
  [TorrentState.ERROR]: statusColors.error,
  [TorrentState.CHECKING]: statusColors.checking,
  [TorrentState.QUEUED]: statusColors.queued,
};

/**
 * Format bytes into human-readable size string
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);

  if (size >= 100) {
    return `${Math.round(size)} ${units[i]}`;
  } else if (size >= 10) {
    return `${size.toFixed(1)} ${units[i]}`;
  } else {
    return `${size.toFixed(2)} ${units[i]}`;
  }
}

/**
 * Format speed in bytes/second to human-readable string
 */
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '--';

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(1024));
  const speed = bytesPerSecond / Math.pow(1024, i);

  if (speed >= 10) {
    return `${Math.round(speed)} ${units[i]}`;
  } else {
    return `${speed.toFixed(1)} ${units[i]}`;
  }
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed
 */
function truncateName(name: string, maxLength: number): string {
  if (name.length <= maxLength) {
    return name.padEnd(maxLength);
  }
  return name.slice(0, maxLength - 1) + '\u2026';
}

/**
 * Get the relevant speed based on torrent state
 */
function getRelevantSpeed(torrent: Torrent): number {
  if (torrent.state === TorrentState.SEEDING) {
    return torrent.uploadSpeed;
  }
  return torrent.downloadSpeed;
}

/**
 * Get total seeds available from all trackers (max value from any tracker)
 */
function getTotalSeeds(torrent: Torrent): number {
  if (!torrent.trackers || torrent.trackers.length === 0) {
    return 0;
  }
  return Math.max(0, ...torrent.trackers.map((t) => t.seeds || 0));
}

/**
 * Get total leeches (peers) available from all trackers (max value from any tracker)
 */
function getTotalLeeches(torrent: Torrent): number {
  if (!torrent.trackers || torrent.trackers.length === 0) {
    return 0;
  }
  return Math.max(0, ...torrent.trackers.map((t) => t.leeches || 0));
}

/**
 * Format connected (available) display for seeds/peers
 * Handles undefined values by defaulting to 0
 */
function formatPeerCount(connected: number | undefined, available: number): string {
  return `${connected ?? 0} (${available})`;
}

/**
 * Single torrent display row component
 *
 * Column order: Name | Progress | Size | Speed | Status
 */
export const TorrentRow: React.FC<TorrentRowProps> = ({
  torrent,
  isSelected,
  index,
  width = 80,
}) => {
  const statusText = STATUS_TEXT[torrent.state];
  const statusColor = STATUS_COLORS[torrent.state];
  const speed = getRelevantSpeed(torrent);
  const cols = calculateColumnWidths(width);

  // Progress bar width - use most of the progress column (leave room for " " + " 100%")
  const progressBarWidth = Math.max(4, cols.progress - 8);

  // Selected row uses green highlighting instead of inverse
  const selectedColor = colors.highlight;

  return (
    <Box flexDirection="row">
      {/* Left border */}
      <Text color={isSelected ? selectedColor : colors.border}>{borders.vertical}</Text>

      {/* Name column */}
      <Box width={cols.name}>
        <Text color={isSelected ? selectedColor : colors.text} bold={isSelected}>
          {' '}
          {torrent.state === TorrentState.PAUSED && (
            <Text color={isSelected ? selectedColor : statusColors.paused}>⏸ </Text>
          )}
          {truncateName(torrent.name, torrent.state === TorrentState.PAUSED ? cols.name - 5 : cols.name - 2)}{' '}
        </Text>
      </Box>

      <Text color={isSelected ? selectedColor : colors.borderDim}>{borders.vertical}</Text>

      {/* Progress column */}
      <Box width={cols.progress}>
        <Text color={isSelected ? selectedColor : undefined}>{' '}</Text>
        {isSelected ? (
          <Text color={selectedColor} bold>
            {'\u2588'.repeat(Math.round(torrent.progress * progressBarWidth))}
            {'\u2591'.repeat(progressBarWidth - Math.round(torrent.progress * progressBarWidth))}
            {' '}{(torrent.progress >= 1 ? 100 : Math.floor(torrent.progress * 100)).toString().padStart(3)}%
          </Text>
        ) : (
          <ProgressBar progress={torrent.progress} width={progressBarWidth} showPercentage={true} />
        )}
        <Text>{' '}</Text>
      </Box>

      <Text color={isSelected ? selectedColor : colors.borderDim}>{borders.vertical}</Text>

      {/* Size column */}
      <Box width={cols.size} justifyContent="flex-end">
        <Text color={isSelected ? selectedColor : colors.muted} bold={isSelected}>
          {formatSize(torrent.size).padStart(cols.size - 2)}{' '}
        </Text>
      </Box>

      <Text color={isSelected ? selectedColor : colors.borderDim}>{borders.vertical}</Text>

      {/* Speed column */}
      <Box width={cols.speed} justifyContent="flex-end">
        <Text color={isSelected ? selectedColor : colors.muted} bold={isSelected}>
          {formatSpeed(speed).padStart(cols.speed - 2)}{' '}
        </Text>
      </Box>

      <Text color={isSelected ? selectedColor : colors.borderDim}>{borders.vertical}</Text>

      {/* Seeds column */}
      <Box width={cols.seeds} justifyContent="flex-end">
        <Text color={isSelected ? selectedColor : colors.muted} bold={isSelected}>
          {formatPeerCount(torrent.seeds, getTotalSeeds(torrent)).padStart(cols.seeds - 2)}{' '}
        </Text>
      </Box>

      <Text color={isSelected ? selectedColor : colors.borderDim}>{borders.vertical}</Text>

      {/* Peers column */}
      <Box width={cols.peers} justifyContent="flex-end">
        <Text color={isSelected ? selectedColor : colors.muted} bold={isSelected}>
          {formatPeerCount(torrent.peers, getTotalLeeches(torrent)).padStart(cols.peers - 2)}{' '}
        </Text>
      </Box>

      <Text color={isSelected ? selectedColor : colors.borderDim}>{borders.vertical}</Text>

      {/* Status column */}
      <Box width={cols.status}>
        <Text color={isSelected ? selectedColor : statusColor} bold={isSelected}>
          {' '}{statusText.slice(0, cols.status - 2).padEnd(cols.status - 2)}
        </Text>
      </Box>

      {/* Right border */}
      <Text color={isSelected ? selectedColor : colors.border}>{borders.vertical}</Text>

      {/* Labels (outside table) */}
      {torrent.labels && torrent.labels.length > 0 && (
        <Box marginLeft={1}>
          <LabelList labels={torrent.labels} isSelected={isSelected} maxLabels={2} />
        </Box>
      )}
    </Box>
  );
};

export default TorrentRow;
