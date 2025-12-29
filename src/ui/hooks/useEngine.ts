/**
 * useEngine Hook - Connects the Ink TUI to the Torm engine.
 *
 * This hook provides React components with access to the torrent engine,
 * maintaining state synchronization through event subscriptions and
 * managing the engine lifecycle.
 *
 * @module ui/hooks/useEngine
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { TormEngine } from '../../engine/TormEngine.js';
import type { Torrent, Peer } from '../../engine/types.js';

// =============================================================================
// Singleton Engine Instance
// =============================================================================

/**
 * Singleton TormEngine instance shared across all hook consumers.
 * This ensures a single engine manages all torrent operations.
 */
let engineInstance: TormEngine | null = null;

/**
 * Gets or creates the singleton TormEngine instance.
 *
 * @returns The shared TormEngine instance
 */
function getEngineInstance(): TormEngine {
  if (!engineInstance) {
    engineInstance = new TormEngine();
  }
  return engineInstance;
}

// =============================================================================
// Hook Return Type
// =============================================================================

/**
 * Return type for the useEngine hook.
 */
export interface UseEngineResult {
  /** The TormEngine instance for direct API access */
  engine: TormEngine;

  /** Array of all torrents currently managed by the engine */
  torrents: Torrent[];

  /** Whether the engine has started and is ready for operations */
  isReady: boolean;

  /** Gets the list of peers for a given torrent by info hash */
  getPeers: (infoHash: string) => Peer[];
}

// =============================================================================
// useEngine Hook
// =============================================================================

/**
 * React hook that connects UI components to the Torm engine.
 *
 * This hook:
 * - Provides access to a singleton TormEngine instance
 * - Subscribes to engine events and updates React state accordingly
 * - Automatically cleans up subscriptions on unmount
 * - Tracks engine readiness and torrent list state
 *
 * @returns Object containing engine instance, torrents array, and ready state
 *
 * @example
 * ```tsx
 * import { useEngine } from '../hooks/useEngine.js';
 *
 * function TorrentList() {
 *   const { engine, torrents, isReady } = useEngine();
 *
 *   if (!isReady) {
 *     return <Text>Starting engine...</Text>;
 *   }
 *
 *   return (
 *     <Box flexDirection="column">
 *       {torrents.map(t => (
 *         <Text key={t.infoHash}>{t.name}: {t.progress * 100}%</Text>
 *       ))}
 *     </Box>
 *   );
 * }
 * ```
 */
export function useEngine(): UseEngineResult {
  // Get the singleton engine instance
  const engineRef = useRef<TormEngine>(getEngineInstance());
  const engine = engineRef.current;

  // React state for torrents and readiness
  const [torrents, setTorrents] = useState<Torrent[]>(() => engine.getAllTorrents());
  const [isReady, setIsReady] = useState<boolean>(() => engine.isRunning());

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Gets the list of peers for a given torrent.
   *
   * @param infoHash - The info hash of the torrent
   * @returns Array of peers connected to the torrent, or empty array if not found
   */
  const getPeers = useCallback(
    (infoHash: string): Peer[] => {
      return engine.getPeers(infoHash);
    },
    [engine]
  );

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Handle engine:ready event - marks the engine as ready for operations.
   */
  const handleEngineReady = useCallback(() => {
    setIsReady(true);
  }, []);

  /**
   * Handle engine:started event - marks the engine as ready.
   */
  const handleEngineStarted = useCallback(() => {
    setIsReady(true);
  }, []);

  /**
   * Handle engine:stopped event - marks the engine as not ready.
   */
  const handleEngineStopped = useCallback(() => {
    setIsReady(false);
  }, []);

  /**
   * Handle torrent:added event - adds new torrent to state.
   * Re-fetches the torrent from the engine to ensure we have the canonical type.
   */
  const handleTorrentAdded = useCallback(
    (payload: { torrent: { infoHash: string } }) => {
      const torrent = engine.getTorrent(payload.torrent.infoHash);
      if (!torrent) {
        return;
      }
      setTorrents((prev) => {
        // Avoid duplicates by checking info hash
        const exists = prev.some((t) => t.infoHash === torrent.infoHash);
        if (exists) {
          return prev;
        }
        return [...prev, torrent];
      });
    },
    [engine]
  );

  /**
   * Handle torrent:removed event - removes torrent from state.
   */
  const handleTorrentRemoved = useCallback((payload: { infoHash: string }) => {
    setTorrents((prev) => prev.filter((t) => t.infoHash !== payload.infoHash));
  }, []);

  /**
   * Handle torrent:progress event - updates torrent progress in state.
   */
  const handleTorrentProgress = useCallback(
    (payload: {
      infoHash: string;
      progress: number;
      downloadSpeed: number;
      uploadSpeed: number;
      peers: number;
    }) => {
      setTorrents((prev) =>
        prev.map((t): Torrent => {
          if (t.infoHash !== payload.infoHash) {
            return t;
          }
          // Update the torrent with new progress data
          return {
            ...t,
            progress: payload.progress,
            downloadSpeed: payload.downloadSpeed,
            uploadSpeed: payload.uploadSpeed,
            peers: payload.peers,
          };
        })
      );
    },
    []
  );

  // ==========================================================================
  // Event Subscription Effect
  // ==========================================================================

  // Start the engine on mount if not already running
  useEffect(() => {
    if (!engine.isRunning()) {
      engine.start().catch((err) => {
        console.error('[useEngine] Failed to start engine:', err);
      });
    }
  }, [engine]);

  useEffect(() => {
    // Subscribe to engine events
    engine.on('engine:ready', handleEngineReady);
    engine.on('engine:started', handleEngineStarted);
    engine.on('engine:stopped', handleEngineStopped);
    engine.on('torrent:added', handleTorrentAdded);
    engine.on('torrent:removed', handleTorrentRemoved);
    engine.on('torrent:progress', handleTorrentProgress);

    // Sync initial state in case engine was already running
    if (engine.isRunning() && !isReady) {
      setIsReady(true);
    }

    // Sync torrents in case some were already added
    const currentTorrents = engine.getAllTorrents();
    if (currentTorrents.length > 0 && torrents.length === 0) {
      setTorrents(currentTorrents);
    }

    // Cleanup: unsubscribe from all events on unmount
    return () => {
      engine.off('engine:ready', handleEngineReady);
      engine.off('engine:started', handleEngineStarted);
      engine.off('engine:stopped', handleEngineStopped);
      engine.off('torrent:added', handleTorrentAdded);
      engine.off('torrent:removed', handleTorrentRemoved);
      engine.off('torrent:progress', handleTorrentProgress);
    };
  }, [
    engine,
    isReady,
    torrents.length,
    handleEngineReady,
    handleEngineStarted,
    handleEngineStopped,
    handleTorrentAdded,
    handleTorrentRemoved,
    handleTorrentProgress,
  ]);

  return {
    engine,
    torrents,
    isReady,
    getPeers,
  };
}

// =============================================================================
// Exports
// =============================================================================

export default useEngine;
