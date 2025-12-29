import React from 'react';
import { Box, Text } from 'ink';
import { colors, borders } from '../theme/index.js';
import { formatTimestamp } from '../utils/format.js';

/**
 * Log entry structure for torrent activity
 */
export interface LogEntry {
  /** Timestamp when the log entry was created */
  timestamp: Date;
  /** Log level for color coding */
  level: 'info' | 'warn' | 'error';
  /** Log message text */
  message: string;
}

export interface LogViewProps {
  /** Array of log entries to display */
  logs: LogEntry[];
  /** Maximum number of entries to show (default: 20) */
  maxEntries?: number;
}

/**
 * Log level display configuration
 */
const LEVEL_DISPLAY: Record<
  LogEntry['level'],
  { color: string; prefix: string }
> = {
  info: { color: colors.primary, prefix: 'INF' },
  warn: { color: colors.warning, prefix: 'WRN' },
  error: { color: colors.error, prefix: 'ERR' },
};

/**
 * Column widths for log display
 */
const COLUMN_WIDTHS = {
  timestamp: 10,
  level: 5,
  message: 60,
} as const;

/**
 * Header row for log view
 */
const LogViewHeader: React.FC = () => {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" paddingX={1}>
        <Box width={COLUMN_WIDTHS.timestamp}>
          <Text color={colors.primary} bold>
            Time
          </Text>
        </Box>
        <Box width={COLUMN_WIDTHS.level}>
          <Text color={colors.primary} bold>
            Level
          </Text>
        </Box>
        <Box>
          <Text color={colors.primary} bold>
            Message
          </Text>
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text color={colors.muted}>
          {borders.horizontal.repeat(
            COLUMN_WIDTHS.timestamp +
              COLUMN_WIDTHS.level +
              COLUMN_WIDTHS.message
          )}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Single log entry row component
 */
const LogEntryRow: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const levelInfo = LEVEL_DISPLAY[entry.level];
  const timestamp = formatTimestamp(entry.timestamp);

  return (
    <Box flexDirection="row" paddingX={1}>
      <Box width={COLUMN_WIDTHS.timestamp}>
        <Text color={colors.muted}>{timestamp}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.level}>
        <Text color={levelInfo.color}>{levelInfo.prefix}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={entry.level === 'error' ? colors.error : undefined}>
          {entry.message}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Empty state when no logs
 */
const EmptyState: React.FC = () => {
  return (
    <Box paddingX={1} paddingY={1}>
      <Text color={colors.muted}>No activity recorded</Text>
    </Box>
  );
};

/**
 * LogView component for displaying torrent activity log
 *
 * Shows a scrollable list of log entries with timestamps,
 * log levels, and messages. Entries are color-coded by level.
 *
 * @example
 * const logs = [
 *   { timestamp: new Date(), level: 'info', message: 'Torrent started' },
 *   { timestamp: new Date(), level: 'warn', message: 'Tracker timeout' },
 * ];
 * <LogView logs={logs} />
 *
 * // Output:
 * // Time       Level Message
 * // ─────────────────────────────────────────────────────────────────────
 * // 14:32:15   INF   Torrent started
 * // 14:32:45   WRN   Tracker timeout
 */
export const LogView: React.FC<LogViewProps> = ({ logs, maxEntries = 20 }) => {
  if (logs.length === 0) {
    return <EmptyState />;
  }

  // Show most recent entries first, limited by maxEntries
  const displayLogs = logs.slice(-maxEntries).reverse();

  return (
    <Box flexDirection="column">
      <LogViewHeader />
      {displayLogs.map((entry, index) => (
        <LogEntryRow
          key={`${entry.timestamp.getTime()}-${index}`}
          entry={entry}
        />
      ))}
      {logs.length > maxEntries && (
        <Box paddingX={1} marginTop={1}>
          <Text color={colors.muted}>
            Showing {maxEntries} of {logs.length} entries
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default LogView;
