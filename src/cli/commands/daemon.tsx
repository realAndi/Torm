/**
 * Daemon command for Torm CLI.
 *
 * Manages the background daemon process.
 *
 * @module cli/commands/daemon
 */

import React, { useEffect, useState } from 'react';
import { render, Text, Box } from 'ink';
import {
  DaemonManager,
  type DaemonInfo,
} from '../../daemon/index.js';
import {
  formatBytes,
  formatDuration,
  successMessage,
  errorMessage,
  formatKeyValue,
} from '../utils/output.js';

// =============================================================================
// Types
// =============================================================================

export type DaemonAction = 'start' | 'stop' | 'status' | 'restart';

export interface DaemonCommandOptions {
  action: DaemonAction;
}

interface DaemonResultProps {
  info: DaemonInfo | null;
  action: DaemonAction;
  error: string | null;
  loading: boolean;
  message: string | null;
}

// =============================================================================
// Components
// =============================================================================

/**
 * Component to display daemon status
 */
const DaemonStatusDisplay: React.FC<{ info: DaemonInfo }> = ({ info }) => {
  if (!info.running) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="yellow">Daemon is not running</Text>
        <Box marginTop={1}>
          <Text dimColor>Start with: </Text>
          <Text color="cyan">torm daemon start</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color="green" bold>Daemon is running</Text>
      <Box marginTop={1} flexDirection="column" gap={0}>
        {info.pid && (
          <Box>
            <Text dimColor>PID:            </Text>
            <Text>{info.pid}</Text>
          </Box>
        )}
        {info.uptime !== undefined && (
          <Box>
            <Text dimColor>Uptime:         </Text>
            <Text>{formatDuration(info.uptime)}</Text>
          </Box>
        )}
        {info.torrents !== undefined && (
          <Box>
            <Text dimColor>Active torrents:</Text>
            <Text> {info.torrents}</Text>
          </Box>
        )}
        {info.downloadSpeed !== undefined && (
          <Box>
            <Text dimColor>Download:       </Text>
            <Text>{formatBytes(info.downloadSpeed)}/s</Text>
          </Box>
        )}
        {info.uploadSpeed !== undefined && (
          <Box>
            <Text dimColor>Upload:         </Text>
            <Text>{formatBytes(info.uploadSpeed)}/s</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

/**
 * Component to display the result of a daemon action
 */
const DaemonResult: React.FC<DaemonResultProps> = ({ info, action, error, loading, message }) => {
  if (loading) {
    const actionText = {
      start: 'Starting daemon...',
      stop: 'Stopping daemon...',
      status: 'Checking daemon status...',
      restart: 'Restarting daemon...',
    }[action];

    return (
      <Box flexDirection="column">
        <Text color="cyan">{actionText}</Text>
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

  if (message) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="green" bold>{message}</Text>
      </Box>
    );
  }

  if (info && action === 'status') {
    return <DaemonStatusDisplay info={info} />;
  }

  return null;
};

// =============================================================================
// Main Daemon Functions
// =============================================================================

/**
 * Execute the daemon start command
 */
async function executeStart(): Promise<{ pid: number }> {
  const manager = new DaemonManager();

  // Check if already running
  const running = await manager.isRunning();
  if (running) {
    const info = await manager.getStatus();
    throw new Error(`Daemon is already running (PID: ${info.pid})`);
  }

  const pid = await manager.start();
  return { pid };
}

/**
 * Execute the daemon stop command
 */
async function executeStop(): Promise<void> {
  const manager = new DaemonManager();

  const running = await manager.isRunning();
  if (!running) {
    throw new Error('Daemon is not running');
  }

  await manager.stop();
}

/**
 * Execute the daemon status command
 */
async function executeStatus(): Promise<DaemonInfo> {
  const manager = new DaemonManager();
  return manager.getStatus();
}

/**
 * Execute the daemon command.
 *
 * @param options - Command options
 */
export async function executeDaemon(options: DaemonCommandOptions): Promise<void> {
  const { action } = options;

  try {
    switch (action) {
      case 'start': {
        const { pid } = await executeStart();
        console.log(successMessage(`Daemon started (PID: ${pid})`));
        break;
      }

      case 'stop': {
        await executeStop();
        console.log(successMessage('Daemon stopped'));
        break;
      }

      case 'status': {
        const info = await executeStatus();
        if (!info.running) {
          console.log('Daemon is not running');
        } else {
          console.log(successMessage('Daemon is running'));
          console.log(formatKeyValue('PID', String(info.pid ?? 'unknown')));
          if (info.uptime !== undefined) {
            console.log(formatKeyValue('Uptime', formatDuration(info.uptime)));
          }
          if (info.torrents !== undefined) {
            console.log(formatKeyValue('Torrents', String(info.torrents)));
          }
          if (info.downloadSpeed !== undefined) {
            console.log(formatKeyValue('Download', `${formatBytes(info.downloadSpeed)}/s`));
          }
          if (info.uploadSpeed !== undefined) {
            console.log(formatKeyValue('Upload', `${formatBytes(info.uploadSpeed)}/s`));
          }
        }
        break;
      }

      case 'restart': {
        try {
          await executeStop();
        } catch {
          // Ignore - daemon may not have been running
        }
        const { pid } = await executeStart();
        console.log(successMessage(`Daemon restarted (PID: ${pid})`));
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(errorMessage(message));
    process.exit(1);
  }
}

/**
 * Interactive daemon command using Ink for rendering
 */
export function DaemonCommand({ action }: DaemonCommandOptions): React.ReactElement {
  const [info, setInfo] = useState<DaemonInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const doAction = async () => {
      try {
        switch (action) {
          case 'start': {
            const { pid } = await executeStart();
            setMessage(`Daemon started (PID: ${pid})`);
            break;
          }

          case 'stop': {
            await executeStop();
            setMessage('Daemon stopped');
            break;
          }

          case 'status': {
            const status = await executeStatus();
            setInfo(status);
            break;
          }

          case 'restart': {
            try {
              await executeStop();
            } catch {
              // Ignore
            }
            const { pid } = await executeStart();
            setMessage(`Daemon restarted (PID: ${pid})`);
            break;
          }
        }
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        setError(errMessage);
      } finally {
        setLoading(false);
      }
    };

    doAction();
  }, [action]);

  return <DaemonResult info={info} action={action} error={error} loading={loading} message={message} />;
}

/**
 * Run the daemon command with Ink rendering
 */
export function runDaemon(options: DaemonCommandOptions): void {
  const { waitUntilExit } = render(<DaemonCommand {...options} />);
  waitUntilExit().then(() => {
    process.exit(0);
  });
}

export default executeDaemon;
