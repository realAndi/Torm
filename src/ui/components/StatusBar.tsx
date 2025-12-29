import React from 'react';
import { Box, Text } from 'ink';
import { colors, borders } from '../theme/index.js';
import type { Torrent } from '../../engine/types.js';
import type { StatusFilter } from './SearchBar.js';

export interface StatusBarProps {
  /** Currently selected torrent, or null if none selected */
  selectedTorrent: Torrent | null;
  /** Index of the selected torrent (1-based for display) */
  selectedIndex?: number;
  /** Total number of torrents (before filtering) */
  totalCount?: number;
  /** Number of torrents after filtering */
  filteredCount?: number;
  /** Whether filtering is currently active */
  isFiltered?: boolean;
  /** Current status filter */
  statusFilter?: StatusFilter;
  /** Terminal width in columns */
  width?: number;
  /** Total download speed in bytes/second */
  totalDownloadSpeed?: number;
  /** Total upload speed in bytes/second */
  totalUploadSpeed?: number;
  /** Whether daemon is connected */
  daemonConnected?: boolean;
  /** Daemon uptime in seconds */
  daemonUptime?: number;
  /** Connection status message (shown when connecting) */
  connectionStatus?: string;
}

/**
 * Formats bytes into a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const base = 1024;

  const exponent = Math.floor(Math.log(bytes) / Math.log(base));
  const unitIndex = Math.min(exponent, units.length - 1);
  const value = bytes / Math.pow(base, unitIndex);

  if (unitIndex === 0) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Formats bytes per second to speed string.
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';

  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSecond;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  if (unitIndex === 0) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  const formatted = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

/**
 * Formats seconds into a human-readable ETA string.
 */
export function formatEta(seconds: number | null): string {
  if (seconds === null || seconds <= 0) {
    return '--';
  }

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

/**
 * StatusBar component for Torm TUI
 *
 * Displays keyboard shortcuts on the left and speeds on the right.
 */
/**
 * Format daemon uptime for display
 */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  selectedTorrent,
  selectedIndex = 1,
  totalCount = 0,
  filteredCount = 0,
  isFiltered = false,
  statusFilter: _statusFilter = 'all',
  width = 80,
  totalDownloadSpeed = 0,
  totalUploadSpeed = 0,
  daemonConnected = false,
  daemonUptime,
  connectionStatus,
}) => {
  const innerWidth = Math.max(width - 2, 10);

  // For small terminals, put speeds on separate row
  const isCompact = width < 100;

  // Build torrent info line
  const renderTorrentInfo = () => {
    if (!selectedTorrent) {
      return <Text color={colors.muted}>No torrent selected</Text>;
    }

    const { name, progress, downloaded, size, eta } = selectedTorrent;
    const percentage = Math.round(progress * 100);
    const downloadedStr = formatBytes(downloaded);
    const sizeStr = formatBytes(size);
    const etaStr = formatEta(eta);

    // Truncate name if too long
    const maxNameLength = Math.max(20, innerWidth - 50);
    const displayName = name.length > maxNameLength
      ? name.slice(0, maxNameLength - 1) + '\u2026'
      : name;

    return (
      <Text>
        <Text color={colors.primary} bold>[{selectedIndex}]</Text>
        <Text color={colors.text}> {displayName}</Text>
        <Text color={colors.muted}> </Text>
        <Text color={colors.success} bold>{percentage}%</Text>
        <Text color={colors.muted}> {downloadedStr}/{sizeStr}</Text>
        <Text color={colors.muted}> ETA:</Text>
        <Text color={colors.secondary}>{etaStr}</Text>
        {isFiltered && (
          <>
            <Text color={colors.muted}> </Text>
            <Text color={colors.warning}>[{filteredCount}/{totalCount}]</Text>
          </>
        )}
      </Text>
    );
  };

  // Keyboard shortcuts - left aligned
  const shortcuts = [
    { key: 'q', action: 'Quit' },
    { key: 'a', action: 'Add' },
    { key: 'p', action: 'Pause' },
    { key: 'r', action: 'Resume' },
    { key: 'd', action: 'Delete' },
    { key: '/', action: 'Search' },
    { key: 's', action: 'Settings' },
    { key: '?', action: 'Help' },
  ];

  return (
    <Box flexDirection="column">
      {/* Top border */}
      <Text color={colors.border}>
        {borders.rounded.topLeft}
        {borders.horizontal.repeat(innerWidth)}
        {borders.rounded.topRight}
      </Text>

      {/* Line 1: Torrent info */}
      <Box>
        <Text color={colors.border}>{borders.vertical}</Text>
        <Box width={innerWidth} paddingX={1}>
          {renderTorrentInfo()}
        </Box>
        <Text color={colors.border}>{borders.vertical}</Text>
      </Box>

      {/* Separator */}
      <Text color={colors.border}>
        {borders.junctions.left}
        {borders.horizontal.repeat(innerWidth)}
        {borders.junctions.right}
      </Text>

      {/* Line 2: Shortcuts (and speeds if wide enough) */}
      <Box>
        <Text color={colors.border}>{borders.vertical}</Text>
        <Box width={innerWidth} paddingX={1} justifyContent="space-between">
          {/* Left: Hotkeys */}
          <Box>
            {shortcuts.map((s, i) => (
              <React.Fragment key={s.key}>
                {i > 0 && <Text color={colors.dim}>  </Text>}
                <Text color={colors.primary} bold>{s.key}</Text>
                <Text color={colors.muted}>:{s.action}</Text>
              </React.Fragment>
            ))}
          </Box>

          {/* Right: Daemon status + Speeds (only if not compact) */}
          {!isCompact && (
            <Box gap={2}>
              {/* Daemon status */}
              <Box>
                <Text color={daemonConnected ? colors.success : connectionStatus ? colors.warning : colors.error}>
                  {daemonConnected ? '●' : connectionStatus ? '◐' : '○'}
                </Text>
                <Text color={colors.muted}> </Text>
                {connectionStatus && !daemonConnected ? (
                  <Text color={colors.warning}>{connectionStatus}</Text>
                ) : (
                  <>
                    <Text color={colors.muted}>Daemon</Text>
                    {daemonConnected && daemonUptime !== undefined && (
                      <Text color={colors.dim}> ({formatUptime(daemonUptime)})</Text>
                    )}
                  </>
                )}
              </Box>
              <Text color={colors.borderDim}>│</Text>
              <Box>
                <Text color={colors.success}>↓ </Text>
                <Text color={colors.text} bold>{formatSpeed(totalDownloadSpeed)}</Text>
              </Box>
              <Box>
                <Text color={colors.warning}>↑ </Text>
                <Text color={colors.text} bold>{formatSpeed(totalUploadSpeed)}</Text>
              </Box>
            </Box>
          )}
        </Box>
        <Text color={colors.border}>{borders.vertical}</Text>
      </Box>

      {/* Line 3: Daemon status + Speeds on separate row (only if compact) */}
      {isCompact && (
        <>
          <Text color={colors.border}>
            {borders.junctions.left}
            {borders.horizontal.repeat(innerWidth)}
            {borders.junctions.right}
          </Text>
          <Box>
            <Text color={colors.border}>{borders.vertical}</Text>
            <Box width={innerWidth} paddingX={1} justifyContent="space-between">
              <Box gap={3}>
                <Box>
                  <Text color={colors.success}>↓ </Text>
                  <Text color={colors.text} bold>{formatSpeed(totalDownloadSpeed)}</Text>
                </Box>
                <Box>
                  <Text color={colors.warning}>↑ </Text>
                  <Text color={colors.text} bold>{formatSpeed(totalUploadSpeed)}</Text>
                </Box>
              </Box>
              <Box>
                <Text color={daemonConnected ? colors.success : connectionStatus ? colors.warning : colors.error}>
                  {daemonConnected ? '●' : connectionStatus ? '◐' : '○'}
                </Text>
                <Text color={colors.muted}> </Text>
                {connectionStatus && !daemonConnected ? (
                  <Text color={colors.warning}>{connectionStatus}</Text>
                ) : (
                  <>
                    <Text color={colors.muted}>Daemon</Text>
                    {daemonConnected && daemonUptime !== undefined && (
                      <Text color={colors.dim}> ({formatUptime(daemonUptime)})</Text>
                    )}
                  </>
                )}
              </Box>
            </Box>
            <Text color={colors.border}>{borders.vertical}</Text>
          </Box>
        </>
      )}

      {/* Bottom border */}
      <Text color={colors.border}>
        {borders.rounded.bottomLeft}
        {borders.horizontal.repeat(innerWidth)}
        {borders.rounded.bottomRight}
      </Text>
    </Box>
  );
};

export default StatusBar;
