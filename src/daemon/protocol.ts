/**
 * Daemon Protocol for Torm
 *
 * Defines the JSON-based message protocol for communication between
 * the daemon server and clients (TUI, CLI).
 *
 * @module daemon/protocol
 */

import type { Torrent, Peer, EngineConfig, EngineStats } from '../engine/types.js';

// =============================================================================
// Message Types
// =============================================================================

/**
 * Request message types
 */
export type RequestType =
  | 'ping'
  | 'getStatus'
  | 'getTorrents'
  | 'getTorrent'
  | 'getPeers'
  | 'addTorrent'
  | 'removeTorrent'
  | 'pauseTorrent'
  | 'resumeTorrent'
  | 'getConfig'
  | 'updateConfig'
  | 'getStats'
  | 'shutdown';

/**
 * Event types emitted by daemon
 */
export type EventType =
  | 'torrent:added'
  | 'torrent:removed'
  | 'torrent:progress'
  | 'torrent:completed'
  | 'torrent:error'
  | 'engine:started'
  | 'engine:stopped';

// =============================================================================
// Request Messages
// =============================================================================

export interface BaseRequest {
  id: string;
  type: RequestType;
}

export interface PingRequest extends BaseRequest {
  type: 'ping';
}

export interface GetStatusRequest extends BaseRequest {
  type: 'getStatus';
}

export interface GetTorrentsRequest extends BaseRequest {
  type: 'getTorrents';
}

export interface GetTorrentRequest extends BaseRequest {
  type: 'getTorrent';
  infoHash: string;
}

export interface GetPeersRequest extends BaseRequest {
  type: 'getPeers';
  infoHash: string;
}

export interface AddTorrentRequest extends BaseRequest {
  type: 'addTorrent';
  source: string;
  downloadPath?: string;
  startImmediately?: boolean;
}

export interface RemoveTorrentRequest extends BaseRequest {
  type: 'removeTorrent';
  infoHash: string;
  deleteFiles?: boolean;
}

export interface PauseTorrentRequest extends BaseRequest {
  type: 'pauseTorrent';
  infoHash: string;
}

export interface ResumeTorrentRequest extends BaseRequest {
  type: 'resumeTorrent';
  infoHash: string;
}

export interface GetConfigRequest extends BaseRequest {
  type: 'getConfig';
}

export interface UpdateConfigRequest extends BaseRequest {
  type: 'updateConfig';
  config: Partial<EngineConfig>;
}

export interface GetStatsRequest extends BaseRequest {
  type: 'getStats';
}

export interface ShutdownRequest extends BaseRequest {
  type: 'shutdown';
}

export type Request =
  | PingRequest
  | GetStatusRequest
  | GetTorrentsRequest
  | GetTorrentRequest
  | GetPeersRequest
  | AddTorrentRequest
  | RemoveTorrentRequest
  | PauseTorrentRequest
  | ResumeTorrentRequest
  | GetConfigRequest
  | UpdateConfigRequest
  | GetStatsRequest
  | ShutdownRequest;

// =============================================================================
// Response Messages
// =============================================================================

export interface BaseResponse {
  id: string;
  success: boolean;
  error?: string;
}

export interface PingResponse extends BaseResponse {
  type: 'ping';
  timestamp: number;
}

export interface GetStatusResponse extends BaseResponse {
  type: 'getStatus';
  running: boolean;
  uptime: number;
  torrents: number;
  downloadSpeed: number;
  uploadSpeed: number;
}

export interface GetTorrentsResponse extends BaseResponse {
  type: 'getTorrents';
  torrents: Torrent[];
}

export interface GetTorrentResponse extends BaseResponse {
  type: 'getTorrent';
  torrent?: Torrent;
}

export interface GetPeersResponse extends BaseResponse {
  type: 'getPeers';
  peers: Peer[];
}

export interface AddTorrentResponse extends BaseResponse {
  type: 'addTorrent';
  torrent?: Torrent;
}

export interface RemoveTorrentResponse extends BaseResponse {
  type: 'removeTorrent';
}

export interface PauseTorrentResponse extends BaseResponse {
  type: 'pauseTorrent';
}

export interface ResumeTorrentResponse extends BaseResponse {
  type: 'resumeTorrent';
}

export interface GetConfigResponse extends BaseResponse {
  type: 'getConfig';
  config: EngineConfig;
}

export interface UpdateConfigResponse extends BaseResponse {
  type: 'updateConfig';
}

export interface GetStatsResponse extends BaseResponse {
  type: 'getStats';
  stats: EngineStats;
}

export interface ShutdownResponse extends BaseResponse {
  type: 'shutdown';
}

export type Response =
  | PingResponse
  | GetStatusResponse
  | GetTorrentsResponse
  | GetTorrentResponse
  | GetPeersResponse
  | AddTorrentResponse
  | RemoveTorrentResponse
  | PauseTorrentResponse
  | ResumeTorrentResponse
  | GetConfigResponse
  | UpdateConfigResponse
  | GetStatsResponse
  | ShutdownResponse;

// =============================================================================
// Event Messages
// =============================================================================

export interface BaseEvent {
  type: EventType;
  timestamp: number;
}

export interface TorrentAddedEvent extends BaseEvent {
  type: 'torrent:added';
  torrent: Torrent;
}

export interface TorrentRemovedEvent extends BaseEvent {
  type: 'torrent:removed';
  infoHash: string;
}

export interface TorrentProgressEvent extends BaseEvent {
  type: 'torrent:progress';
  infoHash: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
}

export interface TorrentCompletedEvent extends BaseEvent {
  type: 'torrent:completed';
  infoHash: string;
}

export interface TorrentErrorEvent extends BaseEvent {
  type: 'torrent:error';
  infoHash: string;
  error: string;
}

export interface EngineStartedEvent extends BaseEvent {
  type: 'engine:started';
}

export interface EngineStoppedEvent extends BaseEvent {
  type: 'engine:stopped';
}

export type DaemonEvent =
  | TorrentAddedEvent
  | TorrentRemovedEvent
  | TorrentProgressEvent
  | TorrentCompletedEvent
  | TorrentErrorEvent
  | EngineStartedEvent
  | EngineStoppedEvent;

// =============================================================================
// Message Wrapper
// =============================================================================

export type Message =
  | { kind: 'request'; data: Request }
  | { kind: 'response'; data: Response }
  | { kind: 'event'; data: DaemonEvent };

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Serialize a message to JSON string with newline delimiter
 */
export function serializeMessage(message: Message): string {
  return JSON.stringify(message) + '\n';
}

/**
 * Deserialize a JSON string to a message
 */
export function deserializeMessage(data: string): Message {
  return JSON.parse(data.trim()) as Message;
}

// =============================================================================
// Constants
// =============================================================================

/** Default daemon port (TCP) */
export const DEFAULT_DAEMON_PORT = 6800;

/** Default daemon socket path (Unix socket) */
export const DEFAULT_SOCKET_PATH = '/tmp/torm.sock';

/** Protocol version */
export const PROTOCOL_VERSION = 1;
