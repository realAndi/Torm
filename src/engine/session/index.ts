/**
 * Session Module for Torm Engine
 *
 * Provides torrent session management, bandwidth limiting, choking algorithm
 * implementations, and state persistence for coordinating BitTorrent downloads
 * and uploads.
 *
 * @module engine/session
 */

// =============================================================================
// Session Manager
// =============================================================================

export {
  SessionManager,
  type SessionManagerOptions,
  type SessionManagerEvents,
  type TorrentSession,
} from './manager.js';

// =============================================================================
// Torrent Session (Full Implementation)
// =============================================================================

export {
  TorrentSession as TorrentSessionImpl,
  type TorrentSessionEvents,
  type TorrentSessionOptions,
} from './session.js';

// =============================================================================
// Bandwidth Limiter
// =============================================================================

export {
  BandwidthLimiter,
  type BandwidthLimitConfig,
  type BandwidthStats,
  type BucketStats,
  type TorrentBandwidthStats,
  type TransferDirection,
  type BandwidthLimiterEvents,
} from './bandwidth.js';

// =============================================================================
// Choking Algorithm
// =============================================================================

export {
  ChokingAlgorithm,
  type ChokingDecision,
  type ChokingEvents,
  type PeerList,
  type PeerStats,
} from './choking.js';

// =============================================================================
// State Persistence
// =============================================================================

export {
  saveTorrentState,
  loadTorrentState,
  loadAllTorrentStates,
  deleteTorrentState,
  torrentStateExists,
  createBitfield,
  extractCompletedPieces,
  AutoSaveManager,
  DEFAULT_AUTO_SAVE_INTERVAL,
  type PersistedTorrentState,
  type TorrentPersistenceInfo,
  type LoadedTorrentState,
  type GetTorrentStateCallback,
} from './persistence.js';
