/**
 * List command for Torm CLI.
 *
 * Lists all torrents with their status, progress, and speed.
 *
 * @module cli/commands/list
 */

import React, { useEffect, useState } from 'react';
import { render, Text, Box } from 'ink';
import { Torrent, TorrentState } from '../../engine/types.js';
import { getDaemonClient } from '../../daemon/index.js';
import {
  formatBytes,
  formatSpeed,
  formatProgress,
  truncateText,
  getColoredStatus,
  formatTableHeader,
  formatTableRow,
  TableColumn,
  infoMessage,
  errorMessage,
} from '../utils/output.js';

// =============================================================================
// Types
// =============================================================================

export interface ListCommandOptions {
  /** Filter by state */
  state?: TorrentState;
  /** Show detailed output */
  verbose?: boolean;
}

interface ListResultProps {
  torrents: Torrent[];
  error: string | null;
  loading: boolean;
  verbose: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const TABLE_COLUMNS: TableColumn[] = [
  { header: 'Name', width: 30, align: 'left' },
  { header: 'Size', width: 10, align: 'right' },
  { header: 'Progress', width: 8, align: 'right' },
  { header: 'Speed', width: 10, align: 'right' },
  { header: 'Status', width: 12, align: 'left' },
];

// =============================================================================
// Components
// =============================================================================

/**
 * Map torrent state to Ink color
 */
function getStateColor(state: TorrentState): string {
  switch (state) {
    case TorrentState.DOWNLOADING:
      return 'blue';
    case TorrentState.SEEDING:
      return 'green';
    case TorrentState.PAUSED:
      return 'yellow';
    case TorrentState.ERROR:
      return 'red';
    case TorrentState.CHECKING:
      return 'cyan';
    case TorrentState.QUEUED:
      return 'gray';
    default:
      return 'white';
  }
}

/**
 * Get display name for torrent state
 */
function getStateName(state: TorrentState): string {
  switch (state) {
    case TorrentState.DOWNLOADING:
      return 'Downloading';
    case TorrentState.SEEDING:
      return 'Seeding';
    case TorrentState.PAUSED:
      return 'Paused';
    case TorrentState.ERROR:
      return 'Error';
    case TorrentState.CHECKING:
      return 'Checking';
    case TorrentState.QUEUED:
      return 'Queued';
    default:
      return 'Unknown';
  }
}

/**
 * Get relevant speed for a torrent based on its state
 */
function getRelevantSpeed(torrent: Torrent): number {
  if (torrent.state === TorrentState.SEEDING) {
    return torrent.uploadSpeed;
  }
  return torrent.downloadSpeed;
}

/**
 * Torrent row component
 */
const TorrentRow: React.FC<{ torrent: Torrent; index: number }> = ({
  torrent,
  index,
}) => {
  const stateColor = getStateColor(torrent.state);
  const stateName = getStateName(torrent.state);
  const speed = getRelevantSpeed(torrent);
  const progressStr = formatProgress(torrent.progress);

  return (
    <Box>
      <Box width={4}>
        <Text dimColor>{(index + 1).toString().padStart(3)}.</Text>
      </Box>
      <Box width={32}>
        <Text>{truncateText(torrent.name, 30)}</Text>
      </Box>
      <Box width={12} justifyContent="flex-end">
        <Text>{formatBytes(torrent.size)}</Text>
      </Box>
      <Box width={10} justifyContent="flex-end">
        <Text>{progressStr}</Text>
      </Box>
      <Box width={12} justifyContent="flex-end">
        <Text>{formatSpeed(speed)}</Text>
      </Box>
      <Box width={14}>
        <Text color={stateColor}> {stateName}</Text>
      </Box>
    </Box>
  );
};

/**
 * Table header component
 */
const TableHeader: React.FC = () => (
  <Box>
    <Box width={4}>
      <Text bold dimColor>
        {'  #'}
      </Text>
    </Box>
    <Box width={32}>
      <Text bold dimColor>
        Name
      </Text>
    </Box>
    <Box width={12} justifyContent="flex-end">
      <Text bold dimColor>
        Size
      </Text>
    </Box>
    <Box width={10} justifyContent="flex-end">
      <Text bold dimColor>
        Progress
      </Text>
    </Box>
    <Box width={12} justifyContent="flex-end">
      <Text bold dimColor>
        Speed
      </Text>
    </Box>
    <Box width={14}>
      <Text bold dimColor>
        {' '}
        Status
      </Text>
    </Box>
  </Box>
);

/**
 * Separator line
 */
const Separator: React.FC = () => <Text dimColor>{'-'.repeat(84)}</Text>;

/**
 * Component to display the list of torrents
 */
const ListResult: React.FC<ListResultProps> = ({
  torrents,
  error,
  loading,
  verbose: _verbose,
}) => {
  if (loading) {
    return (
      <Box>
        <Text color="cyan">Loading torrents...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Text color="red">[ERROR] {error}</Text>
      </Box>
    );
  }

  if (torrents.length === 0) {
    return (
      <Box>
        <Text color="yellow">[INFO] No torrents found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <TableHeader />
      <Separator />
      {torrents.map((torrent, index) => (
        <TorrentRow key={torrent.infoHash} torrent={torrent} index={index} />
      ))}
      <Separator />
      <Box marginTop={1}>
        <Text dimColor>
          {torrents.length} torrent{torrents.length !== 1 ? 's' : ''} total
        </Text>
      </Box>
    </Box>
  );
};

// =============================================================================
// Main List Function
// =============================================================================

/**
 * Execute the list command (non-interactive).
 *
 * @param options - Command options
 */
export async function executeList(
  options: ListCommandOptions = {}
): Promise<void> {
  const { state, verbose: _verbose = false } = options;

  let client;

  try {
    // Connect to daemon (starts it if not running)
    client = await getDaemonClient();

    let torrents = await client.getTorrents();

    // Filter by state if specified
    if (state) {
      torrents = torrents.filter((t) => t.state === state);
    }

    if (torrents.length === 0) {
      console.log(infoMessage('No torrents found'));
      client.disconnect();
      return;
    }

    // Print header
    console.log(formatTableHeader(TABLE_COLUMNS));

    // Print each torrent
    for (const torrent of torrents) {
      const speed = getRelevantSpeed(torrent);
      const values = [
        truncateText(torrent.name, 30),
        formatBytes(torrent.size),
        formatProgress(torrent.progress),
        formatSpeed(speed),
        getColoredStatus(torrent.state),
      ];
      console.log(formatTableRow(values, TABLE_COLUMNS));
    }

    console.log();
    console.log(
      `${torrents.length} torrent${torrents.length !== 1 ? 's' : ''} total`
    );

    client.disconnect();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(errorMessage(message));

    if (client) {
      client.disconnect();
    }

    process.exit(1);
  }
}

/**
 * List command component using Ink for rendering
 */
export function ListCommand({
  state,
  verbose = false,
}: ListCommandOptions): React.ReactElement {
  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const doList = async () => {
      let client;

      try {
        // Connect to daemon (starts it if not running)
        client = await getDaemonClient();

        let allTorrents = await client.getTorrents();

        // Filter by state if specified
        if (state) {
          allTorrents = allTorrents.filter((t) => t.state === state);
        }

        setTorrents(allTorrents);
        client.disconnect();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        if (client) {
          client.disconnect();
        }
      } finally {
        setLoading(false);
      }
    };

    doList();
  }, [state]);

  return (
    <ListResult
      torrents={torrents}
      error={error}
      loading={loading}
      verbose={verbose}
    />
  );
}

/**
 * Run the list command with Ink rendering
 */
export function runList(options: ListCommandOptions = {}): void {
  const { waitUntilExit } = render(<ListCommand {...options} />);
  waitUntilExit().then(() => {
    process.exit(0);
  });
}

export default executeList;
