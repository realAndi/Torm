/**
 * Remove command for Torm CLI.
 *
 * Removes a torrent from the engine, optionally deleting downloaded files.
 *
 * @module cli/commands/remove
 */

import React, { useEffect, useState } from 'react';
import { render, Text, Box } from 'ink';
import { TormEngine } from '../../engine/TormEngine.js';
import { Torrent } from '../../engine/types.js';
import {
  successMessage,
  errorMessage,
  warnMessage,
  parseTorrentId,
  truncateText,
  formatBytes,
} from '../utils/output.js';

// =============================================================================
// Types
// =============================================================================

export interface RemoveCommandOptions {
  /** Torrent ID (info hash or prefix) */
  torrentId: string;
  /** Whether to delete downloaded files */
  deleteFiles?: boolean;
  /** Skip confirmation prompt */
  force?: boolean;
}

interface RemoveResultProps {
  torrent: Torrent | null;
  error: string | null;
  loading: boolean;
  success: boolean;
  deletedFiles: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find a torrent by ID (full hash or prefix)
 */
function findTorrent(engine: TormEngine, torrentId: string): { torrent: Torrent | undefined; hash: string } {
  const { type, value } = parseTorrentId(torrentId);

  if (type === 'hash') {
    return { torrent: engine.getTorrent(value), hash: value };
  }

  // Search by prefix
  const torrents = engine.getAllTorrents();
  const matches = torrents.filter((t) => t.infoHash.startsWith(value));

  if (matches.length === 0) {
    return { torrent: undefined, hash: value };
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous torrent ID "${torrentId}" matches ${matches.length} torrents. ` +
      'Please provide a longer prefix.'
    );
  }

  return { torrent: matches[0], hash: matches[0].infoHash };
}

// =============================================================================
// Components
// =============================================================================

/**
 * Component to display the result of removing a torrent
 */
const RemoveResult: React.FC<RemoveResultProps> = ({
  torrent,
  error,
  loading,
  success,
  deletedFiles,
}) => {
  if (loading) {
    return (
      <Box>
        <Text color="cyan">Removing torrent...</Text>
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

  if (success && torrent) {
    return (
      <Box flexDirection="column">
        <Text color="green">[OK] Torrent removed</Text>
        <Box marginTop={1}>
          <Text dimColor>Name: </Text>
          <Text>{truncateText(torrent.name, 50)}</Text>
        </Box>
        <Box>
          <Text dimColor>Hash: </Text>
          <Text>{torrent.infoHash}</Text>
        </Box>
        <Box>
          <Text dimColor>Size: </Text>
          <Text>{formatBytes(torrent.size)}</Text>
        </Box>
        {deletedFiles && (
          <Box marginTop={1}>
            <Text color="yellow">[WARN] Downloaded files were also deleted</Text>
          </Box>
        )}
      </Box>
    );
  }

  return null;
};

// =============================================================================
// Main Remove Function
// =============================================================================

/**
 * Execute the remove command (non-interactive).
 *
 * @param options - Command options
 */
export async function executeRemove(options: RemoveCommandOptions): Promise<void> {
  const { torrentId, deleteFiles = false, force = false } = options;

  const engine = new TormEngine();

  try {
    await engine.start();

    const { torrent, hash } = findTorrent(engine, torrentId);

    if (!torrent) {
      console.error(errorMessage(`Torrent not found: ${torrentId}`));
      await engine.stop();
      process.exit(1);
    }

    // Show warning if deleting files
    if (deleteFiles && !force) {
      console.log(warnMessage('This will also delete downloaded files!'));
      console.log(`  Name: ${truncateText(torrent.name, 50)}`);
      console.log(`  Size: ${formatBytes(torrent.size)}`);
      console.log();
      // In a real implementation, we would prompt for confirmation here
      // For now, we proceed with the removal
    }

    // Remove the torrent
    await engine.removeTorrent(hash, deleteFiles);

    console.log(successMessage('Torrent removed'));
    console.log(`  Name: ${truncateText(torrent.name, 50)}`);
    console.log(`  Hash: ${hash}`);

    if (deleteFiles) {
      console.log();
      console.log(warnMessage('Downloaded files were also deleted'));
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
 * Remove command component using Ink for rendering
 */
export function RemoveCommand({
  torrentId,
  deleteFiles = false,
  force: _force = false,
}: RemoveCommandOptions): React.ReactElement {
  const [torrent, setTorrent] = useState<Torrent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const doRemove = async () => {
      const engine = new TormEngine();

      try {
        await engine.start();

        const { torrent: foundTorrent, hash } = findTorrent(engine, torrentId);

        if (!foundTorrent) {
          setError(`Torrent not found: ${torrentId}`);
          await engine.stop();
          setLoading(false);
          return;
        }

        // Store torrent info before removal
        setTorrent(foundTorrent);

        await engine.removeTorrent(hash, deleteFiles);
        setSuccess(true);
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

    doRemove();
  }, [torrentId, deleteFiles]);

  return (
    <RemoveResult
      torrent={torrent}
      error={error}
      loading={loading}
      success={success}
      deletedFiles={deleteFiles}
    />
  );
}

/**
 * Run the remove command with Ink rendering
 */
export function runRemove(options: RemoveCommandOptions): void {
  const { waitUntilExit } = render(<RemoveCommand {...options} />);
  waitUntilExit().then(() => {
    process.exit(0);
  });
}

export default executeRemove;
