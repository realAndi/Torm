/**
 * Default configuration values for the Torm engine.
 *
 * These defaults provide sensible starting values for a typical
 * BitTorrent client installation.
 *
 * @module engine/config/defaults
 */

import type { EngineConfig } from '../types.js';

/**
 * Default engine configuration.
 *
 * All fields have sensible defaults suitable for most use cases:
 * - Data stored in ~/.torm
 * - Downloads saved to ~/.torm/downloads
 * - Moderate connection limits to balance performance and resources
 * - DHT and PEX enabled for better peer discovery
 * - Standard BitTorrent port range
 */
export const DEFAULT_CONFIG: EngineConfig = {
  /** Default data directory for storing application state */
  dataDir: '~/.torm',

  /** Default download directory for completed files */
  downloadPath: '~/.torm/downloads',

  /** Maximum total peer connections across all torrents */
  maxConnections: 200,

  /** Maximum peer connections per individual torrent */
  maxConnectionsPerTorrent: 100,

  /** Maximum upload speed in bytes/second (0 = unlimited) */
  maxUploadSpeed: 0,

  /** Maximum download speed in bytes/second (0 = unlimited) */
  maxDownloadSpeed: 0,

  /** Enable Distributed Hash Table for decentralized peer discovery */
  dhtEnabled: true,

  /** Enable Peer Exchange protocol for peer discovery */
  pexEnabled: true,

  /** Port range for incoming peer connections */
  portRange: [6881, 6889] as [number, number],

  /** Preferred port for incoming connections */
  port: 6881,

  /** Verify existing data integrity when adding a torrent */
  verifyOnAdd: true,

  /** Automatically start downloading when adding a torrent */
  startOnAdd: true,

  /** Daemon configuration */
  daemon: {
    /** Background daemon mode enabled by default */
    enabled: true,

    /** Unix socket path for IPC */
    socketPath: '/tmp/torm.sock',

    /** Auto-start daemon when TUI launches */
    autoStart: true,

    /** Log file path */
    logFile: '~/.torm/daemon.log',

    /** PID file path */
    pidFile: '~/.torm/daemon.pid',
  },

  /** Encryption mode: disabled by default until MSE handshake is fully debugged */
  encryptionMode: 'disabled',

  /** UI/TUI display configuration */
  ui: {
    /** Minimum number of torrents visible in the scroll list */
    minVisibleTorrents: 5,
  },
};

/**
 * Merges a partial configuration with the default configuration.
 *
 * @param partialConfig - Partial configuration to merge
 * @returns Complete configuration with defaults applied
 */
export function mergeWithDefaults(
  partialConfig?: Partial<EngineConfig>
): EngineConfig {
  if (!partialConfig) {
    return {
      ...DEFAULT_CONFIG,
      daemon: { ...DEFAULT_CONFIG.daemon },
      ui: { ...DEFAULT_CONFIG.ui },
    };
  }

  return {
    ...DEFAULT_CONFIG,
    ...partialConfig,
    // Ensure portRange is properly copied as a tuple
    portRange: partialConfig.portRange
      ? ([...partialConfig.portRange] as [number, number])
      : [...DEFAULT_CONFIG.portRange],
    // Merge daemon config properly
    daemon: {
      ...DEFAULT_CONFIG.daemon,
      ...partialConfig.daemon,
    },
    // Merge ui config properly
    ui: {
      ...DEFAULT_CONFIG.ui,
      ...partialConfig.ui,
    },
  };
}
