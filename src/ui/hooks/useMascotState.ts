import { useState, useEffect, useRef, useCallback } from 'react';
import { useInput } from 'ink';
import type { MascotExpression } from '../components/Mascot.js';
import type { Torrent, TorrentState } from '../../engine/types.js';

export interface MascotState {
  /** Current expression to display */
  expression: MascotExpression;
  /** Whether mascot is in sleep mode */
  isSleeping: boolean;
  /** Number of Z's to show (0-3) */
  sleepZCount: number;
}

export interface UseMascotStateOptions {
  /** Array of current torrents for tracking state changes */
  torrents: Torrent[];
  /** Whether the daemon is connected */
  isConnected: boolean;
  /** Whether connection is being established */
  isConnecting: boolean;
  /** Idle timeout in ms before sleeping (default: 30000) */
  idleTimeout?: number;
}

interface TorrentSnapshot {
  infoHash: string;
  state: TorrentState;
  progress: number;
  addedAt?: number; // Timestamp when torrent started seeding
}

/**
 * Hook to manage mascot expression state based on app activity
 *
 * Tracks:
 * - Idle time for sleep animation
 * - Connection status for dead face
 * - Download completions for celebration face
 * - Early deletions for drool face
 */
export function useMascotState({
  torrents,
  isConnected,
  isConnecting,
  idleTimeout = 30000,
}: UseMascotStateOptions): MascotState {
  // Expression state
  const [expression, setExpression] = useState<MascotExpression>('default');
  const [isSleeping, setIsSleeping] = useState(false);
  const [sleepZCount, setSleepZCount] = useState(0);

  // Track last activity time
  const lastActivityRef = useRef<number>(Date.now());

  // Track previous torrent states for detecting changes
  const prevTorrentsRef = useRef<Map<string, TorrentSnapshot>>(new Map());

  // Track when torrents started seeding (for early deletion detection)
  const seedingStartTimeRef = useRef<Map<string, number>>(new Map());

  // Timer refs
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sleepZTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Record activity - resets idle timer and wakes up mascot
   */
  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();

    // Wake up if sleeping
    if (isSleeping) {
      setIsSleeping(false);
      setSleepZCount(0);
      if (sleepZTimerRef.current) {
        clearInterval(sleepZTimerRef.current);
        sleepZTimerRef.current = null;
      }
    }

    // Reset idle timer
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      startSleeping();
    }, idleTimeout);
  }, [isSleeping, idleTimeout]);

  /**
   * Start the sleeping animation
   */
  const startSleeping = useCallback(() => {
    setIsSleeping(true);
    setSleepZCount(0);
    setExpression('sleep');

    // Clear any previous Z timer
    if (sleepZTimerRef.current) {
      clearInterval(sleepZTimerRef.current);
    }

    // Animate Z's appearing one by one
    let zCount = 0;
    sleepZTimerRef.current = setInterval(() => {
      zCount++;
      if (zCount <= 3) {
        setSleepZCount(zCount);
      }
      // After all Z's appear, cycle them
      if (zCount >= 6) {
        zCount = 0;
        setSleepZCount(0);
      }
    }, 1000);
  }, []);

  /**
   * Show temporary expression then return to default
   */
  const showTemporaryExpression = useCallback(
    (expr: MascotExpression, durationMs: number = 2000) => {
      // Clear any pending expression reset
      if (expressionTimerRef.current) {
        clearTimeout(expressionTimerRef.current);
      }

      setExpression(expr);
      recordActivity();

      expressionTimerRef.current = setTimeout(() => {
        setExpression('default');
      }, durationMs);
    },
    [recordActivity]
  );

  // Track keyboard/input activity
  useInput(() => {
    recordActivity();
  });

  // Initialize idle timer on mount
  useEffect(() => {
    idleTimerRef.current = setTimeout(() => {
      startSleeping();
    }, idleTimeout);

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (sleepZTimerRef.current) clearInterval(sleepZTimerRef.current);
      if (expressionTimerRef.current) clearTimeout(expressionTimerRef.current);
    };
  }, [idleTimeout, startSleeping]);

  // Track connection status
  useEffect(() => {
    if (!isConnected && !isConnecting) {
      setExpression('dead');
      setIsSleeping(false);
      if (sleepZTimerRef.current) {
        clearInterval(sleepZTimerRef.current);
        sleepZTimerRef.current = null;
      }
    } else if (expression === 'dead' && isConnected) {
      setExpression('default');
    }
  }, [isConnected, isConnecting, expression]);

  // Track torrent state changes
  useEffect(() => {
    const prevTorrents = prevTorrentsRef.current;
    const currentHashes = new Set(torrents.map((t) => t.infoHash));

    // Check for state changes
    for (const torrent of torrents) {
      const prev = prevTorrents.get(torrent.infoHash);

      // Track when torrents start seeding
      if (torrent.state === 'seeding' && prev?.state !== 'seeding') {
        seedingStartTimeRef.current.set(torrent.infoHash, Date.now());
      }

      // Detect download completion (progress goes to 100%)
      if (
        torrent.progress >= 1 &&
        prev &&
        prev.progress < 1 &&
        torrent.state === 'seeding'
      ) {
        showTemporaryExpression('celebrate', 3000);
      }

      // Check for dead torrents (error state)
      if (torrent.state === 'error' && prev?.state !== 'error') {
        showTemporaryExpression('dead', 3000);
      }
    }

    // Check for deleted torrents (existed before, gone now)
    for (const [hash, prev] of prevTorrents) {
      if (!currentHashes.has(hash)) {
        // Torrent was deleted
        const seedingStartTime = seedingStartTimeRef.current.get(hash);
        if (
          prev.state === 'seeding' &&
          seedingStartTime &&
          Date.now() - seedingStartTime < 60000
        ) {
          // Deleted within 1 minute of starting to seed
          showTemporaryExpression('drool', 3000);
        }
        // Clean up tracking
        seedingStartTimeRef.current.delete(hash);
      }
    }

    // Update snapshot
    const newSnapshot = new Map<string, TorrentSnapshot>();
    for (const torrent of torrents) {
      newSnapshot.set(torrent.infoHash, {
        infoHash: torrent.infoHash,
        state: torrent.state as TorrentState,
        progress: torrent.progress,
      });
    }
    prevTorrentsRef.current = newSnapshot;

    // Record activity if torrent states changed (downloads happening)
    const hasActivity = torrents.some(
      (t) => t.downloadSpeed > 0 || t.uploadSpeed > 0
    );
    if (hasActivity) {
      recordActivity();
    }
  }, [torrents, showTemporaryExpression, recordActivity]);

  return {
    expression: isSleeping ? 'sleep' : expression,
    isSleeping,
    sleepZCount,
  };
}

export default useMascotState;
