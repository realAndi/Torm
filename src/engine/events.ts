/**
 * Typed Event Emitter System for Torm Engine
 *
 * Provides type-safe event emission and subscription for all engine events.
 * Extends Node's EventEmitter with full TypeScript type safety.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Core Types (imported from types.ts when available)
// ============================================================================

/**
 * Torrent state enumeration
 */
export enum TorrentState {
  Queued = 'queued',
  Checking = 'checking',
  Downloading = 'downloading',
  Seeding = 'seeding',
  Paused = 'paused',
  Error = 'error',
}

/**
 * File download priority
 */
export enum FilePriority {
  Skip = 0,
  Low = 1,
  Normal = 2,
  High = 3,
}

/**
 * Tracker connection status
 */
export enum TrackerStatus {
  Idle = 'idle',
  Announcing = 'announcing',
  Working = 'working',
  Error = 'error',
}

/**
 * Represents a file within a torrent
 */
export interface TorrentFile {
  path: string;
  size: number;
  progress: number;
  priority: FilePriority;
}

/**
 * Represents a torrent's complete state
 */
export interface Torrent {
  // Identification
  infoHash: string;
  name: string;

  // Metadata
  totalSize: number;
  pieceLength: number;
  pieceCount: number;
  files: TorrentFile[];

  // Progress
  downloaded: number;
  uploaded: number;
  progress: number;

  // Speeds
  downloadSpeed: number;
  uploadSpeed: number;

  // Connections
  peers: number;
  seeds: number;

  // State
  state: TorrentState;
  error?: string;

  // Timestamps
  addedAt: Date;
  completedAt?: Date;
}

/**
 * Represents a connected peer
 */
export interface Peer {
  id: string;
  ip: string;
  port: number;
  client: string;

  // State
  connected: boolean;
  choking: boolean;
  interested: boolean;

  // Speeds
  downloadSpeed: number;
  uploadSpeed: number;

  // Progress
  progress: number;
}

/**
 * Represents tracker information
 */
export interface TrackerInfo {
  url: string;
  status: TrackerStatus;
  peers: number;
  seeds: number;
  leechers: number;
  lastAnnounce?: Date;
  nextAnnounce?: Date;
  error?: string;
}

// ============================================================================
// Event Payload Types
// ============================================================================

/**
 * Complete event map for the Torm engine
 *
 * All events and their payload types are defined here for full type safety.
 */
export interface TormEvents {
  // Engine lifecycle events
  'engine:ready': void;
  'engine:started': void;
  'engine:stopped': void;
  'engine:error': { error: Error };

  // Torrent lifecycle events
  'torrent:added': { torrent: Torrent };
  'torrent:removed': { infoHash: string };
  'torrent:started': { infoHash: string };
  'torrent:paused': { infoHash: string };
  'torrent:resumed': { infoHash: string };
  'torrent:completed': { torrent: Torrent };
  'torrent:error': { infoHash: string; error: Error };

  // Progress updates (throttled to ~1/second per torrent)
  'torrent:progress': {
    infoHash: string;
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    peers: number;
  };

  // Piece events
  'piece:verified': { infoHash: string; pieceIndex: number };
  'piece:failed': { infoHash: string; pieceIndex: number };

  // Peer events
  'peer:connected': { infoHash: string; peer: Peer };
  'peer:disconnected': { infoHash: string; peerId: string };

  // Tracker events
  'tracker:announce': { infoHash: string; tracker: TrackerInfo };
  'tracker:error': { infoHash: string; url: string; error: Error };
}

// ============================================================================
// TypedEventEmitter Implementation
// ============================================================================

/**
 * Type-safe event emitter that wraps Node's EventEmitter
 *
 * Provides compile-time type checking for event names and payloads.
 *
 * @template T - Event map type defining event names and their payload types
 *
 * @example
 * ```typescript
 * const emitter = new TypedEventEmitter<TormEvents>();
 *
 * // Type-safe subscription
 * emitter.on('torrent:added', ({ torrent }) => {
 *   console.log(`Added: ${torrent.name}`);
 * });
 *
 * // Type-safe emission
 * emitter.emit('torrent:added', { torrent: myTorrent });
 *
 * // Compile error: wrong payload type
 * emitter.emit('torrent:added', { infoHash: 'abc' }); // Error!
 *
 * // Compile error: unknown event
 * emitter.emit('unknown:event', {}); // Error!
 * ```
 */
export class TypedEventEmitter<T extends { [K in keyof T]: unknown }> {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
  }

  /**
   * Subscribe to an event
   *
   * @param event - The event name
   * @param listener - Callback function receiving the event payload
   * @returns this for chaining
   */
  on<K extends keyof T>(
    event: K,
    listener: T[K] extends void ? () => void : (payload: T[K]) => void
  ): this {
    this.emitter.on(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Subscribe to an event once (auto-unsubscribes after first emission)
   *
   * @param event - The event name
   * @param listener - Callback function receiving the event payload
   * @returns this for chaining
   */
  once<K extends keyof T>(
    event: K,
    listener: T[K] extends void ? () => void : (payload: T[K]) => void
  ): this {
    this.emitter.once(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Unsubscribe from an event
   *
   * @param event - The event name
   * @param listener - The listener function to remove
   * @returns this for chaining
   */
  off<K extends keyof T>(
    event: K,
    listener: T[K] extends void ? () => void : (payload: T[K]) => void
  ): this {
    this.emitter.off(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Emit an event with payload
   *
   * @param event - The event name
   * @param payload - The event payload (omit for void events)
   * @returns true if event had listeners, false otherwise
   */
  emit<K extends keyof T>(
    event: K,
    ...args: T[K] extends void ? [] : [payload: T[K]]
  ): boolean {
    return this.emitter.emit(event as string, ...args);
  }

  /**
   * Remove all listeners for a specific event or all events
   *
   * @param event - Optional event name. If omitted, removes all listeners for all events.
   * @returns this for chaining
   */
  removeAllListeners<K extends keyof T>(event?: K): this {
    if (event !== undefined) {
      this.emitter.removeAllListeners(event as string);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }

  /**
   * Get the number of listeners for a specific event
   *
   * @param event - The event name
   * @returns Number of listeners
   */
  listenerCount<K extends keyof T>(event: K): number {
    return this.emitter.listenerCount(event as string);
  }

  /**
   * Set the maximum number of listeners per event
   *
   * @param n - Maximum number of listeners (0 = unlimited)
   * @returns this for chaining
   */
  setMaxListeners(n: number): this {
    this.emitter.setMaxListeners(n);
    return this;
  }

  /**
   * Get the maximum number of listeners per event
   *
   * @returns Maximum number of listeners
   */
  getMaxListeners(): number {
    return this.emitter.getMaxListeners();
  }

  /**
   * Get array of event names that have listeners
   *
   * @returns Array of event names
   */
  eventNames(): (keyof T)[] {
    return this.emitter.eventNames() as (keyof T)[];
  }

  /**
   * Prepend a listener to the beginning of the listeners array
   *
   * @param event - The event name
   * @param listener - Callback function receiving the event payload
   * @returns this for chaining
   */
  prependListener<K extends keyof T>(
    event: K,
    listener: T[K] extends void ? () => void : (payload: T[K]) => void
  ): this {
    this.emitter.prependListener(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Prepend a one-time listener to the beginning of the listeners array
   *
   * @param event - The event name
   * @param listener - Callback function receiving the event payload
   * @returns this for chaining
   */
  prependOnceListener<K extends keyof T>(
    event: K,
    listener: T[K] extends void ? () => void : (payload: T[K]) => void
  ): this {
    this.emitter.prependOnceListener(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Returns a promise that resolves when the specified event is emitted
   *
   * @param event - The event name to wait for
   * @returns Promise resolving to the event payload
   */
  waitFor<K extends keyof T>(event: K): Promise<T[K]> {
    return new Promise((resolve) => {
      this.once(event, ((payload: T[K]) => {
        resolve(payload);
      }) as T[K] extends void ? () => void : (payload: T[K]) => void);
    });
  }
}

// ============================================================================
// Type Aliases
// ============================================================================

/**
 * Pre-configured event emitter type for Torm engine
 */
export type TormEventEmitter = TypedEventEmitter<TormEvents>;

/**
 * Create a new TormEventEmitter instance
 *
 * @returns A new typed event emitter configured for Torm events
 */
export function createTormEventEmitter(): TormEventEmitter {
  return new TypedEventEmitter<TormEvents>();
}

// ============================================================================
// Event Name Constants
// ============================================================================

/**
 * Event name constants for runtime use
 */
export const EventNames = {
  // Engine lifecycle
  ENGINE_READY: 'engine:ready',
  ENGINE_STARTED: 'engine:started',
  ENGINE_STOPPED: 'engine:stopped',
  ENGINE_ERROR: 'engine:error',

  // Torrent lifecycle
  TORRENT_ADDED: 'torrent:added',
  TORRENT_REMOVED: 'torrent:removed',
  TORRENT_STARTED: 'torrent:started',
  TORRENT_PAUSED: 'torrent:paused',
  TORRENT_RESUMED: 'torrent:resumed',
  TORRENT_COMPLETED: 'torrent:completed',
  TORRENT_ERROR: 'torrent:error',
  TORRENT_PROGRESS: 'torrent:progress',

  // Piece events
  PIECE_VERIFIED: 'piece:verified',
  PIECE_FAILED: 'piece:failed',

  // Peer events
  PEER_CONNECTED: 'peer:connected',
  PEER_DISCONNECTED: 'peer:disconnected',

  // Tracker events
  TRACKER_ANNOUNCE: 'tracker:announce',
  TRACKER_ERROR: 'tracker:error',
} as const;

/**
 * Type representing valid event names
 */
export type TormEventName = keyof TormEvents;
