/**
 * useDaemonClient Hook - Connects the Ink TUI to the daemon.
 *
 * This hook provides React components with access to the torrent daemon,
 * maintaining state synchronization through daemon events.
 *
 * @module ui/hooks/useDaemonClient
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { DaemonClient, ensureDaemonRunning } from '../../daemon/index.js';
import { TorrentState, type Torrent, type Peer, type EngineConfig } from '../../engine/types.js';
import type { DaemonEvent } from '../../daemon/protocol.js';

// =============================================================================
// Hook Return Type
// =============================================================================

/**
 * Return type for the useDaemonClient hook.
 */
export interface UseDaemonClientResult {
  /** Array of all torrents currently managed by the daemon */
  torrents: Torrent[];

  /** Whether the daemon is connected and ready */
  isReady: boolean;

  /** Whether we're currently connecting to the daemon */
  isConnecting: boolean;

  /** Connection error if any */
  error: string | null;

  /** Daemon uptime in seconds */
  daemonUptime: number | undefined;

  /** Gets the list of peers for a given torrent by info hash */
  getPeers: (infoHash: string) => Promise<Peer[]>;

  /** Add a torrent */
  addTorrent: (source: string, options?: { downloadPath?: string; startImmediately?: boolean }) => Promise<Torrent>;

  /** Remove a torrent */
  removeTorrent: (infoHash: string, deleteFiles?: boolean) => Promise<void>;

  /** Pause a torrent */
  pauseTorrent: (infoHash: string) => Promise<void>;

  /** Resume a torrent */
  resumeTorrent: (infoHash: string) => Promise<void>;

  /** Get a specific torrent */
  getTorrent: (infoHash: string) => Promise<Torrent | undefined>;

  /** Get engine configuration */
  getConfig: () => Promise<EngineConfig>;

  /** Update engine configuration */
  updateConfig: (config: Partial<EngineConfig>) => Promise<void>;

  /** Refresh torrents from daemon */
  refresh: () => Promise<void>;

  /** Shutdown the daemon */
  shutdownDaemon: () => Promise<void>;
}

// =============================================================================
// useDaemonClient Hook
// =============================================================================

/**
 * React hook that connects UI components to the Torm daemon.
 *
 * This hook:
 * - Connects to the daemon (starting it if needed)
 * - Subscribes to daemon events and updates React state accordingly
 * - Provides async methods for torrent operations
 * - Automatically cleans up on unmount
 *
 * @returns Object containing daemon operations and state
 */
export function useDaemonClient(): UseDaemonClientResult {
  // State
  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [daemonUptime, setDaemonUptime] = useState<number | undefined>(undefined);

  // Ref for the client
  const clientRef = useRef<DaemonClient | null>(null);
  const refreshIntervalRef = useRef<Timer | null>(null);

  // Track pending deletes to prevent race conditions with polling refresh
  const pendingDeletesRef = useRef<Set<string>>(new Set());

  // ==========================================================================
  // Connection Effect
  // ==========================================================================

  useEffect(() => {
    let mounted = true;
    let retryTimeout: Timer | null = null;
    let retryCount = 0;
    const maxRetries = 60; // Keep trying for ~60 seconds

    const setupClient = (client: DaemonClient) => {
      clientRef.current = client;

      // Subscribe to daemon events
      client.on('event', (event: DaemonEvent) => {
        if (!mounted) return;

        switch (event.type) {
          case 'torrent:added':
            setTorrents(prev => {
              if (prev.some(t => t.infoHash === event.torrent.infoHash)) {
                return prev;
              }
              return [...prev, event.torrent];
            });
            break;

          case 'torrent:removed':
            setTorrents(prev => prev.filter(t => t.infoHash !== event.infoHash));
            break;

          case 'torrent:progress':
            setTorrents(prev => prev.map(t => {
              if (t.infoHash !== event.infoHash) return t;

              // Prevent progress from going backwards (should never happen normally)
              // and prevent speeds from flashing to 0 if we had non-zero values
              const progress = event.progress >= t.progress ? event.progress : t.progress;
              const downloadSpeed = event.downloadSpeed > 0 ? event.downloadSpeed : t.downloadSpeed;
              const uploadSpeed = event.uploadSpeed > 0 ? event.uploadSpeed : t.uploadSpeed;
              const peers = event.peers > 0 ? event.peers : t.peers;

              return {
                ...t,
                progress,
                downloadSpeed,
                uploadSpeed,
                peers,
              };
            }));
            break;

          case 'torrent:completed':
            fetchTorrents(client);
            break;

          case 'engine:stopped':
            setIsReady(false);
            setError('Daemon stopped');
            break;
        }
      });

      client.on('disconnected', () => {
        if (!mounted) return;
        setIsReady(false);
        setDaemonUptime(undefined);
        // Try to reconnect
        scheduleRetry();
      });

      client.on('reconnected', () => {
        if (!mounted) return;
        setIsReady(true);
        setError(null);
        fetchTorrents(client);
      });
    };

    const connect = async () => {
      if (!mounted) return;

      try {
        setIsConnecting(true);

        // Try to connect to existing daemon first (don't auto-start)
        const client = new DaemonClient({ connectTimeout: 3000 });

        try {
          await client.connect();

          if (!mounted) {
            client.disconnect();
            return;
          }

          setupClient(client);

          // Fetch initial data
          await fetchTorrents(client);
          await fetchDaemonStatus(client);

          setIsReady(true);
          setIsConnecting(false);
          setError(null);
          retryCount = 0;

          // Set up periodic refresh
          refreshIntervalRef.current = setInterval(() => {
            if (client.isConnected()) {
              fetchTorrents(client);
              fetchDaemonStatus(client);
            }
          }, 1000);

        } catch {
          client.disconnect();

          // Daemon not running - try to start it (only on first attempt)
          if (retryCount === 0) {
            setError('Starting daemon...');
            try {
              await ensureDaemonRunning();
            } catch {
              // Ignore start errors, we'll keep retrying connection
            }
          }

          // Schedule retry
          scheduleRetry();
        }
      } catch {
        if (!mounted) return;
        scheduleRetry();
      }
    };

    const scheduleRetry = () => {
      if (!mounted) return;

      retryCount++;

      if (retryCount > maxRetries) {
        setIsConnecting(false);
        setError('Could not connect to daemon. Run: torm daemon start');
        return;
      }

      setError(retryCount <= 3 ? 'Starting daemon...' : `Connecting to daemon... (${retryCount})`);

      retryTimeout = setTimeout(() => {
        connect();
      }, 1000);
    };

    const fetchTorrents = async (client: DaemonClient) => {
      try {
        const list = await client.getTorrents();
        // Filter out any torrents that are pending delete to prevent race condition
        const filteredList = list.filter(t => !pendingDeletesRef.current.has(t.infoHash));

        // Merge with existing state to avoid overwriting fresher event data
        // Events provide real-time progress updates; polling may have stale data
        setTorrents(prev => {
          const prevMap = new Map(prev.map(t => [t.infoHash, t]));

          return filteredList.map(newTorrent => {
            const existing = prevMap.get(newTorrent.infoHash);
            if (!existing) return newTorrent;

            // Keep the higher progress (progress only goes up)
            // This prevents stale poll data from overwriting fresh event data
            if (existing.progress > newTorrent.progress) {
              return {
                ...newTorrent,
                progress: existing.progress,
                downloadSpeed: existing.downloadSpeed,
                uploadSpeed: existing.uploadSpeed,
                peers: existing.peers,
              };
            }

            // When progress is equal or polled is higher, prefer non-zero speed values
            // This prevents flashing when polled data has stale (0) speeds
            // but event data has fresh non-zero values
            const downloadSpeed = newTorrent.downloadSpeed > 0
              ? newTorrent.downloadSpeed
              : existing.downloadSpeed;
            const uploadSpeed = newTorrent.uploadSpeed > 0
              ? newTorrent.uploadSpeed
              : existing.uploadSpeed;
            const peers = newTorrent.peers > 0
              ? newTorrent.peers
              : existing.peers;

            return {
              ...newTorrent,
              downloadSpeed,
              uploadSpeed,
              peers,
            };
          });
        });
      } catch {
        // Ignore fetch errors
      }
    };

    const fetchDaemonStatus = async (client: DaemonClient) => {
      try {
        const status = await client.getStatus();
        setDaemonUptime(status.uptime);
      } catch {
        // Ignore status fetch errors
      }
    };

    // Start connection attempt
    connect();

    return () => {
      mounted = false;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  // ==========================================================================
  // Operations
  // ==========================================================================

  const getPeers = useCallback(async (infoHash: string): Promise<Peer[]> => {
    if (!clientRef.current?.isConnected()) {
      return [];
    }
    return clientRef.current.getPeers(infoHash);
  }, []);

  const addTorrent = useCallback(async (
    source: string,
    options?: { downloadPath?: string; startImmediately?: boolean }
  ): Promise<Torrent> => {
    if (!clientRef.current?.isConnected()) {
      throw new Error('Not connected to daemon');
    }
    return clientRef.current.addTorrent(source, options);
  }, []);

  const removeTorrent = useCallback(async (infoHash: string, deleteFiles = false): Promise<void> => {
    if (!clientRef.current?.isConnected()) {
      throw new Error('Not connected to daemon');
    }
    // Track this delete to prevent polling from re-adding the torrent
    pendingDeletesRef.current.add(infoHash);

    // Optimistic update: immediately remove from UI for responsiveness
    setTorrents(prev => prev.filter(t => t.infoHash !== infoHash));

    try {
      await clientRef.current.removeTorrent(infoHash, deleteFiles);
    } catch (err) {
      // On error, refresh to restore actual state
      pendingDeletesRef.current.delete(infoHash);
      const list = await clientRef.current?.getTorrents();
      if (list) setTorrents(list);
      throw err;
    } finally {
      // Clean up pending delete after operation completes
      pendingDeletesRef.current.delete(infoHash);
    }
  }, []);

  const pauseTorrent = useCallback(async (infoHash: string): Promise<void> => {
    if (!clientRef.current?.isConnected()) {
      throw new Error('Not connected to daemon');
    }
    // Optimistic update: immediately show as paused for responsiveness
    let previousState: TorrentState | undefined;
    setTorrents(prev => prev.map(t => {
      if (t.infoHash !== infoHash) return t;
      previousState = t.state;
      return { ...t, state: TorrentState.PAUSED, downloadSpeed: 0, uploadSpeed: 0 };
    }));

    try {
      await clientRef.current.pauseTorrent(infoHash);
    } catch (err) {
      // On error, restore previous state
      if (previousState !== undefined) {
        setTorrents(prev => prev.map(t => {
          if (t.infoHash !== infoHash) return t;
          return { ...t, state: previousState! };
        }));
      }
      throw err;
    }
  }, []);

  const resumeTorrent = useCallback(async (infoHash: string): Promise<void> => {
    if (!clientRef.current?.isConnected()) {
      throw new Error('Not connected to daemon');
    }
    // Optimistic update: immediately show as downloading for responsiveness
    let previousState: TorrentState | undefined;
    setTorrents(prev => prev.map(t => {
      if (t.infoHash !== infoHash) return t;
      previousState = t.state;
      // Show as downloading if incomplete, seeding if complete
      const newState = t.progress >= 1 ? TorrentState.SEEDING : TorrentState.DOWNLOADING;
      return { ...t, state: newState };
    }));

    try {
      await clientRef.current.resumeTorrent(infoHash);
    } catch (err) {
      // On error, restore previous state
      if (previousState !== undefined) {
        setTorrents(prev => prev.map(t => {
          if (t.infoHash !== infoHash) return t;
          return { ...t, state: previousState! };
        }));
      }
      throw err;
    }
  }, []);

  const getTorrent = useCallback(async (infoHash: string): Promise<Torrent | undefined> => {
    if (!clientRef.current?.isConnected()) {
      return undefined;
    }
    return clientRef.current.getTorrent(infoHash);
  }, []);

  const getConfig = useCallback(async (): Promise<EngineConfig> => {
    if (!clientRef.current?.isConnected()) {
      throw new Error('Not connected to daemon');
    }
    return clientRef.current.getConfig();
  }, []);

  const updateConfig = useCallback(async (config: Partial<EngineConfig>): Promise<void> => {
    if (!clientRef.current?.isConnected()) {
      throw new Error('Not connected to daemon');
    }
    await clientRef.current.updateConfig(config);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!clientRef.current?.isConnected()) {
      return;
    }
    const list = await clientRef.current.getTorrents();
    // Use same merge logic as fetchTorrents to prevent overwriting fresh event data
    setTorrents(prev => {
      const prevMap = new Map(prev.map(t => [t.infoHash, t]));

      return list.map(newTorrent => {
        const existing = prevMap.get(newTorrent.infoHash);
        if (!existing) return newTorrent;

        // Keep the higher progress (progress only goes up)
        if (existing.progress > newTorrent.progress) {
          return {
            ...newTorrent,
            progress: existing.progress,
            downloadSpeed: existing.downloadSpeed,
            uploadSpeed: existing.uploadSpeed,
            peers: existing.peers,
          };
        }

        // Prefer non-zero speed values to prevent flashing
        const downloadSpeed = newTorrent.downloadSpeed > 0
          ? newTorrent.downloadSpeed
          : existing.downloadSpeed;
        const uploadSpeed = newTorrent.uploadSpeed > 0
          ? newTorrent.uploadSpeed
          : existing.uploadSpeed;
        const peers = newTorrent.peers > 0
          ? newTorrent.peers
          : existing.peers;

        return {
          ...newTorrent,
          downloadSpeed,
          uploadSpeed,
          peers,
        };
      });
    });
  }, []);

  const shutdownDaemon = useCallback(async (): Promise<void> => {
    if (!clientRef.current?.isConnected()) {
      return;
    }
    await clientRef.current.shutdown();
    setIsReady(false);
    setDaemonUptime(undefined);
  }, []);

  return {
    torrents,
    isReady,
    isConnecting,
    error,
    daemonUptime,
    getPeers,
    addTorrent,
    removeTorrent,
    pauseTorrent,
    resumeTorrent,
    getTorrent,
    getConfig,
    updateConfig,
    refresh,
    shutdownDaemon,
  };
}

export default useDaemonClient;
