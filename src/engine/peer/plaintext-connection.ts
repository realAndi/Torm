/**
 * Plaintext Connection Attempt Handler
 *
 * Simple wrapper that creates a PeerConnection and connects without encryption.
 * Provides symmetry with EncryptedConnectionAttempt for clean separation.
 *
 * @module engine/peer/plaintext-connection
 */

import { PeerConnection, type PeerConnectionOptions } from './connection.js';

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for plaintext connection attempt (5 seconds) */
const DEFAULT_CONNECT_TIMEOUT = 5000;

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a plaintext connection attempt
 */
export interface PlaintextConnectionResult {
  /** Whether the connection succeeded */
  success: boolean;
  /** Connected PeerConnection if successful */
  connection?: PeerConnection;
  /** Error message if failed */
  error?: string;
}

/**
 * Options for plaintext connection attempt
 */
export interface PlaintextConnectionOptions {
  /** Connection timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Idle timeout in milliseconds (default: 30000) */
  idleTimeout?: number;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Attempt to establish a plaintext connection to a peer
 *
 * Creates a PeerConnection and connects without encryption.
 * Returns the connected PeerConnection on success, or error on failure.
 *
 * @param ip - Remote peer IP address
 * @param port - Remote peer port
 * @param options - Connection options
 * @returns Result with PeerConnection on success, error on failure
 */
export async function attemptPlaintextConnection(
  ip: string,
  port: number,
  options: PlaintextConnectionOptions = {}
): Promise<PlaintextConnectionResult> {
  const connectTimeout = options.timeout ?? DEFAULT_CONNECT_TIMEOUT;
  const idleTimeout = options.idleTimeout ?? 30000;

  const connectionOptions: PeerConnectionOptions = {
    ip,
    port,
    connectTimeout,
    timeout: idleTimeout,
  };

  const connection = new PeerConnection(connectionOptions);

  try {
    // Attempt connection with timeout
    await withTimeout(
      connection.connect(),
      connectTimeout,
      `Connection to ${ip}:${port} timed out`
    );

    return {
      success: true,
      connection,
    };
  } catch (err) {
    // Clean up on failure
    try {
      connection.destroy();
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Helper to wrap a promise with a timeout
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err) {
    clearTimeout(timeoutId!);
    throw err;
  }
}

// =============================================================================
// Exports
// =============================================================================

export default attemptPlaintextConnection;
