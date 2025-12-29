/**
 * Daemon Manager for Torm
 *
 * Manages the daemon process lifecycle: spawning as a background process,
 * tracking PID, checking status, and shutting down.
 *
 * @module daemon/manager
 */

import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { homedir } from 'os';
import { DaemonClient } from './client.js';
import { DEFAULT_SOCKET_PATH } from './protocol.js';

// =============================================================================
// Types
// =============================================================================

export interface DaemonManagerOptions {
  /** Path to Unix socket (default: /tmp/torm.sock) */
  socketPath?: string;

  /** Path to PID file (default: ~/.torm/daemon.pid) */
  pidFile?: string;

  /** Path to log file (default: ~/.torm/daemon.log) */
  logFile?: string;

  /** Path to data directory (default: ~/.torm) */
  dataDir?: string;
}

export interface DaemonInfo {
  /** Whether daemon is running */
  running: boolean;

  /** Process ID if running */
  pid?: number;

  /** Daemon uptime in seconds */
  uptime?: number;

  /** Number of active torrents */
  torrents?: number;

  /** Total download speed in bytes/second */
  downloadSpeed?: number;

  /** Total upload speed in bytes/second */
  uploadSpeed?: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Check if a process with the given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 tests if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// DaemonManager Class
// =============================================================================

export class DaemonManager {
  private socketPath: string;
  private pidFile: string;
  private logFile: string;
  private dataDir: string;

  constructor(options: DaemonManagerOptions = {}) {
    this.socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
    this.pidFile = expandPath(options.pidFile ?? '~/.torm/daemon.pid');
    this.logFile = expandPath(options.logFile ?? '~/.torm/daemon.log');
    this.dataDir = expandPath(options.dataDir ?? '~/.torm');
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Start the daemon process
   *
   * @returns The PID of the started daemon
   * @throws If daemon is already running or fails to start
   */
  async start(): Promise<number> {
    // Check if already running
    if (await this.isRunning()) {
      const pid = await this.getPid();
      throw new Error(`Daemon is already running (PID: ${pid})`);
    }

    // Ensure data directory exists
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }

    // Ensure PID file directory exists
    const pidDir = dirname(this.pidFile);
    if (!existsSync(pidDir)) {
      await mkdir(pidDir, { recursive: true });
    }

    // Find the daemon entry point
    // This should be a file that imports and runs the DaemonServer
    const daemonScript = await this.findDaemonScript();

    // Ensure log file directory exists and create/open log file for output
    const logDir = dirname(this.logFile);
    if (!existsSync(logDir)) {
      await mkdir(logDir, { recursive: true });
    }

    // Use Bun.spawn for better compatibility
    const proc = Bun.spawn(['bun', 'run', daemonScript], {
      cwd: dirname(daemonScript),
      env: {
        ...process.env,
        TORM_DAEMON: '1',
        TORM_SOCKET_PATH: this.socketPath,
        TORM_LOG_FILE: this.logFile,
        TORM_DATA_DIR: this.dataDir,
      },
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
    });

    const pid = proc.pid;
    if (!pid) {
      throw new Error('Failed to start daemon: no PID returned');
    }

    // Unref so parent can exit - Bun.spawn processes are automatically detached
    proc.unref();

    // Write PID file
    await writeFile(this.pidFile, pid.toString());

    // Wait for daemon to be ready (socket available)
    // Give the process a moment to start before first check
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Quick polling for daemon readiness
    const maxWait = 10000; // 10 seconds should be plenty
    const waitInterval = 100;
    let waited = 0;

    while (waited < maxWait) {
      // Try to connect
      const client = new DaemonClient({
        socketPath: this.socketPath,
        connectTimeout: 1000,
      });
      try {
        await client.connect();
        await client.ping();
        client.disconnect();
        return pid;
      } catch {
        client.disconnect();
        // Keep waiting
      }

      await new Promise((resolve) => setTimeout(resolve, waitInterval));
      waited += waitInterval;
    }

    // Don't throw - return the PID and let caller handle connection later
    // The daemon may still be starting up
    return pid;
  }

  /**
   * Stop the daemon process
   *
   * @throws If daemon is not running or fails to stop
   */
  async stop(): Promise<void> {
    const pid = await this.getPid();
    const socketExists = existsSync(this.socketPath);

    if (!pid && !socketExists) {
      throw new Error('Daemon is not running');
    }

    // Try graceful shutdown via client first
    if (socketExists) {
      const client = new DaemonClient({
        socketPath: this.socketPath,
        connectTimeout: 500,
      });
      try {
        await client.connect();
        await client.shutdown();
        client.disconnect();

        // Brief wait for graceful shutdown
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch {
        client.disconnect();
      }
    }

    // Check if process is still running by PID and kill if needed
    if (pid && isProcessRunning(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process may already be dead
      }

      // Wait briefly for SIGTERM
      const maxWait = 2000;
      const waitInterval = 50;
      let waited = 0;

      while (waited < maxWait && isProcessRunning(pid)) {
        await new Promise((resolve) => setTimeout(resolve, waitInterval));
        waited += waitInterval;
      }

      // Force kill if still running
      if (isProcessRunning(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process may already be dead
        }
      }
    }

    // Clean up files
    await this.cleanup();
  }

  /**
   * Get daemon status information
   */
  async getStatus(): Promise<DaemonInfo> {
    const pid = await this.getPid();
    const running = await this.isRunning();

    if (!running) {
      return { running: false };
    }

    // Get detailed status from daemon
    const client = new DaemonClient({ socketPath: this.socketPath });
    try {
      await client.connect();
      const status = await client.getStatus();
      client.disconnect();

      return {
        running: true,
        pid: pid ?? undefined,
        uptime: status.uptime,
        torrents: status.torrents,
        downloadSpeed: status.downloadSpeed,
        uploadSpeed: status.uploadSpeed,
      };
    } catch {
      client.disconnect();
      return {
        running: true,
        pid: pid ?? undefined,
      };
    }
  }

  /**
   * Check if daemon is running
   */
  async isRunning(): Promise<boolean> {
    // First check if socket exists and is responsive
    const client = new DaemonClient({
      socketPath: this.socketPath,
      connectTimeout: 1000,
    });

    try {
      await client.connect();
      await client.ping();
      client.disconnect();
      return true;
    } catch {
      client.disconnect();
    }

    // Fall back to PID check
    const pid = await this.getPid();
    if (pid && isProcessRunning(pid)) {
      return true;
    }

    return false;
  }

  /**
   * Get the daemon PID from the PID file
   */
  async getPid(): Promise<number | null> {
    if (!existsSync(this.pidFile)) {
      return null;
    }

    try {
      const content = await readFile(this.pidFile, 'utf-8');
      const pid = parseInt(content.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * Ensure daemon is running, starting it if necessary
   *
   * @returns The PID of the (possibly newly started) daemon
   */
  async ensureRunning(): Promise<number> {
    if (await this.isRunning()) {
      const pid = await this.getPid();
      return pid ?? 0;
    }

    return this.start();
  }

  /**
   * Get a connected client to the daemon
   *
   * @param ensureRunning - Start daemon if not running (default: true)
   * @returns Connected DaemonClient
   */
  async getClient(ensureRunning = true): Promise<DaemonClient> {
    if (ensureRunning) {
      await this.ensureRunning();
    }

    const client = new DaemonClient({ socketPath: this.socketPath });
    await client.connect();
    return client;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Clean up stale PID and socket files
   */
  private async cleanup(): Promise<void> {
    // Remove PID file
    if (existsSync(this.pidFile)) {
      try {
        await unlink(this.pidFile);
      } catch {
        // Ignore errors
      }
    }

    // Remove socket file
    if (existsSync(this.socketPath)) {
      try {
        await unlink(this.socketPath);
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Find the daemon entry point script
   */
  private async findDaemonScript(): Promise<string> {
    // Get the project root by looking for package.json
    let projectRoot = process.cwd();

    // Try to find project root from import.meta.url
    const currentFile = import.meta.url.replace('file://', '');
    let searchDir = dirname(currentFile);

    // Walk up to find package.json
    for (let i = 0; i < 10; i++) {
      if (existsSync(resolve(searchDir, 'package.json'))) {
        projectRoot = searchDir;
        break;
      }
      const parent = dirname(searchDir);
      if (parent === searchDir) break;
      searchDir = parent;
    }

    const possiblePaths = [
      // Source file (development)
      resolve(projectRoot, 'src', 'daemon', 'entry.ts'),
      // Built daemon entry
      resolve(projectRoot, 'dist', 'daemon', 'entry.js'),
      // Relative to current file (for unbundled)
      resolve(dirname(currentFile), 'entry.ts'),
      resolve(dirname(currentFile), 'entry.js'),
    ];

    for (const scriptPath of possiblePaths) {
      if (existsSync(scriptPath)) {
        return scriptPath;
      }
    }

    // Default to source path
    return possiblePaths[0];
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

// Default manager instance
let defaultManager: DaemonManager | null = null;

/**
 * Get the default daemon manager
 */
export function getDefaultManager(): DaemonManager {
  if (!defaultManager) {
    defaultManager = new DaemonManager();
  }
  return defaultManager;
}

/**
 * Start the daemon
 */
export async function startDaemon(
  options?: DaemonManagerOptions
): Promise<number> {
  const manager = options ? new DaemonManager(options) : getDefaultManager();
  return manager.start();
}

/**
 * Stop the daemon
 */
export async function stopDaemon(
  options?: DaemonManagerOptions
): Promise<void> {
  const manager = options ? new DaemonManager(options) : getDefaultManager();
  return manager.stop();
}

/**
 * Get daemon status
 */
export async function getDaemonStatus(
  options?: DaemonManagerOptions
): Promise<DaemonInfo> {
  const manager = options ? new DaemonManager(options) : getDefaultManager();
  return manager.getStatus();
}

/**
 * Check if daemon is running
 */
export async function isDaemonRunning(
  options?: DaemonManagerOptions
): Promise<boolean> {
  const manager = options ? new DaemonManager(options) : getDefaultManager();
  return manager.isRunning();
}

/**
 * Ensure daemon is running
 */
export async function ensureDaemonRunning(
  options?: DaemonManagerOptions
): Promise<number> {
  const manager = options ? new DaemonManager(options) : getDefaultManager();
  return manager.ensureRunning();
}

/**
 * Get a connected client to the daemon
 */
export async function getDaemonClient(
  options?: DaemonManagerOptions & { ensureRunning?: boolean }
): Promise<DaemonClient> {
  const manager = options ? new DaemonManager(options) : getDefaultManager();
  return manager.getClient(options?.ensureRunning ?? true);
}

// =============================================================================
// Exports
// =============================================================================

export default DaemonManager;
