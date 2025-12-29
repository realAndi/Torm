/**
 * Daemon Client for Torm
 *
 * Connects to the daemon server via Unix socket, providing an API
 * for TUI and CLI to interact with the engine.
 *
 * @module daemon/client
 */

import { createConnection, type Socket } from 'net';
import { EventEmitter } from 'events';
import type { Torrent, Peer, EngineConfig, EngineStats } from '../engine/types.js';
import {
  type Message,
  type Request,
  type Response,
  type DaemonEvent,
  type GetStatusResponse,
  type GetTorrentsResponse,
  type GetTorrentResponse,
  type GetPeersResponse,
  type AddTorrentResponse,
  type GetConfigResponse,
  type GetStatsResponse,
  type PingResponse,
  serializeMessage,
  deserializeMessage,
  generateRequestId,
  DEFAULT_SOCKET_PATH,
} from './protocol.js';

// =============================================================================
// Types
// =============================================================================

export interface DaemonClientOptions {
  /** Path to Unix socket (default: /tmp/torm.sock) */
  socketPath?: string;

  /** Connection timeout in milliseconds (default: 5000) */
  connectTimeout?: number;

  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout?: number;

  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;

  /** Reconnect interval in milliseconds (default: 1000) */
  reconnectInterval?: number;

  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
}

export interface DaemonStatus {
  running: boolean;
  uptime: number;
  torrents: number;
  downloadSpeed: number;
  uploadSpeed: number;
}

type PendingRequest = {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timer: Timer;
};

// =============================================================================
// DaemonClient Class
// =============================================================================

export class DaemonClient extends EventEmitter {
  private socket: Socket | null = null;
  private socketPath: string;
  private connectTimeout: number;
  private requestTimeout: number;
  private autoReconnect: boolean;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimer: Timer | null = null;
  private connected = false;
  private connecting = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageBuffer = '';

  constructor(options: DaemonClientOptions = {}) {
    super();
    this.socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
    this.connectTimeout = options.connectTimeout ?? 5000;
    this.requestTimeout = options.requestTimeout ?? 30000;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Connect to the daemon server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connecting) {
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        this.once('connected', resolve);
        this.once('error', reject);
      });
    }

    this.connecting = true;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.connecting = false;
        reject(new Error(`Connection timeout after ${this.connectTimeout}ms`));
      }, this.connectTimeout);

      this.socket = createConnection(this.socketPath);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        this.connecting = false;
        this.reconnectAttempts = 0;
        this.emit('connected');
        resolve();
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('close', () => {
        this.handleDisconnect();
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        this.connecting = false;

        if (!this.connected) {
          reject(err);
        } else {
          this.emit('error', err);
        }
      });
    });
  }

  /**
   * Disconnect from the daemon server
   */
  disconnect(): void {
    this.autoReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    // Reject all pending requests
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();

    this.connected = false;
    this.messageBuffer = '';
  }

  /**
   * Check if connected to daemon
   */
  isConnected(): boolean {
    return this.connected;
  }

  private handleDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.socket = null;
    this.messageBuffer = '';

    // Reject all pending requests
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection lost'));
    }
    this.pendingRequests.clear();

    if (wasConnected) {
      this.emit('disconnected');

      // Attempt reconnection if enabled
      if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;
    this.emit('reconnecting', this.reconnectAttempts);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        await this.connect();
        this.emit('reconnected');
      } catch {
        if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else {
          this.emit('reconnect_failed');
        }
      }
    }, this.reconnectInterval);
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  private handleData(data: Buffer | string): void {
    this.messageBuffer += data.toString();
    const lines = this.messageBuffer.split('\n');

    // Process complete messages
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        this.processMessage(line);
      }
    }

    // Keep incomplete data in buffer
    this.messageBuffer = lines[lines.length - 1];
  }

  private processMessage(data: string): void {
    try {
      const message = deserializeMessage(data);

      if (message.kind === 'response') {
        this.handleResponse(message.data);
      } else if (message.kind === 'event') {
        this.handleEvent(message.data);
      }
    } catch (err) {
      this.emit('error', new Error(`Failed to parse message: ${(err as Error).message}`));
    }
  }

  private handleResponse(response: Response): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  private handleEvent(event: DaemonEvent): void {
    this.emit('event', event);
    this.emit(event.type, event);
  }

  // ===========================================================================
  // Request Methods
  // ===========================================================================

  /**
   * Send a request to the daemon and wait for response
   */
  private async request<T extends Response>(request: Request): Promise<T> {
    if (!this.connected || !this.socket) {
      throw new Error('Not connected to daemon');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout after ${this.requestTimeout}ms`));
      }, this.requestTimeout);

      this.pendingRequests.set(request.id, {
        resolve: resolve as (response: Response) => void,
        reject,
        timer,
      });

      const message: Message = { kind: 'request', data: request };
      const serialized = serializeMessage(message);

      this.socket!.write(serialized, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(request.id);
          reject(err);
        }
      });
    });
  }

  // ===========================================================================
  // Public API Methods
  // ===========================================================================

  /**
   * Ping the daemon to check connectivity
   */
  async ping(): Promise<number> {
    const response = await this.request<PingResponse>({
      id: generateRequestId(),
      type: 'ping',
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Ping failed');
    }

    return response.timestamp;
  }

  /**
   * Get daemon status
   */
  async getStatus(): Promise<DaemonStatus> {
    const response = await this.request<GetStatusResponse>({
      id: generateRequestId(),
      type: 'getStatus',
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to get status');
    }

    return {
      running: response.running,
      uptime: response.uptime,
      torrents: response.torrents,
      downloadSpeed: response.downloadSpeed,
      uploadSpeed: response.uploadSpeed,
    };
  }

  /**
   * Get all torrents
   */
  async getTorrents(): Promise<Torrent[]> {
    const response = await this.request<GetTorrentsResponse>({
      id: generateRequestId(),
      type: 'getTorrents',
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to get torrents');
    }

    return response.torrents;
  }

  /**
   * Get a specific torrent by info hash
   */
  async getTorrent(infoHash: string): Promise<Torrent | undefined> {
    const response = await this.request<GetTorrentResponse>({
      id: generateRequestId(),
      type: 'getTorrent',
      infoHash,
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to get torrent');
    }

    return response.torrent;
  }

  /**
   * Get peers for a torrent
   */
  async getPeers(infoHash: string): Promise<Peer[]> {
    const response = await this.request<GetPeersResponse>({
      id: generateRequestId(),
      type: 'getPeers',
      infoHash,
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to get peers');
    }

    return response.peers;
  }

  /**
   * Add a new torrent
   */
  async addTorrent(
    source: string,
    options?: { downloadPath?: string; startImmediately?: boolean }
  ): Promise<Torrent> {
    const response = await this.request<AddTorrentResponse>({
      id: generateRequestId(),
      type: 'addTorrent',
      source,
      downloadPath: options?.downloadPath,
      startImmediately: options?.startImmediately,
    });

    if (!response.success || !response.torrent) {
      throw new Error(response.error ?? 'Failed to add torrent');
    }

    return response.torrent;
  }

  /**
   * Remove a torrent
   */
  async removeTorrent(infoHash: string, deleteFiles = false): Promise<void> {
    const response = await this.request({
      id: generateRequestId(),
      type: 'removeTorrent',
      infoHash,
      deleteFiles,
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to remove torrent');
    }
  }

  /**
   * Pause a torrent
   */
  async pauseTorrent(infoHash: string): Promise<void> {
    const response = await this.request({
      id: generateRequestId(),
      type: 'pauseTorrent',
      infoHash,
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to pause torrent');
    }
  }

  /**
   * Resume a torrent
   */
  async resumeTorrent(infoHash: string): Promise<void> {
    const response = await this.request({
      id: generateRequestId(),
      type: 'resumeTorrent',
      infoHash,
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to resume torrent');
    }
  }

  /**
   * Get engine configuration
   */
  async getConfig(): Promise<EngineConfig> {
    const response = await this.request<GetConfigResponse>({
      id: generateRequestId(),
      type: 'getConfig',
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to get config');
    }

    return response.config;
  }

  /**
   * Update engine configuration
   */
  async updateConfig(config: Partial<EngineConfig>): Promise<void> {
    const response = await this.request({
      id: generateRequestId(),
      type: 'updateConfig',
      config,
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to update config');
    }
  }

  /**
   * Get engine statistics
   */
  async getStats(): Promise<EngineStats> {
    const response = await this.request<GetStatsResponse>({
      id: generateRequestId(),
      type: 'getStats',
    });

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to get stats');
    }

    return response.stats;
  }

  /**
   * Request daemon shutdown
   */
  async shutdown(): Promise<void> {
    try {
      await this.request({
        id: generateRequestId(),
        type: 'shutdown',
      });
    } catch {
      // Expected - daemon shuts down and closes connection
    }

    this.disconnect();
  }
}

// =============================================================================
// Exports
// =============================================================================

export default DaemonClient;
