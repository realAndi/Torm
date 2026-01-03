/**
 * Hook for checking npm registry for updates
 *
 * Periodically checks if a newer version of torm is available on npm.
 *
 * @module ui/hooks/useUpdateChecker
 */

import { useState, useEffect, useCallback } from 'react';
import { VERSION } from '../../shared/constants.js';

// Package name on npm
const PACKAGE_NAME = 'torm';

// Check interval: 30 minutes
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Initial delay before first check: 5 seconds (let UI load first)
const INITIAL_DELAY_MS = 5000;

export interface UpdateInfo {
  /** Whether an update is available */
  updateAvailable: boolean;
  /** Current installed version */
  currentVersion: string;
  /** Latest version on npm */
  latestVersion: string | null;
  /** Error if check failed */
  error: string | null;
  /** Whether currently checking */
  isChecking: boolean;
}

/**
 * Get current package version
 */
function getCurrentVersion(): string {
  return VERSION;
}

/**
 * Compare semantic versions
 * Returns true if latestVersion is newer than currentVersion
 */
function isNewerVersion(currentVersion: string, latestVersion: string): boolean {
  const current = currentVersion.split('.').map(Number);
  const latest = latestVersion.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const c = current[i] || 0;
    const l = latest[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }

  return false;
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`);

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  const data = await response.json();
  return data.version;
}

/**
 * Hook to check for updates from npm
 *
 * @example
 * ```tsx
 * const { updateAvailable, latestVersion } = useUpdateChecker();
 *
 * if (updateAvailable) {
 *   console.log(`Update available: ${latestVersion}`);
 * }
 * ```
 */
export function useUpdateChecker(): UpdateInfo {
  const [currentVersion] = useState(() => getCurrentVersion());
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const checkForUpdates = useCallback(async () => {
    setIsChecking(true);
    setError(null);

    try {
      const latest = await fetchLatestVersion();
      setLatestVersion(latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    // Initial check after delay
    const initialTimeout = setTimeout(() => {
      checkForUpdates();
    }, INITIAL_DELAY_MS);

    // Periodic checks
    const interval = setInterval(() => {
      checkForUpdates();
    }, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkForUpdates]);

  const updateAvailable =
    latestVersion !== null && isNewerVersion(currentVersion, latestVersion);

  return {
    updateAvailable,
    currentVersion,
    latestVersion,
    error,
    isChecking,
  };
}

export default useUpdateChecker;
