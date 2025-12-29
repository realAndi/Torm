/**
 * Add command for Torm CLI.
 *
 * Adds a torrent from a magnet link or .torrent file.
 *
 * @module cli/commands/add
 */

import React, { useEffect, useState } from 'react';
import { render, Text, Box } from 'ink';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { Torrent } from '../../engine/types.js';
import { getDaemonClient } from '../../daemon/index.js';
import {
  formatBytes,
  isMagnetUri,
  successMessage,
  errorMessage,
  formatKeyValue,
} from '../utils/output.js';

// =============================================================================
// Types
// =============================================================================

export interface AddCommandOptions {
  /** The torrent source (magnet link or file path) */
  source: string;
  /** Optional download path override */
  downloadPath?: string;
  /** Whether to start the torrent immediately */
  start?: boolean;
}

interface AddResultProps {
  torrent: Torrent | null;
  error: string | null;
  loading: boolean;
}

// =============================================================================
// Components
// =============================================================================

/**
 * Component to display the result of adding a torrent
 */
const AddResult: React.FC<AddResultProps> = ({ torrent, error, loading }) => {
  if (loading) {
    return (
      <Box flexDirection="column">
        <Text color="cyan">Adding torrent...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">[ERROR] {error}</Text>
      </Box>
    );
  }

  if (torrent) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="green" bold>[OK] Torrent added successfully</Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Name:       </Text>
          <Text>{torrent.name}</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Hash:       </Text>
          <Text>{torrent.infoHash}</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Size:       </Text>
          <Text>{formatBytes(torrent.size)}</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Files:      </Text>
          <Text>{torrent.files.length} file(s)</Text>
        </Box>
      </Box>
    );
  }

  return null;
};

// =============================================================================
// Main Add Function
// =============================================================================

/**
 * Validate and prepare the source string.
 * Returns the source string to send to daemon.
 */
async function validateSource(source: string): Promise<string> {
  // Check if it's a magnet link
  if (isMagnetUri(source)) {
    return source;
  }

  // Check if it's a file path
  const absolutePath = resolve(source);
  if (existsSync(absolutePath)) {
    return absolutePath;
  }

  throw new Error(
    `Invalid torrent source: "${source}"\n` +
    'Expected a magnet link (magnet:?...) or path to a .torrent file.\n' +
    'Tip: Use quotes around magnet links or use "torm add -c" to paste from clipboard.'
  );
}

/**
 * Execute the add command.
 *
 * @param options - Command options
 */
export async function executeAdd(options: AddCommandOptions): Promise<void> {
  const { source, downloadPath, start = true } = options;

  let client;

  try {
    // Connect to daemon (starts it if not running)
    client = await getDaemonClient();

    // Prepare the source (validate and get the string source)
    // For file paths, we need to read the file and the daemon will parse it
    // Actually, the daemon only accepts string sources (magnet or file path)
    // Let's validate first
    const sourceToSend = await validateSource(source);

    // Add the torrent via daemon
    const torrent = await client.addTorrent(sourceToSend, {
      downloadPath: downloadPath,
      startImmediately: start,
    });

    // Display success
    console.log(successMessage('Torrent added successfully'));
    console.log();
    console.log(formatKeyValue('Name', torrent.name));
    console.log(formatKeyValue('Hash', torrent.infoHash));
    console.log(formatKeyValue('Size', formatBytes(torrent.size)));
    console.log(formatKeyValue('Files', `${torrent.files.length} file(s)`));

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
 * Interactive add command using Ink for rendering
 */
export function AddCommand({ source, downloadPath, start = true }: AddCommandOptions): React.ReactElement {
  const [torrent, setTorrent] = useState<Torrent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const doAdd = async () => {
      let client;

      try {
        // Connect to daemon (starts it if not running)
        client = await getDaemonClient();

        // Validate source
        const sourceToSend = await validateSource(source);

        // Add torrent via daemon
        const addedTorrent = await client.addTorrent(sourceToSend, {
          downloadPath: downloadPath,
          startImmediately: start,
        });
        setTorrent(addedTorrent);
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

    doAdd();
  }, [source, downloadPath, start]);

  return <AddResult torrent={torrent} error={error} loading={loading} />;
}

/**
 * Run the add command with Ink rendering
 */
export function runAdd(options: AddCommandOptions): void {
  const { waitUntilExit } = render(<AddCommand {...options} />);
  waitUntilExit().then(() => {
    process.exit(0);
  });
}

export default executeAdd;
