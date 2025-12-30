/**
 * Platform-specific utilities for cross-platform compatibility.
 *
 * Provides abstractions for file paths, IPC mechanisms, clipboard access,
 * and process management that work across Windows, macOS, and Linux.
 *
 * @module utils/platform
 */

import { platform, homedir } from 'os';
import { join, resolve } from 'path';

/** Current platform is Windows */
export const isWindows = platform() === 'win32';

/** Current platform is macOS */
export const isMac = platform() === 'darwin';

/** Current platform is Linux */
export const isLinux = platform() === 'linux';

/**
 * Expands a path that may contain ~ to the user's home directory.
 *
 * @param path - Path that may start with ~/ or ~
 * @returns Expanded absolute path
 */
export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }
  if (path.startsWith('~')) {
    return resolve(homedir(), path.slice(1));
  }
  return path;
}

/**
 * Gets the platform-appropriate default data directory.
 *
 * - Windows: %LOCALAPPDATA%/torm
 * - Unix/macOS: ~/.torm
 *
 * @returns Default data directory path
 */
export function getDefaultDataDir(): string {
  if (isWindows) {
    return join(process.env.LOCALAPPDATA || homedir(), 'torm');
  }
  return join(homedir(), '.torm');
}

/**
 * Gets the platform-appropriate default socket/pipe path for IPC.
 *
 * - Windows: Named Pipe at \\.\pipe\torm
 * - Unix/macOS: Unix socket at /tmp/torm.sock
 *
 * @returns Default socket/pipe path
 */
export function getDefaultSocketPath(): string {
  if (isWindows) {
    return '\\\\.\\pipe\\torm';
  }
  return '/tmp/torm.sock';
}

/**
 * Gets the platform-appropriate default download directory.
 *
 * @returns Default download directory path
 */
export function getDefaultDownloadPath(): string {
  return join(getDefaultDataDir(), 'downloads');
}

/**
 * Gets the platform-appropriate default log file path.
 *
 * @returns Default log file path
 */
export function getDefaultLogFile(): string {
  return join(getDefaultDataDir(), 'daemon.log');
}

/**
 * Gets the platform-appropriate default PID file path.
 *
 * @returns Default PID file path
 */
export function getDefaultPidFile(): string {
  return join(getDefaultDataDir(), 'daemon.pid');
}

/**
 * Reads text content from the system clipboard.
 *
 * Platform-specific implementations:
 * - macOS: Uses pbpaste
 * - Windows: Uses PowerShell Get-Clipboard
 * - Linux: Uses xclip (falls back to xsel)
 *
 * @returns Clipboard content or null if empty/unavailable
 */
export function readClipboard(): string | null {
  try {
    if (isMac) {
      const proc = Bun.spawnSync(['pbpaste']);
      return proc.stdout.toString().trim() || null;
    } else if (isWindows) {
      const proc = Bun.spawnSync(['powershell', '-command', 'Get-Clipboard']);
      return proc.stdout.toString().trim() || null;
    } else {
      // Linux - try xclip first
      try {
        const proc = Bun.spawnSync(['xclip', '-selection', 'clipboard', '-o']);
        return proc.stdout.toString().trim() || null;
      } catch {
        // Fall back to xsel
        const proc = Bun.spawnSync(['xsel', '--clipboard', '--output']);
        return proc.stdout.toString().trim() || null;
      }
    }
  } catch {
    return null;
  }
}

/**
 * Terminates a process by PID.
 *
 * On Unix systems, sends SIGTERM for graceful shutdown or SIGKILL for forced termination.
 * On Windows, uses process.kill() which terminates the process immediately.
 *
 * @param pid - Process ID to terminate
 * @param force - If true, use SIGKILL (Unix) or immediate termination (Windows)
 */
export function terminateProcess(pid: number, force = false): void {
  if (isWindows) {
    // Windows: process.kill() terminates the process
    process.kill(pid);
  } else {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
  }
}

/**
 * Checks if a process with the given PID is running.
 *
 * @param pid - Process ID to check
 * @returns true if process is running, false otherwise
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
