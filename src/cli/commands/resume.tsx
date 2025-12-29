/**
 * Resume command for Torm CLI.
 *
 * Resumes a paused torrent (alias: start).
 *
 * @module cli/commands/resume
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

export interface ResumeCommandOptions {
  /** Torrent ID (info hash or prefix) */
  torrentId: string;
}

interface ResumeResultProps {
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
function findTorrent(
  engine: TormEngine,
  torrentId: string
): { torrent: Torrent | undefined; hash: string } {
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
 * Component to display the result of resuming a torrent
 */
const ResumeResult: React.FC<ResumeResultProps> = ({
  torrent,
  error,
  loading,
  success,
}) => {
  if (loading) {
    return (
      <Box>
        <Text color="cyan">Resuming torrent...</Text>
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
        <Text color="green">[OK] Torrent resumed</Text>
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
// Main Resume Function
// =============================================================================

/**
 * Execute the resume command (non-interactive).
 *
 * @param options - Command options
 */
export async function executeResume(
  options: ResumeCommandOptions
): Promise<void> {
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

    // Resume the torrent using startTorrent
    await engine.startTorrent(hash);

    console.log(successMessage('Torrent resumed'));
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
 * Resume command component using Ink for rendering
 */
export function ResumeCommand({
  torrentId,
}: ResumeCommandOptions): React.ReactElement {
  const [torrent, setTorrent] = useState<Torrent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const doResume = async () => {
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

        await engine.startTorrent(hash);
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

    doResume();
  }, [torrentId]);

  return (
    <ResumeResult
      torrent={torrent}
      error={error}
      loading={loading}
      success={success}
    />
  );
}

/**
 * Run the resume command with Ink rendering
 */
export function runResume(options: ResumeCommandOptions): void {
  const { waitUntilExit } = render(<ResumeCommand {...options} />);
  waitUntilExit().then(() => {
    process.exit(0);
  });
}

// Also export as start for alias support
export const executeStart = executeResume;
export const StartCommand = ResumeCommand;
export const runStart = runResume;

export default executeResume;
