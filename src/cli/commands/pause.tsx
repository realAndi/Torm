/**
 * Pause command for Torm CLI.
 *
 * Pauses an active torrent.
 *
 * @module cli/commands/pause
 */

import React, { useEffect, useState } from 'react';
import { render, Text, Box } from 'ink';
import { TormEngine } from '../../engine/TormEngine.js';
import { Torrent } from '../../engine/types.js';
import {
  successMessage,
  errorMessage,
  parseTorrentId,
  truncateText,
} from '../utils/output.js';

// =============================================================================
// Types
// =============================================================================

export interface PauseCommandOptions {
  /** Torrent ID (info hash or prefix) */
  torrentId: string;
}

interface PauseResultProps {
  torrent: Torrent | null;
  error: string | null;
  loading: boolean;
  success: boolean;
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
 * Component to display the result of pausing a torrent
 */
const PauseResult: React.FC<PauseResultProps> = ({ torrent, error, loading, success }) => {
  if (loading) {
    return (
      <Box>
        <Text color="cyan">Pausing torrent...</Text>
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
        <Text color="green">[OK] Torrent paused</Text>
        <Box marginTop={1}>
          <Text dimColor>Name: </Text>
          <Text>{truncateText(torrent.name, 50)}</Text>
        </Box>
        <Box>
          <Text dimColor>Hash: </Text>
          <Text>{torrent.infoHash}</Text>
        </Box>
      </Box>
    );
  }

  return null;
};

// =============================================================================
// Main Pause Function
// =============================================================================

/**
 * Execute the pause command (non-interactive).
 *
 * @param options - Command options
 */
export async function executePause(options: PauseCommandOptions): Promise<void> {
  const { torrentId } = options;

  const engine = new TormEngine();

  try {
    await engine.start();

    const { torrent, hash } = findTorrent(engine, torrentId);

    if (!torrent) {
      console.error(errorMessage(`Torrent not found: ${torrentId}`));
      await engine.stop();
      process.exit(1);
    }

    // Pause the torrent
    await engine.pauseTorrent(hash);

    console.log(successMessage('Torrent paused'));
    console.log(`  Name: ${truncateText(torrent.name, 50)}`);
    console.log(`  Hash: ${hash}`);

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
 * Pause command component using Ink for rendering
 */
export function PauseCommand({ torrentId }: PauseCommandOptions): React.ReactElement {
  const [torrent, setTorrent] = useState<Torrent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const doPause = async () => {
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

        await engine.pauseTorrent(hash);
        setTorrent(foundTorrent);
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

    doPause();
  }, [torrentId]);

  return <PauseResult torrent={torrent} error={error} loading={loading} success={success} />;
}

/**
 * Run the pause command with Ink rendering
 */
export function runPause(options: PauseCommandOptions): void {
  const { waitUntilExit } = render(<PauseCommand {...options} />);
  waitUntilExit().then(() => {
    process.exit(0);
  });
}

export default executePause;
