/**
 * Daemon Module for Torm
 *
 * Exports all daemon-related components for background torrent operations.
 *
 * @module daemon
 */

// Protocol types and utilities
export {
  type RequestType,
  type EventType,
  type Request,
  type Response,
  type DaemonEvent,
  type Message,
  type BaseRequest,
  type BaseResponse,
  type BaseEvent,
  generateRequestId,
  serializeMessage,
  deserializeMessage,
  DEFAULT_DAEMON_PORT,
  DEFAULT_SOCKET_PATH,
  PROTOCOL_VERSION,
} from './protocol.js';

// Server
export { DaemonServer, type DaemonServerOptions } from './server.js';

// Client
export { DaemonClient, type DaemonClientOptions, type DaemonStatus } from './client.js';

// Manager
export {
  DaemonManager,
  type DaemonManagerOptions,
  type DaemonInfo,
  getDefaultManager,
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  isDaemonRunning,
  ensureDaemonRunning,
  getDaemonClient,
} from './manager.js';
