/**
 * Tracker Module
 *
 * Provides tracker communication functionality for the Torm engine.
 * Supports both HTTP and UDP tracker protocols.
 *
 * @module engine/tracker
 */

// Export HTTP tracker
export * from './http.js';

// Export UDP tracker
export * from './udp.js';

// Export tracker client (coordinator)
export {
  TrackerClient,
  type TrackerClientOptions,
  type TrackerClientEvents,
  type TorrentTrackerState,
  type PeerInfo as TrackerPeerInfo,
  type AnnounceResponse as TrackerAnnounceResponse,
  getTrackerType,
  parseAnnounceList,
} from './client.js';
