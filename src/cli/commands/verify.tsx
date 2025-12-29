/**
 * Verify command for Torm CLI.
 *
 * Re-verifies all pieces of a torrent and updates completion state.
 *
 * @module cli/commands/verify
 */

import React, { useEffect, useState } from 'react';
import { render, Text, Box } from 'ink';
import { TormEngine } from '../../engine/TormEngine.js';
import { Torrent } from '../../engine/types.js';
import {
  errorMessage,
  parseTorrentId,
  truncateText,
} from '../utils/output.js';

// =============================================================================
// Types
// =============================================================================

export interface VerifyCommandOptions {
  /** Torrent ID (info hash or prefix) */
  torrentId: string;
}

interface VerifyResultProps {
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
 * Component to display the result of verifying a torrent
 */
const VerifyResult: React.FC<VerifyResultProps> = ({ torrent, error, loading, success }) => {
  if (loading) {
    return (
      <Box>
        <Text color="cyan">Verifying torrent pieces...</Text>
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
        <Text color="green">[OK] Verification complete</Text>
        <Box marginTop={1}>
          <Text dimColor>Name: </Text>
          <Text>{truncateText(torrent.name, 50)}</Text>
        </Box>
        <Box>
          <Text dimColor>State: </Text>
          <Text>{torrent.state}</Text>
        </Box>
        <Box>
          <Text dimColor>Progress: </Text>
          <Text>{Math.floor(torrent.progress * 100)}%</Text>
        </Box>
      </Box>
    );
  }

  return null;
};

// =============================================================================
// Main Verify Function
// =============================================================================

/**
 * Execute the verify command (non-interactive).
 */
export async function executeVerify(options: VerifyCommandOptions): Promise<void> {
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

    await engine.verifyTorrent(hash);

    // Get updated torrent state
    const updated = engine.getTorrent(hash);

    console.log('[OK] Verification complete');
    console.log(`  Name: ${truncateText(torrent.name, 50)}`);
    console.log(`  State: ${updated?.state || torrent.state}`);
    console.log(`  Progress: ${Math.floor((updated?.progress || torrent.progress) * 100)}%`);

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
 * Verify command component using Ink for rendering
 */
export function VerifyCommand({ torrentId }: VerifyCommandOptions): React.ReactElement {
  const [torrent, setTorrent] = useState<Torrent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const doVerify = async () => {
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

        await engine.verifyTorrent(hash);

        // Get updated state
        const updated = engine.getTorrent(hash);
        setTorrent(updated || foundTorrent);
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

    doVerify();
  }, [torrentId]);

  return <VerifyResult torrent={torrent} error={error} loading={loading} success={success} />;
}

/**
 * Run the verify command with Ink rendering
 */
export function runVerify(options: VerifyCommandOptions): void {
  const { waitUntilExit } = render(<VerifyCommand {...options} />);
  waitUntilExit().then(() => {
    process.exit(0);
  });
}

// Also export as recheck for alias support
export const executeRecheck = executeVerify;
export const RecheckCommand = VerifyCommand;
export const runRecheck = runVerify;

export default executeVerify;
