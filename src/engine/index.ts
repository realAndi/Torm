/**
 * Torm BitTorrent Engine
 *
 * This module exports the core BitTorrent protocol implementation,
 * including the main TormEngine class and all supporting types.
 *
 * @module engine
 */

export const engineVersion = '0.1.0';

// Main engine class
export { TormEngine } from './TormEngine.js';

// Type definitions (canonical source for all types)
export * from './types.js';

// Event system (only export event-specific items, types come from types.ts)
export {
  TypedEventEmitter,
  type TormEventEmitter,
  createTormEventEmitter,
  EventNames,
  type TormEventName,
} from './events.js';

// Bencode parser
export * from './bencode.js';

// Configuration
export * from './config/index.js';

// Placeholder exports for engine modules
export * from './torrent/index.js';
export * from './tracker/index.js';
export * from './peer/index.js';
export * from './piece/index.js';
export * from './disk/index.js';
export * from './session/index.js';
