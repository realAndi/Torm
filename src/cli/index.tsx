/**
 * Torm CLI Entry Point
 *
 * This module handles command-line argument parsing and routes
 * to the appropriate command implementations.
 *
 * @module cli
 */

import React from 'react';
import { render, Text, Box } from 'ink';
import meow from 'meow';
import { VERSION } from '../shared/constants.js';
import { readClipboard } from '../utils/platform.js';

// Import the main TUI App
import { App } from '../ui/App.js';

// Import command implementations
import { runAdd } from './commands/add.js';
import { runList } from './commands/list.js';
import { runInfo } from './commands/info.js';
import { runPause } from './commands/pause.js';
import { runResume } from './commands/resume.js';
import { runVerify } from './commands/verify.js';
import { runRemove } from './commands/remove.js';
import { runDaemon, type DaemonAction } from './commands/daemon.js';

// =============================================================================
// CLI Configuration
// =============================================================================

const cli = meow(
  `
  Usage
    $ torm <command> [options]

  Commands
    add <torrent>       Add a torrent file or magnet link
    add -c              Add torrent from clipboard
    list                List all torrents
    info <id>           Show detailed torrent information
    pause <id>          Pause a torrent
    resume <id>         Resume a paused torrent
    start <id>          Start a torrent (alias for resume)
    stop <id>           Stop a torrent (alias for pause)
    verify <id>         Re-verify pieces and update completion state
    remove <id>         Remove a torrent
    daemon <action>     Manage background daemon (start|stop|status|restart)

  Options
    --version, -v       Show version
    --help, -h          Show help
    --delete-files      Delete downloaded files (with remove command)
    --force, -f         Skip confirmation prompts
  Examples
    $ torm add ubuntu.torrent
    $ torm add "magnet:?xt=urn:btih:..."
    $ torm add ubuntu.torrent ~/Downloads
    $ torm add -c ~/Movies
    $ torm list
    $ torm info abc123
    $ torm pause abc123
    $ torm resume abc123
    $ torm remove abc123 --delete-files
    $ torm daemon start
    $ torm daemon status
`,
  {
    importMeta: import.meta,
    version: VERSION,
    flags: {
      version: {
        type: 'boolean',
        shortFlag: 'v',
      },
      deleteFiles: {
        type: 'boolean',
        default: false,
      },
      force: {
        type: 'boolean',
        shortFlag: 'f',
        default: false,
      },
      downloadPath: {
        type: 'string',
        shortFlag: 'o',
      },
      verbose: {
        type: 'boolean',
        default: false,
      },
      clipboard: {
        type: 'boolean',
        shortFlag: 'c',
        default: false,
      },
    },
  }
);

// =============================================================================
// Error Display Component
// =============================================================================

interface ErrorProps {
  message: string;
}

/**
 * Error display component
 */
function ErrorDisplay({ message }: ErrorProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="red" bold>
        Error: {message}
      </Text>
      <Box marginTop={1}>
        <Text>Run </Text>
        <Text color="yellow">torm --help</Text>
        <Text> for usage information</Text>
      </Box>
    </Box>
  );
}

// =============================================================================
// Command Routing
// =============================================================================

/**
 * Route the command to the appropriate handler
 */
function routeCommand(): void {
  const [command, ...args] = cli.input;
  const flags = cli.flags;

  // Handle version flag
  if (flags.version) {
    console.log(VERSION);
    process.exit(0);
  }

  // No command provided - launch interactive TUI
  if (!command) {
    const instance = render(<App />, { exitOnCtrlC: false });

    // Wait for TUI to exit, then show farewell message
    instance.waitUntilExit().then(() => {
      // Clear Ink's rendered output
      instance.clear();

      // Clear terminal completely including scrollback buffer
      // \x1B[2J - Clear visible screen
      // \x1B[3J - Clear scrollback buffer
      // \x1B[H - Move cursor to home position
      process.stdout.write('\x1B[2J\x1B[3J\x1B[H');

      // ANSI color codes
      const green = '\x1b[32m';
      const gray = '\x1b[90m';
      const reset = '\x1b[0m';

      // Mascot ASCII art
      const mascot = [
        '   █████   ',
        '▐█▀▀▀▀▀▀▀█▌',
        '▐▌ ■   ■ ▐▌',
        '▐▌   U   ▐▌',
        '▀▀▀▀▀▀▀▀▀▀▀',
      ];

      // Print mascot in green
      mascot.forEach((line) => {
        process.stdout.write(`${green}${line}${reset}\n`);
      });

      // Print farewell message in gray
      process.stdout.write(`${gray}Torm was here${reset}\n`);

      // Explicitly exit to ensure process terminates even if handles remain
      process.exit(0);
    });
    return;
  }

  // Route to command handlers
  switch (command.toLowerCase()) {
    case 'add': {
      let source = args[0];
      let downloadPath = args[1] || flags.downloadPath;

      // Read from clipboard if -c flag is set
      if (flags.clipboard) {
        const clipboardContent = readClipboard();
        if (!clipboardContent) {
          render(<ErrorDisplay message="Clipboard is empty or unavailable" />);
          process.exit(1);
        }
        source = clipboardContent;
        // When using clipboard, first arg becomes download path
        downloadPath = args[0] || flags.downloadPath;
      }

      if (!source) {
        render(
          <ErrorDisplay
            message={
              "Missing torrent source. Use 'torm add \"magnet:...\"' (with quotes) or 'torm add -c' to paste from clipboard"
            }
          />
        );
        process.exit(1);
      }
      runAdd({
        source,
        downloadPath,
        start: true,
      });
      break;
    }

    case 'list':
    case 'ls': {
      runList({
        verbose: flags.verbose,
      });
      break;
    }

    case 'info':
    case 'show': {
      const torrentId = args[0];
      if (!torrentId) {
        render(<ErrorDisplay message="Missing torrent ID" />);
        process.exit(1);
      }
      runInfo({
        torrentId,
        showFiles: true,
        showTrackers: true,
      });
      break;
    }

    case 'pause':
    case 'stop': {
      const torrentId = args[0];
      if (!torrentId) {
        render(<ErrorDisplay message="Missing torrent ID" />);
        process.exit(1);
      }
      runPause({
        torrentId,
      });
      break;
    }

    case 'resume':
    case 'start': {
      const torrentId = args[0];
      if (!torrentId) {
        render(<ErrorDisplay message="Missing torrent ID" />);
        process.exit(1);
      }
      runResume({
        torrentId,
      });
      break;
    }

    case 'verify':
    case 'recheck': {
      const torrentId = args[0];
      if (!torrentId) {
        render(<ErrorDisplay message="Missing torrent ID" />);
        process.exit(1);
      }
      runVerify({
        torrentId,
      });
      break;
    }

    case 'remove':
    case 'rm':
    case 'delete': {
      const torrentId = args[0];
      if (!torrentId) {
        render(<ErrorDisplay message="Missing torrent ID" />);
        process.exit(1);
      }
      runRemove({
        torrentId,
        deleteFiles: flags.deleteFiles,
        force: flags.force,
      });
      break;
    }

    case 'daemon': {
      const action = args[0] as DaemonAction | undefined;
      if (!action || !['start', 'stop', 'status', 'restart'].includes(action)) {
        render(
          <ErrorDisplay message="Missing or invalid daemon action (start|stop|status|restart)" />
        );
        process.exit(1);
      }
      runDaemon({ action });
      break;
    }

    default: {
      render(<ErrorDisplay message={`Unknown command: ${command}`} />);
      process.exit(1);
    }
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

routeCommand();
