/**
 * Disk Module for Torm BitTorrent Client
 *
 * Provides disk I/O operations and piece management.
 *
 * @module engine/disk
 */

// I/O exports
export {
  DiskIO,
  DiskIOOptions,
  AllocationStrategy,
  PieceReadResult,
  calculateRequiredSpace,
  hasEnoughSpace,
  normalizePath,
} from './io.js';

// Manager exports
export {
  DiskManager,
  DiskManagerOptions,
  DiskManagerEvents,
  DEFAULT_READ_CACHE_SIZE,
  DEFAULT_MAX_WRITE_QUEUE_SIZE,
  DEFAULT_VERIFICATION_CONCURRENCY,
  DEFAULT_SPACE_CHECK_INTERVAL,
  DEFAULT_MAX_RETRY_QUEUE_SIZE,
} from './manager.js';

// Re-export error types for convenience
export { DiskError, DiskFullError } from '../types.js';
