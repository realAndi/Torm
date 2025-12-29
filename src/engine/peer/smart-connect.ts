/**
 * Smart Connection Manager
 *
 * Implements a dual-attempt connection strategy for peer connections:
 * 1. Attempt encrypted connection with short timeout
 * 2. On failure, retry with plaintext connection
 *
 * This approach matches how mature clients like qBittorrent handle encryption.
 *
 * @module engine/peer/smart-connect
 */

import { PeerConnection } from './connection.js';
import { attemptEncryptedConnection } from './encrypted-connection.js';
import { attemptPlaintextConnection } from './plaintext-connection.js';
import { RC4Stream } from './encryption.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a smart connection attempt
 */
export interface SmartConnectionResult {
  /** Whether the connection succeeded */
  success: boolean;
  /** Connected PeerConnection if successful */
  connection?: PeerConnection;
  /** Whether the connection is encrypted */
  encrypted: boolean;
  /** RC4 stream for encrypting outgoing data (if encrypted) */
  encryptStream?: RC4Stream;
  /** RC4 stream for decrypting incoming data (if encrypted) */
  decryptStream?: RC4Stream;
  /** Any remaining data after handshake (if encrypted) */
  remainder?: Buffer;
  /** Error message if failed */
  error?: string;
  /** Number of connection attempts made (1 or 2) */
  attempts: number;
}

/**
 * Encryption mode for connection attempts
 */
export type EncryptionMode = 'prefer' | 'require' | 'disabled';

/**
 * Options for smart connection
 */
export interface SmartConnectionOptions {
  /** Encryption mode */
  encryptionMode: EncryptionMode;
  /** Timeout for TCP connection (default: 5000ms) */
  connectTimeout?: number;
  /** Timeout for encryption handshake (default: 5000ms) */
  encryptionTimeout?: number;
  /** Idle timeout for the connection (default: 30000ms) */
  idleTimeout?: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for TCP connection */
const DEFAULT_CONNECT_TIMEOUT = 5000;

/** Default timeout for encryption handshake */
const DEFAULT_ENCRYPTION_TIMEOUT = 5000;

/** Default idle timeout for connections */
const DEFAULT_IDLE_TIMEOUT = 30000;

// =============================================================================
// Main Function
// =============================================================================

/**
 * Establish a connection to a peer with smart encryption handling
 *
 * Connection strategy based on encryption mode:
 *
 * - `disabled`: Only attempt plaintext connection
 * - `require`: Only attempt encrypted connection, fail if encryption fails
 * - `prefer`: Try encrypted first (5s timeout), fall back to plaintext on failure
 *
 * @param ip - Remote peer IP address
 * @param port - Remote peer port
 * @param infoHash - 20-byte info hash of the torrent (used for MSE SKEY)
 * @param options - Connection options including encryption mode
 * @returns Result with PeerConnection and encryption details
 */
export async function smartConnect(
  ip: string,
  port: number,
  infoHash: Buffer,
  options: SmartConnectionOptions
): Promise<SmartConnectionResult> {
  const {
    encryptionMode,
    connectTimeout = DEFAULT_CONNECT_TIMEOUT,
    encryptionTimeout = DEFAULT_ENCRYPTION_TIMEOUT,
    idleTimeout = DEFAULT_IDLE_TIMEOUT,
  } = options;

  // ==========================================================================
  // Mode: disabled - Only plaintext connection
  // ==========================================================================
  if (encryptionMode === 'disabled') {
    const result = await attemptPlaintextConnection(ip, port, {
      timeout: connectTimeout,
      idleTimeout,
    });

    if (result.success) {
      return {
        success: true,
        connection: result.connection,
        encrypted: false,
        attempts: 1,
      };
    }

    return {
      success: false,
      encrypted: false,
      error: result.error,
      attempts: 1,
    };
  }

  // ==========================================================================
  // Mode: require - Only encrypted connection
  // ==========================================================================
  if (encryptionMode === 'require') {
    const result = await attemptEncryptedConnection(ip, port, infoHash, {
      timeout: encryptionTimeout,
      requireEncryption: true,
      allowPlaintext: false,
    });

    if (result.success && result.socket) {
      // Wrap the socket in a PeerConnection
      const connection = PeerConnection.fromSocket(result.socket, {
        ip,
        port,
        timeout: idleTimeout,
      });

      // Enable encryption on the connection
      if (
        result.method === 'rc4' &&
        result.encryptStream &&
        result.decryptStream
      ) {
        connection.enableEncryption(
          'rc4',
          result.encryptStream,
          result.decryptStream
        );
      }

      return {
        success: true,
        connection,
        encrypted: result.method === 'rc4',
        encryptStream: result.encryptStream,
        decryptStream: result.decryptStream,
        remainder: result.remainder,
        attempts: 1,
      };
    }

    return {
      success: false,
      encrypted: false,
      error: result.error ?? 'Encrypted connection failed',
      attempts: 1,
    };
  }

  // ==========================================================================
  // Mode: prefer - Try encrypted first, fall back to plaintext
  // ==========================================================================

  // Attempt 1: Try encrypted connection
  const encryptedResult = await attemptEncryptedConnection(ip, port, infoHash, {
    timeout: encryptionTimeout,
    requireEncryption: false,
    allowPlaintext: true,
  });

  if (encryptedResult.success && encryptedResult.socket) {
    // Encrypted connection succeeded
    const connection = PeerConnection.fromSocket(encryptedResult.socket, {
      ip,
      port,
      timeout: idleTimeout,
    });

    // Enable encryption if RC4 was negotiated
    if (
      encryptedResult.method === 'rc4' &&
      encryptedResult.encryptStream &&
      encryptedResult.decryptStream
    ) {
      connection.enableEncryption(
        'rc4',
        encryptedResult.encryptStream,
        encryptedResult.decryptStream
      );
    }

    return {
      success: true,
      connection,
      encrypted: encryptedResult.method === 'rc4',
      encryptStream: encryptedResult.encryptStream,
      decryptStream: encryptedResult.decryptStream,
      remainder: encryptedResult.remainder,
      attempts: 1,
    };
  }

  // Attempt 2: Fall back to plaintext connection
  const plaintextResult = await attemptPlaintextConnection(ip, port, {
    timeout: connectTimeout,
    idleTimeout,
  });

  if (plaintextResult.success) {
    return {
      success: true,
      connection: plaintextResult.connection,
      encrypted: false,
      attempts: 2,
    };
  }

  // Both attempts failed
  return {
    success: false,
    encrypted: false,
    error: `Encrypted failed: ${encryptedResult.error}; Plaintext failed: ${plaintextResult.error}`,
    attempts: 2,
  };
}

// =============================================================================
// Exports
// =============================================================================

export default smartConnect;
