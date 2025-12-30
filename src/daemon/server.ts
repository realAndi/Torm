/**
 * Daemon Server for Torm
 *
 * Runs the TormEngine as a background daemon process, accepting connections
 * from clients (TUI, CLI) via Unix socket (macOS/Linux) or Named Pipe (Windows).
 *
 * @module daemon/server
 */

import { createServer, type Server, type Socket } from 'net';
import { unlink, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { TormEngine } from '../engine/TormEngine.js';
import { expandPath } from '../utils/platform.js';
import type { EngineConfig, Torrent } from '../engine/types.js';
import {
  type Message,
  type Request,
  type Response,
  type DaemonEvent,
  serializeMessage,
  deserializeMessage,
  DEFAULT_SOCKET_PATH,
} from './protocol.js';

// =============================================================================
// Types
// =============================================================================

export interface DaemonServerOptions {
  /** Path to socket/pipe (Unix socket or Windows Named Pipe) */
  socketPath?: string;

  /** Engine configuration */
  engineConfig?: Partial<EngineConfig>;

  /** Path to log file */
  logFile?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format timestamp for logging
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

// =============================================================================
// DaemonServer Class
// =============================================================================

export class DaemonServer {
  private engine: TormEngine;
  private server: Server | null = null;
  private clients: Set<Socket> = new Set();
  private socketPath: string;
  private logFile: string | null;
  private running = false;
  private startTime = 0;
  private messageBuffers: Map<Socket, string> = new Map();

  constructor(options: DaemonServerOptions = {}) {
    this.socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
    this.logFile = options.logFile ? expandPath(options.logFile) : null;
    this.engine = new TormEngine(options.engineConfig);
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Starts the daemon server
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Daemon is already running');
    }

    await this.log('Starting daemon server...');

    // Create log directory if needed
    if (this.logFile) {
      const logDir = dirname(this.logFile);
      if (!existsSync(logDir)) {
        await mkdir(logDir, { recursive: true });
      }
    }

    // Remove stale socket file if it exists
    if (existsSync(this.socketPath)) {
      await this.log(`Removing stale socket file: ${this.socketPath}`);
      await unlink(this.socketPath);
    }

    // Start the engine
    await this.engine.start();
    await this.log('Engine started');

    // Set up event forwarding
    this.setupEventForwarding();

    // Create Unix socket server
    this.server = createServer((socket) => this.handleConnection(socket));

    // Wait for server to start listening
    await new Promise<void>((resolve, reject) => {
      this.server!.on('error', reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.removeListener('error', reject);
        resolve();
      });
    });

    this.running = true;
    this.startTime = Date.now();

    await this.log(`Daemon listening on ${this.socketPath}`);

    // Broadcast engine started event
    this.broadcastEvent({
      type: 'engine:started',
      timestamp: Date.now(),
    });
  }

  /**
   * Stops the daemon server gracefully
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    await this.log('Stopping daemon server...');

    // Broadcast engine stopped event
    this.broadcastEvent({
      type: 'engine:stopped',
      timestamp: Date.now(),
    });

    // Close all client connections
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    this.messageBuffers.clear();

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    // Remove socket file
    if (existsSync(this.socketPath)) {
      await unlink(this.socketPath);
    }

    // Stop engine
    await this.engine.stop();

    this.running = false;
    await this.log('Daemon stopped');
  }

  /**
   * Check if daemon is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get daemon uptime in seconds
   */
  getUptime(): number {
    if (!this.running) return 0;
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  // ===========================================================================
  // Connection Handling
  // ===========================================================================

  private handleConnection(socket: Socket): void {
    this.clients.add(socket);
    this.messageBuffers.set(socket, '');

    this.log(`Client connected (${this.clients.size} total)`);

    socket.on('data', (data) => {
      this.handleData(socket, data);
    });

    socket.on('close', () => {
      this.clients.delete(socket);
      this.messageBuffers.delete(socket);
      this.log(`Client disconnected (${this.clients.size} total)`);
    });

    socket.on('error', (err) => {
      this.log(`Client error: ${err.message}`);
      this.clients.delete(socket);
      this.messageBuffers.delete(socket);
    });
  }

  private handleData(socket: Socket, data: Buffer | string): void {
    // Append to buffer
    const buffer = (this.messageBuffers.get(socket) ?? '') + data.toString();
    const lines = buffer.split('\n');

    // Process complete messages (all but the last element which may be partial)
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        this.processMessage(socket, line);
      }
    }

    // Keep the incomplete last line in the buffer
    this.messageBuffers.set(socket, lines[lines.length - 1]);
  }

  private async processMessage(socket: Socket, data: string): Promise<void> {
    try {
      const message = deserializeMessage(data);

      if (message.kind === 'request') {
        const response = await this.handleRequest(message.data);
        this.sendResponse(socket, response);
      }
    } catch (err) {
      this.log(`Error processing message: ${(err as Error).message}`);
    }
  }

  // ===========================================================================
  // Request Handling
  // ===========================================================================

  private async handleRequest(request: Request): Promise<Response> {
    const baseResponse = { id: request.id, success: true };

    try {
      switch (request.type) {
        case 'ping':
          return {
            ...baseResponse,
            type: 'ping',
            timestamp: Date.now(),
          };

        case 'getStatus':
          return {
            ...baseResponse,
            type: 'getStatus',
            running: this.running,
            uptime: this.getUptime(),
            torrents: this.engine.getAllTorrents().length,
            downloadSpeed: this.engine.getStats().totalDownloadSpeed,
            uploadSpeed: this.engine.getStats().totalUploadSpeed,
          };

        case 'getTorrents':
          return {
            ...baseResponse,
            type: 'getTorrents',
            torrents: this.engine.getAllTorrents(),
          };

        case 'getTorrent': {
          const torrent = this.engine.getTorrent(request.infoHash);
          return {
            ...baseResponse,
            type: 'getTorrent',
            torrent,
          };
        }

        case 'getPeers': {
          const peers = this.engine.getPeers(request.infoHash);
          return {
            ...baseResponse,
            type: 'getPeers',
            peers,
          };
        }

        case 'addTorrent': {
          const torrent = await this.engine.addTorrent(request.source, {
            downloadPath: request.downloadPath,
            startImmediately: request.startImmediately,
          });
          return {
            ...baseResponse,
            type: 'addTorrent',
            torrent,
          };
        }

        case 'removeTorrent':
          await this.engine.removeTorrent(
            request.infoHash,
            request.deleteFiles
          );
          return {
            ...baseResponse,
            type: 'removeTorrent',
          };

        case 'pauseTorrent':
          await this.engine.pauseTorrent(request.infoHash);
          return {
            ...baseResponse,
            type: 'pauseTorrent',
          };

        case 'resumeTorrent':
          await this.engine.resumeTorrent(request.infoHash);
          return {
            ...baseResponse,
            type: 'resumeTorrent',
          };

        case 'getConfig':
          return {
            ...baseResponse,
            type: 'getConfig',
            config: this.engine.getConfig(),
          };

        case 'updateConfig':
          await this.engine.updateConfig(request.config);
          return {
            ...baseResponse,
            type: 'updateConfig',
          };

        case 'getStats':
          return {
            ...baseResponse,
            type: 'getStats',
            stats: this.engine.getStats(),
          };

        case 'shutdown':
          // Schedule shutdown after response is sent
          setImmediate(() => this.stop());
          return {
            ...baseResponse,
            type: 'shutdown',
          };

        default: {
          const unknownRequest = request as { id: string; type: string };
          return {
            id: unknownRequest.id,
            success: false,
            type: unknownRequest.type,
            error: `Unknown request type: ${unknownRequest.type}`,
          } as Response;
        }
      }
    } catch (err) {
      return {
        id: request.id,
        success: false,
        type: request.type,
        error: (err as Error).message,
      } as Response;
    }
  }

  // ===========================================================================
  // Response/Event Sending
  // ===========================================================================

  private sendResponse(socket: Socket, response: Response): void {
    const message: Message = { kind: 'response', data: response };
    const serialized = serializeMessage(message);

    try {
      socket.write(serialized);
    } catch (err) {
      this.log(`Error sending response: ${(err as Error).message}`);
    }
  }

  private broadcastEvent(event: DaemonEvent): void {
    const message: Message = { kind: 'event', data: event };
    const serialized = serializeMessage(message);

    for (const client of this.clients) {
      try {
        client.write(serialized);
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }

  // ===========================================================================
  // Event Forwarding
  // ===========================================================================

  private setupEventForwarding(): void {
    this.engine.on('torrent:added', ({ torrent }) => {
      this.broadcastEvent({
        type: 'torrent:added',
        timestamp: Date.now(),
        torrent: torrent as unknown as Torrent,
      });
    });

    this.engine.on('torrent:removed', ({ infoHash }) => {
      this.broadcastEvent({
        type: 'torrent:removed',
        timestamp: Date.now(),
        infoHash,
      });
    });

    this.engine.on(
      'torrent:progress',
      ({ infoHash, progress, downloadSpeed, uploadSpeed, peers }) => {
        this.broadcastEvent({
          type: 'torrent:progress',
          timestamp: Date.now(),
          infoHash,
          progress,
          downloadSpeed,
          uploadSpeed,
          peers,
        });
      }
    );

    this.engine.on('torrent:completed', ({ torrent }) => {
      this.broadcastEvent({
        type: 'torrent:completed',
        timestamp: Date.now(),
        infoHash: torrent.infoHash,
      });
    });

    this.engine.on('engine:error', ({ error }) => {
      this.broadcastEvent({
        type: 'torrent:error',
        timestamp: Date.now(),
        infoHash: '',
        error: error.message,
      });
    });
  }

  // ===========================================================================
  // Logging
  // ===========================================================================

  private async log(message: string): Promise<void> {
    const formatted = `[${formatTimestamp()}] ${message}`;

    // Always log to console (will be captured if running as daemon)
    console.log(formatted);

    // Also write to log file if configured
    if (this.logFile) {
      try {
        await appendFile(this.logFile, formatted + '\n');
      } catch {
        // Ignore log file errors
      }
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

export default DaemonServer;
