/**
 * Info command for Torm CLI.
 *
 * Shows detailed information about a specific torrent.
 *
 * @module cli/commands/info
 */

import React, { useEffect, useState } from 'react';
import { render, Text, Box } from 'ink';
import { TormEngine } from '../../engine/TormEngine.js';
import { Torrent, TorrentState, TrackerStatus } from '../../engine/types.js';
import {
  formatBytes,
  formatSpeed,
  formatProgress,
  formatEta,
  truncateText,
  formatKeyValue,
  errorMessage,
  parseTorrentId,
  ansiColors,
  colorize,
} from '../utils/output.js';

// =============================================================================
// Types
// =============================================================================

export interface InfoCommandOptions {
  /** Torrent ID (info hash or prefix) */
  torrentId: string;
  /** Show file list */
  showFiles?: boolean;
  /** Show tracker list */
  showTrackers?: boolean;
}

interface InfoResultProps {
  torrent: Torrent | null;
  error: string | null;
  loading: boolean;
  showFiles: boolean;
  showTrackers: boolean;
}

// =============================================================================
// Helper Functions
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
 * Map tracker status to color
 */
function getTrackerStatusColor(status: TrackerStatus): string {
  switch (status) {
    case TrackerStatus.Working:
      return 'green';
    case TrackerStatus.Announcing:
      return 'cyan';
    case TrackerStatus.Error:
      return 'red';
    case TrackerStatus.Idle:
    default:
      return 'gray';
  }
}

/**
 * Find a torrent by ID (full hash or prefix)
 */
function findTorrent(engine: TormEngine, torrentId: string): Torrent | undefined {
  const { type, value } = parseTorrentId(torrentId);

  if (type === 'hash') {
    return engine.getTorrent(value);
  }

  // Search by prefix
  const torrents = engine.getAllTorrents();
  const matches = torrents.filter((t) => t.infoHash.startsWith(value));

  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous torrent ID "${torrentId}" matches ${matches.length} torrents. ` +
      'Please provide a longer prefix.'
    );
  }

  return matches[0];
}

// =============================================================================
// Components
// =============================================================================

/**
 * Section header component
 */
const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <Box marginTop={1} marginBottom={0}>
    <Text bold color="cyan">{title}</Text>
  </Box>
);

/**
 * Key-value row component
 */
const InfoRow: React.FC<{ label: string; value: React.ReactNode; width?: number }> = ({
  label,
  value,
  width = 14,
}) => (
  <Box>
    <Box width={width}>
      <Text dimColor>{label}:</Text>
    </Box>
    <Box>
      {typeof value === 'string' ? <Text>{value}</Text> : value}
    </Box>
  </Box>
);

/**
 * File list component
 */
const FileList: React.FC<{ files: Torrent['files'] }> = ({ files }) => (
  <Box flexDirection="column">
    <SectionHeader title="Files" />
    {files.map((file, index) => (
      <Box key={index}>
        <Box width={4}>
          <Text dimColor>{(index + 1).toString().padStart(3)}.</Text>
        </Box>
        <Box width={50}>
          <Text>{truncateText(file.path, 48)}</Text>
        </Box>
        <Box width={12} justifyContent="flex-end">
          <Text dimColor>{formatBytes(file.size)}</Text>
        </Box>
      </Box>
    ))}
  </Box>
);

/**
 * Tracker list component
 */
const TrackerList: React.FC<{ trackers: Torrent['trackers'] }> = ({ trackers }) => (
  <Box flexDirection="column">
    <SectionHeader title="Trackers" />
    {trackers.map((tracker, index) => (
      <Box key={index}>
        <Box width={4}>
          <Text dimColor>{(index + 1).toString().padStart(3)}.</Text>
        </Box>
        <Box width={50}>
          <Text>{truncateText(tracker.url, 48)}</Text>
        </Box>
        <Box width={12}>
          <Text color={getTrackerStatusColor(tracker.status)}>
            {' '}{tracker.status}
          </Text>
        </Box>
        <Box width={10} justifyContent="flex-end">
          <Text dimColor>{tracker.peers} peers</Text>
        </Box>
      </Box>
    ))}
  </Box>
);

/**
 * Component to display torrent information
 */
const InfoResult: React.FC<InfoResultProps> = ({
  torrent,
  error,
  loading,
  showFiles,
  showTrackers,
}) => {
  if (loading) {
    return (
      <Box>
        <Text color="cyan">Loading torrent info...</Text>
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

  if (!torrent) {
    return (
      <Box>
        <Text color="red">[ERROR] Torrent not found</Text>
      </Box>
    );
  }

  const stateColor = getStateColor(torrent.state);
  const stateName = getStateName(torrent.state);

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Header with name */}
      <Box marginBottom={1}>
        <Text bold>{torrent.name}</Text>
      </Box>

      {/* Basic info section */}
      <SectionHeader title="General" />
      <InfoRow label="Hash" value={torrent.infoHash} />
      <InfoRow
        label="Status"
        value={<Text color={stateColor}>{stateName}</Text>}
      />
      <InfoRow label="Size" value={formatBytes(torrent.size)} />
      <InfoRow label="Progress" value={formatProgress(torrent.progress)} />

      {/* Transfer info section */}
      <SectionHeader title="Transfer" />
      <InfoRow label="Downloaded" value={formatBytes(torrent.downloaded)} />
      <InfoRow label="Uploaded" value={formatBytes(torrent.uploaded)} />
      <InfoRow label="Down Speed" value={formatSpeed(torrent.downloadSpeed)} />
      <InfoRow label="Up Speed" value={formatSpeed(torrent.uploadSpeed)} />
      <InfoRow label="ETA" value={formatEta(torrent.eta)} />

      {/* Connection info section */}
      <SectionHeader title="Connections" />
      <InfoRow label="Peers" value={torrent.peers.toString()} />
      <InfoRow label="Seeds" value={torrent.seeds.toString()} />

      {/* Piece info section */}
      <SectionHeader title="Pieces" />
      <InfoRow label="Piece Size" value={formatBytes(torrent.pieceLength)} />
      <InfoRow label="Piece Count" value={torrent.pieceCount.toString()} />

      {/* Error message if applicable */}
      {torrent.error && (
        <Box marginTop={1}>
          <Text color="red">Error: {torrent.error}</Text>
        </Box>
      )}

      {/* File list if requested */}
      {showFiles && <FileList files={torrent.files} />}

      {/* Tracker list if requested */}
      {showTrackers && <TrackerList trackers={torrent.trackers} />}

      {/* Summary footer */}
      <Box marginTop={1}>
        <Text dimColor>
          {torrent.files.length} file(s), {torrent.trackers.length} tracker(s)
        </Text>
      </Box>
    </Box>
  );
};

// =============================================================================
// Main Info Function
// =============================================================================

/**
 * Execute the info command (non-interactive).
 *
 * @param options - Command options
 */
export async function executeInfo(options: InfoCommandOptions): Promise<void> {
  const { torrentId, showFiles = true, showTrackers = true } = options;

  const engine = new TormEngine();

  try {
    await engine.start();

    const torrent = findTorrent(engine, torrentId);

    if (!torrent) {
      console.error(errorMessage(`Torrent not found: ${torrentId}`));
      await engine.stop();
      process.exit(1);
    }

    // Print torrent info
    console.log();
    console.log(colorize(torrent.name, ansiColors.bold));
    console.log();

    // General info
    console.log(colorize('General', ansiColors.cyan));
    console.log(formatKeyValue('Hash', torrent.infoHash));
    console.log(formatKeyValue('Status', getStateName(torrent.state)));
    console.log(formatKeyValue('Size', formatBytes(torrent.size)));
    console.log(formatKeyValue('Progress', formatProgress(torrent.progress)));
    console.log();

    // Transfer info
    console.log(colorize('Transfer', ansiColors.cyan));
    console.log(formatKeyValue('Downloaded', formatBytes(torrent.downloaded)));
    console.log(formatKeyValue('Uploaded', formatBytes(torrent.uploaded)));
    console.log(formatKeyValue('Down Speed', formatSpeed(torrent.downloadSpeed)));
    console.log(formatKeyValue('Up Speed', formatSpeed(torrent.uploadSpeed)));
    console.log(formatKeyValue('ETA', formatEta(torrent.eta)));
    console.log();

    // Connection info
    console.log(colorize('Connections', ansiColors.cyan));
    console.log(formatKeyValue('Peers', torrent.peers.toString()));
    console.log(formatKeyValue('Seeds', torrent.seeds.toString()));
    console.log();

    // Pieces info
    console.log(colorize('Pieces', ansiColors.cyan));
    console.log(formatKeyValue('Piece Size', formatBytes(torrent.pieceLength)));
    console.log(formatKeyValue('Piece Count', torrent.pieceCount.toString()));
    console.log();

    // File list
    if (showFiles && torrent.files.length > 0) {
      console.log(colorize('Files', ansiColors.cyan));
      torrent.files.forEach((file, index) => {
        console.log(`  ${(index + 1).toString().padStart(3)}. ${file.path} (${formatBytes(file.size)})`);
      });
      console.log();
    }

    // Tracker list
    if (showTrackers && torrent.trackers.length > 0) {
      console.log(colorize('Trackers', ansiColors.cyan));
      torrent.trackers.forEach((tracker, index) => {
        console.log(`  ${(index + 1).toString().padStart(3)}. ${tracker.url} [${tracker.status}]`);
      });
      console.log();
    }

    await engine.stop();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(errorMessage(message));

    if (engine.isRunning()) {
      await engine.stop();
    }

    process.exit(1);
  }
}

/**
 * Info command component using Ink for rendering
 */
export function InfoCommand({
  torrentId,
  showFiles = true,
  showTrackers = true,
}: InfoCommandOptions): React.ReactElement {
  const [torrent, setTorrent] = useState<Torrent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const doInfo = async () => {
      const engine = new TormEngine();

      try {
        await engine.start();

        const foundTorrent = findTorrent(engine, torrentId);
        if (!foundTorrent) {
          setError(`Torrent not found: ${torrentId}`);
        } else {
          setTorrent(foundTorrent);
        }

        await engine.stop();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        if (engine.isRunning()) {
          await engine.stop();
        }
      } finally {
        setLoading(false);
      }
    };

    doInfo();
  }, [torrentId]);

  return (
    <InfoResult
      torrent={torrent}
      error={error}
      loading={loading}
      showFiles={showFiles}
      showTrackers={showTrackers}
    />
  );
}

/**
 * Run the info command with Ink rendering
 */
export function runInfo(options: InfoCommandOptions): void {
  const { waitUntilExit } = render(<InfoCommand {...options} />);
  waitUntilExit().then(() => {
    process.exit(0);
  });
}

export default executeInfo;
