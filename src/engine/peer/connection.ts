/**
 * TCP Socket Wrapper for Peer Connections
 *
 * Provides a type-safe, event-driven TCP connection wrapper for BitTorrent
 * peer communication. Handles connection establishment, timeout management,
 * backpressure, and clean disconnection.
 *
 * @module engine/peer/connection
 */

import * as net from 'net';
import { TypedEventEmitter } from '../events.js';
import { NetworkError } from '../types.js';
import { RC4Stream, type CryptoMethod } from './encryption.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Events emitted by PeerConnection.
 */
export interface PeerConnectionEvents {
  /** Emitted when the TCP connection is established */
  connect: void;

  /** Emitted when data is received from the peer */
  data: Buffer;

  /** Emitted when the connection is closed */
  close: { hadError: boolean };

  /** Emitted when an error occurs */
  error: Error;

  /** Emitted when the connection times out due to inactivity */
  timeout: void;
}

/**
 * Options for creating a peer connection.
 */
export interface PeerConnectionOptions {
  /** IP address of the peer */
  ip: string;

  /** Port number of the peer */
  port: number;

  /** Idle timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Connection timeout in milliseconds (default: 10000) */
  connectTimeout?: number;
}

/**
 * Options for creating a peer connection from an existing socket.
 */
export interface FromSocketOptions {
  /** IP address of the peer */
  ip: string;

  /** Port number of the peer */
  port: number;

  /** Idle timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Connection state enumeration.
 */
export enum ConnectionState {
  /** Initial state, not yet connected */
  Disconnected = 'disconnected',

  /** Currently attempting to connect */
  Connecting = 'connecting',

  /** Connection established and active */
  Connected = 'connected',

  /** Connection is being gracefully closed */
  Closing = 'closing',

  /** Connection has been closed */
  Closed = 'closed',
}

// =============================================================================
// Constants
// =============================================================================

/** Default idle timeout in milliseconds */
const DEFAULT_TIMEOUT = 30000;

/** Default connection timeout in milliseconds */
const DEFAULT_CONNECT_TIMEOUT = 10000;

// =============================================================================
// PeerConnection Class
// =============================================================================

/**
 * TCP socket wrapper for BitTorrent peer connections.
 *
 * Provides a clean interface for establishing and managing TCP connections
 * to remote peers, with built-in timeout handling, backpressure support,
 * and proper cleanup.
 *
 * @example
 * ```typescript
 * const conn = new PeerConnection({ ip: '192.168.1.1', port: 6881 });
 *
 * conn.on('data', (data) => {
 *   // Handle incoming data
 * });
 *
 * conn.on('error', (err) => {
 *   console.error('Connection error:', err);
 * });
 *
 * await conn.connect();
 * await conn.write(handshakeBuffer);
 * ```
 */
export class PeerConnection extends TypedEventEmitter<PeerConnectionEvents> {
  /** Remote peer IP address */
  private readonly ip: string;

  /** Remote peer port number */
  private readonly port: number;

  /** Idle timeout in milliseconds */
  private readonly timeoutMs: number;

  /** Connection timeout in milliseconds */
  private readonly connectTimeoutMs: number;

  /** Underlying TCP socket */
  private socket: net.Socket | null = null;

  /** Current connection state */
  private state: ConnectionState = ConnectionState.Disconnected;

  /** Idle timeout timer */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether an error has occurred */
  private hadError: boolean = false;

  /** Whether encryption is active */
  private encrypted: boolean = false;

  /** Encryption method in use */
  private encryptionMethod: CryptoMethod = 'plaintext';

  /** RC4 stream for encrypting outgoing data */
  private encryptStream?: RC4Stream;

  /** RC4 stream for decrypting incoming data */
  private decryptStream?: RC4Stream;

  /**
   * Create a new peer connection.
   *
   * @param options - Connection options including IP, port, and timeouts
   */
  constructor(options: PeerConnectionOptions) {
    super();

    this.ip = options.ip;
    this.port = options.port;
    this.timeoutMs = options.timeout ?? DEFAULT_TIMEOUT;
    this.connectTimeoutMs = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
  }

  // ===========================================================================
  // Static Factory Methods
  // ===========================================================================

  /**
   * Create a PeerConnection from an already-connected socket.
   *
   * This is used after a successful MSE handshake where we already have
   * an established socket connection. Skips the connection phase since
   * the socket is already connected.
   *
   * @param socket - An already-connected net.Socket
   * @param options - Connection options including IP, port, and timeout
   * @returns A new PeerConnection wrapping the existing socket
   */
  static fromSocket(socket: net.Socket, options: FromSocketOptions): PeerConnection {
    const connection = new PeerConnection({
      ip: options.ip,
      port: options.port,
      timeout: options.timeout,
      connectTimeout: 0, // Not used since socket is already connected
    });

    // Set up the internal state
    connection.socket = socket;
    connection.state = ConnectionState.Connected;

    // Set up event handlers on the existing socket
    socket.on('data', connection.handleData.bind(connection));
    socket.on('close', connection.handleClose.bind(connection));
    socket.on('end', connection.handleEnd.bind(connection));
    socket.on('error', (error: Error) => {
      if (connection.state === ConnectionState.Connected) {
        connection.hadError = true;
        connection.emit('error', error);
      }
    });

    // Start idle timer
    connection.resetIdleTimer();

    // Emit connect event (for consistency)
    connection.emit('connect');

    return connection;
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  /**
   * Whether the connection is currently established.
   */
  get connected(): boolean {
    return this.state === ConnectionState.Connected;
  }

  /**
   * Remote peer IP address.
   */
  get remoteAddress(): string {
    return this.ip;
  }

  /**
   * Remote peer port number.
   */
  get remotePort(): number {
    return this.port;
  }

  /**
   * Local IP address, if connected.
   */
  get localAddress(): string | undefined {
    return this.socket?.localAddress;
  }

  /**
   * Local port number, if connected.
   */
  get localPort(): number | undefined {
    return this.socket?.localPort;
  }

  /**
   * Current connection state.
   */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Whether the connection is encrypted.
   */
  get isEncrypted(): boolean {
    return this.encrypted && this.encryptionMethod === 'rc4';
  }

  /**
   * The encryption method in use.
   */
  get encryptMethod(): CryptoMethod {
    return this.encryptionMethod;
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Establish a TCP connection to the peer.
   *
   * @returns Promise that resolves when connected, rejects on error or timeout
   * @throws {NetworkError} If connection fails or times out
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Prevent connecting if already connected or connecting
      if (this.state !== ConnectionState.Disconnected) {
        reject(new NetworkError(`Cannot connect: connection is ${this.state}`));
        return;
      }

      this.state = ConnectionState.Connecting;
      this.hadError = false;

      // Create the socket
      this.socket = new net.Socket();

      // Set up connection timeout
      const connectTimer = setTimeout(() => {
        this.handleConnectTimeout(reject);
      }, this.connectTimeoutMs);

      // Handle successful connection
      const onConnect = (): void => {
        clearTimeout(connectTimer);
        this.state = ConnectionState.Connected;
        this.resetIdleTimer();
        this.emit('connect');
        resolve();
      };

      // Handle connection error
      const onError = (error: Error): void => {
        clearTimeout(connectTimer);
        this.hadError = true;

        if (this.state === ConnectionState.Connecting) {
          this.cleanup();
          reject(new NetworkError(`Connection failed: ${error.message}`));
        }
      };

      // Set up event handlers
      this.socket.once('connect', onConnect);
      this.socket.once('error', onError);

      // Set up persistent handlers after initial connection
      this.socket.on('data', this.handleData.bind(this));
      this.socket.on('close', this.handleClose.bind(this));
      this.socket.on('end', this.handleEnd.bind(this));

      // Replace one-time error handler with persistent one after connection
      this.socket.on('error', (error: Error) => {
        if (this.state === ConnectionState.Connected) {
          this.hadError = true;
          this.emit('error', error);
        }
      });

      // Initiate connection
      this.socket.connect(this.port, this.ip);
    });
  }

  /**
   * Send data to the peer.
   *
   * Handles backpressure by waiting for the socket to drain if the
   * write buffer is full. If encryption is enabled, data is encrypted
   * before sending.
   *
   * @param data - Data buffer to send
   * @returns Promise that resolves when data is written (or buffered if not draining)
   * @throws {NetworkError} If connection is not established
   */
  write(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.state !== ConnectionState.Connected) {
        reject(new NetworkError('Cannot write: connection is not established'));
        return;
      }

      // Reset idle timer on write activity
      this.resetIdleTimer();

      // Encrypt data if encryption is active
      let dataToSend = data;
      if (this.encrypted && this.encryptStream) {
        // Create a copy to avoid modifying the original buffer
        dataToSend = Buffer.from(data);
        this.encryptStream.process(dataToSend);
      }

      // Write the data
      const flushed = this.socket.write(dataToSend, (error) => {
        if (error) {
          reject(new NetworkError(`Write failed: ${error.message}`));
        }
      });

      if (flushed) {
        // Data was fully flushed to the kernel buffer
        resolve();
      } else {
        // Backpressure: wait for drain event
        this.socket.once('drain', () => {
          resolve();
        });
      }
    });
  }

  /**
   * Gracefully close the connection.
   *
   * Sends FIN packet and allows the peer to close their end.
   * The connection will emit 'close' when fully closed.
   */
  close(): void {
    if (!this.socket || this.state === ConnectionState.Closed || this.state === ConnectionState.Closing) {
      return;
    }

    this.state = ConnectionState.Closing;
    this.clearIdleTimer();

    // End the writable side (sends FIN)
    this.socket.end();
  }

  /**
   * Forcefully destroy the connection.
   *
   * Immediately terminates the connection without waiting for graceful close.
   * Use this when you need to immediately terminate the connection.
   */
  destroy(): void {
    if (!this.socket) {
      return;
    }

    this.state = ConnectionState.Closed;
    this.cleanup();
    this.socket.destroy();
  }

  /**
   * Enable encryption on this connection.
   *
   * Must be called after MSE handshake completes successfully.
   *
   * @param method - The encryption method to use
   * @param encryptStream - RC4 stream for encrypting outgoing data
   * @param decryptStream - RC4 stream for decrypting incoming data
   */
  enableEncryption(
    method: CryptoMethod,
    encryptStream?: RC4Stream,
    decryptStream?: RC4Stream
  ): void {
    this.encryptionMethod = method;

    if (method === 'rc4') {
      if (!encryptStream || !decryptStream) {
        throw new Error('RC4 streams required for rc4 encryption');
      }
      this.encryptStream = encryptStream;
      this.decryptStream = decryptStream;
      this.encrypted = true;
    }
  }

  /**
   * Feed data directly into the connection's data handler.
   *
   * This is used after MSE handshake to process any remaining data
   * from the handshake buffer.
   *
   * @param data - Data to process
   */
  feedData(data: Buffer): void {
    if (data.length > 0) {
      this.handleData(data);
    }
  }

  /**
   * Get the raw socket for MSE handshake.
   *
   * This provides direct socket access for the encryption handshake
   * which needs to operate before the normal protocol layer.
   *
   * @returns The underlying socket, or null if not connected
   */
  getRawSocket(): net.Socket | null {
    return this.socket;
  }

  /**
   * Pause data events on the socket.
   *
   * This is used during MSE handshake to prevent the connection's
   * normal data handler from processing handshake data.
   */
  pauseData(): void {
    if (this.socket) {
      this.socket.pause();
    }
  }

  /**
   * Resume data events on the socket.
   *
   * Call this after MSE handshake completes to resume normal data flow.
   */
  resumeData(): void {
    if (this.socket) {
      this.socket.resume();
    }
  }

  /**
   * Remove all data listeners temporarily for MSE handshake.
   *
   * Returns a function to restore the listeners.
   */
  suspendDataHandler(): () => void {
    if (!this.socket) {
      return () => {};
    }

    // Remove the data listener
    this.socket.removeAllListeners('data');

    // Return a function to restore it
    return () => {
      if (this.socket) {
        this.socket.on('data', this.handleData.bind(this));
      }
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Handle incoming data from the socket.
   */
  private handleData(data: Buffer): void {
    // Reset idle timer on data activity
    this.resetIdleTimer();

    // Decrypt data if encryption is active
    let processedData = data;
    if (this.encrypted && this.decryptStream) {
      // Create a copy to avoid modifying the original buffer
      processedData = Buffer.from(data);
      this.decryptStream.process(processedData);
    }

    // Emit the data event
    this.emit('data', processedData);
  }

  /**
   * Handle the 'end' event (peer closed their write side).
   */
  private handleEnd(): void {
    // Peer has finished sending data (half-close)
    // We can still write, but typically we close our side too
    if (this.state === ConnectionState.Connected) {
      this.state = ConnectionState.Closing;
      this.close();
    }
  }

  /**
   * Handle socket close.
   */
  private handleClose(): void {
    this.state = ConnectionState.Closed;
    this.cleanup();

    // Emit close event with error flag
    this.emit('close', { hadError: this.hadError });
  }

  /**
   * Handle connection timeout.
   */
  private handleConnectTimeout(reject: (error: Error) => void): void {
    if (this.state !== ConnectionState.Connecting) {
      return;
    }

    this.hadError = true;
    this.cleanup();

    if (this.socket) {
      this.socket.destroy();
    }

    reject(new NetworkError(`Connection timed out after ${this.connectTimeoutMs}ms`));
  }

  /**
   * Reset the idle timeout timer.
   */
  private resetIdleTimer(): void {
    this.clearIdleTimer();

    if (this.timeoutMs > 0 && this.state === ConnectionState.Connected) {
      this.idleTimer = setTimeout(() => {
        this.handleIdleTimeout();
      }, this.timeoutMs);
    }
  }

  /**
   * Clear the idle timeout timer.
   */
  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Handle idle timeout.
   */
  private handleIdleTimeout(): void {
    if (this.state !== ConnectionState.Connected) {
      return;
    }

    // Emit timeout event
    this.emit('timeout');

    // Close the connection
    this.close();
  }

  /**
   * Clean up resources.
   */
  private cleanup(): void {
    this.clearIdleTimer();

    if (this.socket) {
      // Remove all listeners to prevent memory leaks
      this.socket.removeAllListeners();
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new peer connection.
 *
 * @param options - Connection options
 * @returns A new PeerConnection instance
 */
export function createPeerConnection(options: PeerConnectionOptions): PeerConnection {
  return new PeerConnection(options);
}
