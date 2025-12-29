/**
 * useTorrentLogs Hook - Captures and manages per-torrent activity logs.
 *
 * This hook subscribes to engine events and maintains a log of activities
 * for each torrent, providing a way to track what's happening with downloads.
 *
 * @module ui/hooks/useTorrentLogs
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { TormEngine } from '../../engine/TormEngine.js';
// Types from engine/events.ts match what the engine actually emits

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of log entries to keep per torrent */
const MAX_LOGS_PER_TORRENT = 100;

// =============================================================================
// Types
// =============================================================================

/**
 * Log level indicating the severity/type of a log entry.
 */
export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Represents a single log entry for a torrent.
 */
export interface LogEntry {
  /** Timestamp when the log entry was created */
  timestamp: Date;

  /** Severity level of the log entry */
  level: LogLevel;

  /** Human-readable log message */
  message: string;
}

/**
 * Return type for the useTorrentLogs hook.
 */
export interface UseTorrentLogsResult {
  /** Map of info hash to array of log entries */
  logs: Map<string, LogEntry[]>;

  /** Adds a log entry for a specific torrent */
  addLog: (infoHash: string, level: LogLevel, message: string) => void;

  /** Clears all logs for a specific torrent */
  clearLogs: (infoHash: string) => void;

  /** Gets log entries for a specific torrent */
  getLogsForTorrent: (infoHash: string) => LogEntry[];
}

// =============================================================================
// useTorrentLogs Hook
// =============================================================================

/**
 * React hook that captures and manages per-torrent activity logs.
 *
 * This hook:
 * - Subscribes to engine events and logs relevant activities
 * - Maintains a capped list of logs per torrent (max 100 entries)
 * - Provides methods to add custom logs, clear logs, and retrieve logs
 * - Automatically cleans up subscriptions on unmount
 *
 * @param engine - The TormEngine instance to subscribe to
 * @returns Object containing logs map and utility functions
 *
 * @example
 * ```tsx
 * import { useTorrentLogs } from '../hooks/useTorrentLogs.js';
 *
 * function TorrentDetails({ engine, infoHash }) {
 *   const { getLogsForTorrent, addLog } = useTorrentLogs(engine);
 *   const logs = getLogsForTorrent(infoHash);
 *
 *   return (
 *     <Box flexDirection="column">
 *       {logs.map((log, i) => (
 *         <Text key={i} color={log.level === 'error' ? 'red' : undefined}>
 *           [{log.timestamp.toLocaleTimeString()}] {log.message}
 *         </Text>
 *       ))}
 *     </Box>
 *   );
 * }
 * ```
 */
export function useTorrentLogs(engine: TormEngine): UseTorrentLogsResult {
  // Use ref to store logs to avoid re-renders on every log addition
  const logsRef = useRef<Map<string, LogEntry[]>>(new Map());

  // State to trigger re-renders when logs change
  const [, setUpdateTrigger] = useState(0);

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Triggers a re-render to reflect log changes in consuming components.
   */
  const triggerUpdate = useCallback(() => {
    setUpdateTrigger((prev) => prev + 1);
  }, []);

  /**
   * Adds a log entry for a specific torrent.
   *
   * @param infoHash - The info hash of the torrent
   * @param level - The log level
   * @param message - The log message
   */
  const addLog = useCallback(
    (infoHash: string, level: LogLevel, message: string) => {
      const entry: LogEntry = {
        timestamp: new Date(),
        level,
        message,
      };

      const currentLogs = logsRef.current.get(infoHash) || [];
      const updatedLogs = [...currentLogs, entry];

      // Limit to MAX_LOGS_PER_TORRENT entries
      if (updatedLogs.length > MAX_LOGS_PER_TORRENT) {
        updatedLogs.splice(0, updatedLogs.length - MAX_LOGS_PER_TORRENT);
      }

      logsRef.current.set(infoHash, updatedLogs);
      triggerUpdate();
    },
    [triggerUpdate]
  );

  /**
   * Clears all logs for a specific torrent.
   *
   * @param infoHash - The info hash of the torrent
   */
  const clearLogs = useCallback(
    (infoHash: string) => {
      logsRef.current.delete(infoHash);
      triggerUpdate();
    },
    [triggerUpdate]
  );

  /**
   * Gets all log entries for a specific torrent.
   *
   * @param infoHash - The info hash of the torrent
   * @returns Array of log entries, or empty array if none exist
   */
  const getLogsForTorrent = useCallback((infoHash: string): LogEntry[] => {
    return logsRef.current.get(infoHash) || [];
  }, []);

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Handle torrent:added event - logs when a torrent is added.
   */
  const handleTorrentAdded = useCallback(
    (payload: { torrent: { infoHash: string } }) => {
      addLog(payload.torrent.infoHash, 'info', 'Torrent added');
    },
    [addLog]
  );

  /**
   * Handle torrent:started event - logs when a torrent starts downloading.
   */
  const handleTorrentStarted = useCallback(
    (payload: { infoHash: string }) => {
      addLog(payload.infoHash, 'info', 'Started downloading');
    },
    [addLog]
  );

  /**
   * Handle torrent:paused event - logs when a torrent is paused.
   */
  const handleTorrentPaused = useCallback(
    (payload: { infoHash: string }) => {
      addLog(payload.infoHash, 'info', 'Paused');
    },
    [addLog]
  );

  /**
   * Handle torrent:completed event - logs when a torrent completes.
   */
  const handleTorrentCompleted = useCallback(
    (payload: { torrent: { infoHash: string } }) => {
      addLog(payload.torrent.infoHash, 'info', 'Download completed');
    },
    [addLog]
  );

  /**
   * Handle torrent:error event - logs torrent errors.
   */
  const handleTorrentError = useCallback(
    (payload: { infoHash: string; error: Error }) => {
      addLog(
        payload.infoHash,
        'error',
        `Error: ${payload.error.message}`
      );
    },
    [addLog]
  );

  /**
   * Handle peer:connected event - logs when a peer connects.
   */
  const handlePeerConnected = useCallback(
    (payload: { infoHash: string; peer: { ip: string } }) => {
      addLog(payload.infoHash, 'info', `Peer connected: ${payload.peer.ip}`);
    },
    [addLog]
  );

  /**
   * Handle peer:disconnected event - logs when a peer disconnects.
   */
  const handlePeerDisconnected = useCallback(
    (payload: { infoHash: string; peerId: string }) => {
      addLog(
        payload.infoHash,
        'info',
        `Peer disconnected: ${payload.peerId.slice(0, 8)}...`
      );
    },
    [addLog]
  );

  /**
   * Handle tracker:announce event - logs tracker announcements.
   */
  const handleTrackerAnnounce = useCallback(
    (payload: { infoHash: string; tracker: { peers: number } }) => {
      addLog(
        payload.infoHash,
        'info',
        `Tracker announced: ${payload.tracker.peers} peers`
      );
    },
    [addLog]
  );

  /**
   * Handle tracker:error event - logs tracker errors.
   */
  const handleTrackerError = useCallback(
    (payload: { infoHash: string; url: string; error: Error }) => {
      addLog(
        payload.infoHash,
        'warn',
        `Tracker error (${payload.url}): ${payload.error.message}`
      );
    },
    [addLog]
  );

  // ==========================================================================
  // Event Subscription Effect
  // ==========================================================================

  useEffect(() => {
    // Subscribe to torrent lifecycle events
    engine.on('torrent:added', handleTorrentAdded);
    engine.on('torrent:started', handleTorrentStarted);
    engine.on('torrent:paused', handleTorrentPaused);
    engine.on('torrent:completed', handleTorrentCompleted);
    engine.on('torrent:error', handleTorrentError);

    // Subscribe to peer events
    engine.on('peer:connected', handlePeerConnected);
    engine.on('peer:disconnected', handlePeerDisconnected);

    // Subscribe to tracker events
    engine.on('tracker:announce', handleTrackerAnnounce);
    engine.on('tracker:error', handleTrackerError);

    // Cleanup: unsubscribe from all events on unmount
    return () => {
      engine.off('torrent:added', handleTorrentAdded);
      engine.off('torrent:started', handleTorrentStarted);
      engine.off('torrent:paused', handleTorrentPaused);
      engine.off('torrent:completed', handleTorrentCompleted);
      engine.off('torrent:error', handleTorrentError);
      engine.off('peer:connected', handlePeerConnected);
      engine.off('peer:disconnected', handlePeerDisconnected);
      engine.off('tracker:announce', handleTrackerAnnounce);
      engine.off('tracker:error', handleTrackerError);
    };
  }, [
    engine,
    handleTorrentAdded,
    handleTorrentStarted,
    handleTorrentPaused,
    handleTorrentCompleted,
    handleTorrentError,
    handlePeerConnected,
    handlePeerDisconnected,
    handleTrackerAnnounce,
    handleTrackerError,
  ]);

  // Return a new Map instance to ensure React detects changes
  return {
    logs: new Map(logsRef.current),
    addLog,
    clearLogs,
    getLogsForTorrent,
  };
}

// =============================================================================
// Exports
// =============================================================================

export default useTorrentLogs;
