/**
 * Hook for detecting pasted content including drag-and-dropped files.
 *
 * When files are dragged into a terminal, they are "pasted" as text paths.
 * This hook detects multi-file paste patterns and extracts .torrent file paths.
 *
 * @module ui/hooks/usePaste
 */

import { useInput } from 'ink';
import { useRef, useCallback } from 'react';

/**
 * Result of parsing pasted content
 */
export interface ParsedPaste {
  /** All valid .torrent file paths found */
  torrentFiles: string[];
  /** The raw pasted content */
  rawContent: string;
}

/**
 * Options for usePaste hook
 */
export interface UsePasteOptions {
  /** Callback when .torrent files are detected */
  onTorrentFiles: (files: string[]) => void;
  /** Callback for regular (non-file) paste */
  onRegularPaste?: (content: string) => void;
  /** Whether paste detection is enabled */
  enabled?: boolean;
  /** Debounce time in ms for collecting pasted characters (default: 50) */
  debounceMs?: number;
}

/**
 * Parse pasted content to extract file paths.
 *
 * Terminal paste behavior varies:
 * - macOS Terminal/iTerm2: space-separated paths, quoted if spaces in path
 * - Some terminals: newline-separated paths
 *
 * This parser handles:
 * - Space-separated paths (splitting on .torrent boundaries)
 * - Newline-separated paths
 * - Quoted paths (single or double quotes)
 * - Escaped spaces (\ in paths)
 */
export function parsePastedPaths(content: string): string[] {
  // First, try splitting on .torrent boundaries
  // This handles cases like: /path/file1.torrent /path/file2.torrent
  // where we need to split after each .torrent
  const torrentBoundaryRegex = /(.*?\.torrent)(?:\s+|$)/gi;
  const matches = content.match(torrentBoundaryRegex);

  if (matches && matches.length > 0) {
    return matches
      .map((m) => m.trim())
      .filter((m) => m.length > 0 && m.toLowerCase().endsWith('.torrent'));
  }

  // Fallback: traditional parsing for other file types
  const paths: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = char;
      continue;
    }

    if (char === inQuote) {
      inQuote = null;
      continue;
    }

    if (!inQuote && (char === ' ' || char === '\n' || char === '\t')) {
      if (current.trim()) {
        paths.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    paths.push(current.trim());
  }

  return paths;
}

/**
 * Filter paths to only include .torrent files
 */
export function filterTorrentFiles(paths: string[]): string[] {
  return paths.filter((path) => path.toLowerCase().endsWith('.torrent'));
}

/**
 * Expand ~ to home directory in paths
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return home + path.slice(1);
  }
  return path;
}

/**
 * Hook for detecting drag-and-drop of .torrent files.
 *
 * When files are dropped into the terminal, they appear as rapidly pasted text.
 * This hook collects that text, detects .torrent file patterns, and triggers
 * the appropriate callback.
 *
 * @example
 * ```tsx
 * usePaste({
 *   onTorrentFiles: (files) => {
 *     // Handle dropped .torrent files
 *     console.log('Dropped files:', files);
 *     openBatchAddModal(files);
 *   },
 *   onRegularPaste: (content) => {
 *     // Handle regular paste (magnet link, etc)
 *     setInputValue(content);
 *   },
 *   enabled: isModalVisible,
 * });
 * ```
 */
export function usePaste({
  onTorrentFiles,
  onRegularPaste,
  enabled = true,
  debounceMs = 50,
}: UsePasteOptions): void {
  const bufferRef = useRef<string>('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processBuffer = useCallback(() => {
    const content = bufferRef.current;
    bufferRef.current = '';

    if (!content) return;

    // Parse paths from pasted content
    const paths = parsePastedPaths(content);
    const expandedPaths = paths.map(expandPath);
    const torrentFiles = filterTorrentFiles(expandedPaths);

    if (torrentFiles.length > 0) {
      // We found .torrent files - this was a file drop
      onTorrentFiles(torrentFiles);
    } else if (onRegularPaste) {
      // Regular paste (magnet link, URL, etc)
      onRegularPaste(content);
    }
  }, [onTorrentFiles, onRegularPaste]);

  useInput(
    (input, key) => {
      // Ignore control keys
      if (
        key.ctrl ||
        key.meta ||
        key.escape ||
        key.return ||
        key.upArrow ||
        key.downArrow ||
        key.leftArrow ||
        key.rightArrow ||
        key.backspace ||
        key.delete ||
        key.tab
      ) {
        return;
      }

      // Accumulate input characters
      if (input) {
        bufferRef.current += input;

        // Clear existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Set new timeout to process buffer
        timeoutRef.current = setTimeout(processBuffer, debounceMs);
      }
    },
    { isActive: enabled }
  );
}

export default usePaste;
