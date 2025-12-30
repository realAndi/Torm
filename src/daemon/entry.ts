#!/usr/bin/env bun
/**
 * Daemon Entry Point for Torm
 *
 * This script is spawned as a background process by the DaemonManager.
 * It initializes and runs the DaemonServer.
 *
 * @module daemon/entry
 */

import { resolve } from 'path';
import { DaemonServer } from './server.js';
import { DEFAULT_SOCKET_PATH } from './protocol.js';
import {
  expandPath,
  isWindows,
  getDefaultLogFile,
  getDefaultDataDir,
} from '../utils/platform.js';

// =============================================================================
// Configuration from Environment
// =============================================================================

const socketPath = process.env.TORM_SOCKET_PATH ?? DEFAULT_SOCKET_PATH;
const logFile = process.env.TORM_LOG_FILE
  ? expandPath(process.env.TORM_LOG_FILE)
  : getDefaultLogFile();
const dataDir = process.env.TORM_DATA_DIR
  ? expandPath(process.env.TORM_DATA_DIR)
  : getDefaultDataDir();

// =============================================================================
// Main Entry Point
// =============================================================================

async function main(): Promise<void> {
  // Set process name for ps/htop/Activity Monitor
  process.title = 'torm_daemon';

  console.log(`[Torm Daemon] Starting...`);
  console.log(`[Torm Daemon] Socket: ${socketPath}`);
  console.log(`[Torm Daemon] Log: ${logFile}`);
  console.log(`[Torm Daemon] Data: ${dataDir}`);

  const server = new DaemonServer({
    socketPath,
    logFile,
    engineConfig: {
      dataDir,
      downloadPath: resolve(dataDir, 'downloads'),
    },
  });

  // Handle shutdown signals
  const shutdown = async (signal: string) => {
    console.log(`[Torm Daemon] Received ${signal}, shutting down...`);
    try {
      await server.stop();
      process.exit(0);
    } catch (err) {
      console.error(`[Torm Daemon] Shutdown error:`, err);
      process.exit(1);
    }
  };

  // SIGTERM is not available on Windows, only register on Unix
  if (!isWindows) {
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    console.error(`[Torm Daemon] Uncaught exception:`, err);
    server.stop().finally(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`[Torm Daemon] Unhandled rejection:`, reason);
  });

  // Start the server
  try {
    await server.start();
    console.log(`[Torm Daemon] Running`);
  } catch (err) {
    console.error(`[Torm Daemon] Failed to start:`, err);
    process.exit(1);
  }
}

// Run if this is the main module
main().catch((err) => {
  console.error(`[Torm Daemon] Fatal error:`, err);
  process.exit(1);
});
