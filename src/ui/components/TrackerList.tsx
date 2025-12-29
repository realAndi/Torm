import React from 'react';
import { Box, Text } from 'ink';
import type { TrackerInfo, TrackerStatus } from '../../engine/types.js';
import { colors, borders } from '../theme/index.js';
import { formatRelativeTime, formatTimeUntil, truncateText } from '../utils/format.js';

export interface TrackerListProps {
  /** Array of trackers to display */
  trackers: TrackerInfo[];
}

/**
 * Column widths for tracker list display
 */
const COLUMN_WIDTHS = {
  url: 35,
  status: 12,
  peers: 6,
  seeds: 6,
  leeches: 6,
  lastAnnounce: 10,
  nextAnnounce: 10,
} as const;

/**
 * Tracker status display configuration
 */
const STATUS_DISPLAY: Record<string, { color: string; label: string }> = {
  idle: { color: colors.muted, label: 'Idle' },
  announcing: { color: colors.warning, label: 'Announcing' },
  working: { color: colors.success, label: 'Working' },
  error: { color: colors.error, label: 'Error' },
};

/**
 * Get display configuration for a tracker status
 */
function getStatusDisplay(status: TrackerStatus | string): { color: string; label: string } {
  const statusKey = typeof status === 'string' ? status.toLowerCase() : String(status).toLowerCase();
  return STATUS_DISPLAY[statusKey] || { color: colors.muted, label: String(status) };
}

/**
 * Truncate tracker URL for display
 * Shows domain and path, removes protocol
 */
function formatTrackerUrl(url: string, maxLength: number): string {
  try {
    const parsed = new URL(url);
    const display = parsed.host + parsed.pathname;
    return truncateText(display, maxLength);
  } catch {
    return truncateText(url, maxLength);
  }
}

/**
 * Header row for tracker list
 */
const TrackerListHeader: React.FC = () => {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" paddingX={1}>
        <Box width={COLUMN_WIDTHS.url}>
          <Text color={colors.primary} bold>Tracker</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.status}>
          <Text color={colors.primary} bold>Status</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.peers} justifyContent="flex-end">
          <Text color={colors.primary} bold>Peers</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.seeds} justifyContent="flex-end">
          <Text color={colors.primary} bold>Seeds</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.leeches} justifyContent="flex-end">
          <Text color={colors.primary} bold>Leech</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.lastAnnounce} justifyContent="flex-end">
          <Text color={colors.primary} bold>Last</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.nextAnnounce} justifyContent="flex-end">
          <Text color={colors.primary} bold>Next</Text>
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text color={colors.muted}>
          {borders.horizontal.repeat(
            COLUMN_WIDTHS.url +
            COLUMN_WIDTHS.status +
            COLUMN_WIDTHS.peers +
            COLUMN_WIDTHS.seeds +
            COLUMN_WIDTHS.leeches +
            COLUMN_WIDTHS.lastAnnounce +
            COLUMN_WIDTHS.nextAnnounce
          )}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Single tracker row component
 */
const TrackerRow: React.FC<{ tracker: TrackerInfo }> = ({ tracker }) => {
  const statusInfo = getStatusDisplay(tracker.status);
  const url = formatTrackerUrl(tracker.url, COLUMN_WIDTHS.url);
  const lastAnnounce = formatRelativeTime(tracker.lastAnnounce);
  const nextAnnounce = formatTimeUntil(tracker.nextAnnounce);

  return (
    <Box flexDirection="row" paddingX={1}>
      <Box width={COLUMN_WIDTHS.url}>
        <Text>{url.padEnd(COLUMN_WIDTHS.url)}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.status}>
        <Text color={statusInfo.color}>{statusInfo.label.padEnd(COLUMN_WIDTHS.status)}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.peers} justifyContent="flex-end">
        <Text color={tracker.peers > 0 ? colors.success : colors.muted}>
          {tracker.peers.toString().padStart(COLUMN_WIDTHS.peers)}
        </Text>
      </Box>
      <Box width={COLUMN_WIDTHS.seeds} justifyContent="flex-end">
        <Text color={tracker.seeds > 0 ? colors.success : colors.muted}>
          {tracker.seeds.toString().padStart(COLUMN_WIDTHS.seeds)}
        </Text>
      </Box>
      <Box width={COLUMN_WIDTHS.leeches} justifyContent="flex-end">
        <Text color={tracker.leeches > 0 ? colors.primary : colors.muted}>
          {tracker.leeches.toString().padStart(COLUMN_WIDTHS.leeches)}
        </Text>
      </Box>
      <Box width={COLUMN_WIDTHS.lastAnnounce} justifyContent="flex-end">
        <Text color={colors.muted}>{lastAnnounce.padStart(COLUMN_WIDTHS.lastAnnounce)}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.nextAnnounce} justifyContent="flex-end">
        <Text color={colors.muted}>{nextAnnounce.padStart(COLUMN_WIDTHS.nextAnnounce)}</Text>
      </Box>
    </Box>
  );
};

/**
 * Error row showing tracker error message
 */
const TrackerErrorRow: React.FC<{ message: string }> = ({ message }) => {
  return (
    <Box paddingX={3}>
      <Text color={colors.error}>
        {'\u2514'}{'\u2500'} {truncateText(message, 70)}
      </Text>
    </Box>
  );
};

/**
 * Empty state when no trackers
 */
const EmptyState: React.FC = () => {
  return (
    <Box paddingX={1} paddingY={1}>
      <Text color={colors.muted}>No trackers configured</Text>
    </Box>
  );
};

/**
 * TrackerList component for displaying tracker status
 *
 * Shows a table of trackers with their URL, status, peer/seed counts,
 * and announce timing information.
 *
 * @example
 * <TrackerList trackers={torrent.trackers} />
 *
 * // Output:
 * // Tracker                            Status      Peers Seeds Leech       Last       Next
 * // ──────────────────────────────────────────────────────────────────────────────────────
 * // tracker.example.com/announce       Working        45    12    33     2m ago     in 25m
 * // backup.tracker.org:6969/announce   Error           0     0     0    15m ago     in 30m
 * // └─ Connection refused
 */
export const TrackerList: React.FC<TrackerListProps> = ({ trackers }) => {
  if (trackers.length === 0) {
    return <EmptyState />;
  }

  return (
    <Box flexDirection="column">
      <TrackerListHeader />
      {trackers.map((tracker) => (
        <React.Fragment key={tracker.url}>
          <TrackerRow tracker={tracker} />
          {tracker.errorMessage && (
            <TrackerErrorRow message={tracker.errorMessage} />
          )}
        </React.Fragment>
      ))}
    </Box>
  );
};

export default TrackerList;
