import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Torrent } from '../../engine/types.js';

/**
 * Return type for the useTorrents hook.
 */
export interface UseTorrentsResult {
  /** The torrent list (pass-through from input) */
  torrents: Torrent[];
  /** Currently selected torrent, or null if no selection */
  selectedTorrent: Torrent | null;
  /** Index of the selected torrent (-1 if list is empty) */
  selectedIndex: number;
  /** Select the next torrent (wraps to start at end) */
  selectNext: () => void;
  /** Select the previous torrent (wraps to end at start) */
  selectPrev: () => void;
  /** Select a torrent by index (clamped to valid range) */
  selectByIndex: (index: number) => void;
}

/**
 * Hook for managing torrent list selection state.
 *
 * Provides navigation through a list of torrents with wrapping behavior
 * and automatic adjustment when the torrent list changes.
 *
 * @param torrents - Array of torrents to manage selection for
 * @returns Selection state and navigation functions
 *
 * @example
 * ```tsx
 * const { selectedTorrent, selectNext, selectPrev } = useTorrents(torrents);
 *
 * useInput((input, key) => {
 *   if (key.downArrow) selectNext();
 *   if (key.upArrow) selectPrev();
 * });
 * ```
 */
export function useTorrents(torrents: Torrent[]): UseTorrentsResult {
  const [selectedIndex, setSelectedIndex] = useState<number>(() =>
    torrents.length > 0 ? 0 : -1
  );

  // Adjust selection when torrents array changes
  useEffect(() => {
    if (torrents.length === 0) {
      // Empty list: no selection
      setSelectedIndex(-1);
    } else if (selectedIndex === -1) {
      // Had no selection but now have items: select first
      setSelectedIndex(0);
    } else if (selectedIndex >= torrents.length) {
      // Selection is now out of bounds: clamp to last item
      setSelectedIndex(torrents.length - 1);
    }
    // If selection is still valid, keep it as-is
  }, [torrents.length, selectedIndex]);

  const selectNext = useCallback(() => {
    if (torrents.length === 0) return;

    setSelectedIndex((current) => {
      if (current === -1) return 0;
      // Wrap to start when at end
      return current >= torrents.length - 1 ? 0 : current + 1;
    });
  }, [torrents.length]);

  const selectPrev = useCallback(() => {
    if (torrents.length === 0) return;

    setSelectedIndex((current) => {
      if (current === -1) return torrents.length - 1;
      // Wrap to end when at start
      return current <= 0 ? torrents.length - 1 : current - 1;
    });
  }, [torrents.length]);

  const selectByIndex = useCallback(
    (index: number) => {
      if (torrents.length === 0) {
        setSelectedIndex(-1);
        return;
      }

      // Clamp index to valid range
      const clampedIndex = Math.max(0, Math.min(index, torrents.length - 1));
      setSelectedIndex(clampedIndex);
    },
    [torrents.length]
  );

  const selectedTorrent = useMemo(() => {
    if (selectedIndex === -1 || selectedIndex >= torrents.length) {
      return null;
    }
    return torrents[selectedIndex];
  }, [torrents, selectedIndex]);

  return {
    torrents,
    selectedTorrent,
    selectedIndex,
    selectNext,
    selectPrev,
    selectByIndex,
  };
}
