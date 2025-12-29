/**
 * Encrypted Connection Attempt Handler
 *
 * Handles a single MSE (Message Stream Encryption) connection attempt.
 * Uses raw net.Socket directly to avoid event handler conflicts with PeerConnection.
 *
 * @module engine/peer/encrypted-connection
 */

import * as net from 'net';
import {
  generateDHKeyPair,
  computeDHSecret,
  deriveRC4Keys,
  hashSync1,
  hashSync2,
  hashSync3,
  VC,
  DH_KEY_LENGTH,
  CryptoProvide,
  RC4Stream,
  type CryptoMethod,
} from './encryption.js';
import { randomBytes } from 'crypto';

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for encrypted connection attempt (5 seconds) */
const DEFAULT_ENCRYPTION_TIMEOUT = 5000;

/** Maximum padding length for DH key exchange */
const MAX_PAD_LENGTH = 512;

/** Maximum buffer size to prevent memory exhaustion */
const MAX_BUFFER_SIZE = 65536;

// =============================================================================
// Types
// =============================================================================

/**
 * Result of an encrypted connection attempt
 */
export interface EncryptedConnectionResult {
  /** Whether the connection and MSE handshake succeeded */
  success: boolean;
  /** Connected socket if successful */
  socket?: net.Socket;
  /** RC4 stream for encrypting outgoing data */
  encryptStream?: RC4Stream;
  /** RC4 stream for decrypting incoming data */
  decryptStream?: RC4Stream;
  /** Selected encryption method */
  method?: CryptoMethod;
  /** Any remaining data after handshake */
  remainder?: Buffer;
  /** Error message if failed */
  error?: string;
}

/**
 * Options for encrypted connection attempt
 */
export interface EncryptedConnectionOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Whether to require encryption (reject plaintext) */
  requireEncryption?: boolean;
  /** Whether to allow plaintext as fallback */
  allowPlaintext?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Read data from socket until minimum bytes received or timeout
 */
function readMinBytes(
  socket: net.Socket,
  minBytes: number,
  timeout: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let timeoutId: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    const onData = (data: Buffer) => {
      chunks.push(data);
      totalLength += data.length;

      if (totalLength >= minBytes) {
        cleanup();
        resolve(Buffer.concat(chunks));
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      reject(new Error('Connection closed during MSE handshake'));
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('MSE handshake timeout'));
    }, timeout);

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

/**
 * Write data to socket with promise wrapper
 */
function socketWrite(socket: net.Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Attempt to establish an encrypted connection to a peer
 *
 * Creates a raw TCP socket, connects, and performs the full MSE handshake.
 * On failure, the socket is destroyed completely.
 *
 * @param ip - Remote peer IP address
 * @param port - Remote peer port
 * @param infoHash - 20-byte info hash of the torrent (used as SKEY)
 * @param options - Connection options
 * @returns Result with socket and encryption streams on success, error on failure
 */
export async function attemptEncryptedConnection(
  ip: string,
  port: number,
  infoHash: Buffer,
  options: EncryptedConnectionOptions = {}
): Promise<EncryptedConnectionResult> {
  const timeout = options.timeout ?? DEFAULT_ENCRYPTION_TIMEOUT;
  const requireEncryption = options.requireEncryption ?? false;
  const allowPlaintext = options.allowPlaintext ?? true;

  const socket = new net.Socket();
  let timeoutId: NodeJS.Timeout | undefined;

  const cleanup = (destroySocket = true) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    socket.removeAllListeners();
    if (destroySocket && !socket.destroyed) {
      socket.destroy();
    }
  };

  try {
    // Set up overall timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Encrypted connection timeout'));
      }, timeout);
    });

    // Connect to peer
    const connectPromise = new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        socket.removeListener('error', onError);
        resolve();
      };

      const onError = (err: Error) => {
        socket.removeListener('connect', onConnect);
        reject(err);
      };

      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.connect(port, ip);
    });

    await Promise.race([connectPromise, timeoutPromise]);

    // Connection established, perform MSE handshake
    const handshakeResult = await Promise.race([
      performMSEHandshakeOnSocket(socket, infoHash, {
        requireEncryption,
        allowPlaintext,
        timeout: timeout - 1000, // Leave 1s buffer for connection
      }),
      timeoutPromise,
    ]);

    // Clear timeout on success
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }

    if (!handshakeResult.success) {
      cleanup(true);
      return {
        success: false,
        error: handshakeResult.error,
      };
    }

    // Remove our listeners but keep socket alive
    cleanup(false);

    return {
      success: true,
      socket,
      encryptStream: handshakeResult.encryptStream,
      decryptStream: handshakeResult.decryptStream,
      method: handshakeResult.method,
      remainder: handshakeResult.remainder,
    };
  } catch (err) {
    cleanup(true);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Perform MSE handshake on an already-connected socket
 */
async function performMSEHandshakeOnSocket(
  socket: net.Socket,
  infoHash: Buffer,
  options: {
    requireEncryption: boolean;
    allowPlaintext: boolean;
    timeout: number;
  }
): Promise<{
  success: boolean;
  encryptStream?: RC4Stream;
  decryptStream?: RC4Stream;
  method?: CryptoMethod;
  remainder?: Buffer;
  error?: string;
}> {
  const { requireEncryption, allowPlaintext, timeout } = options;

  try {
    // Step 1: Generate DH key pair and send public key with padding
    const { privateKey, publicKey } = generateDHKeyPair();

    // Random padding (0-512 bytes as per spec)
    const padALength = Math.floor(Math.random() * MAX_PAD_LENGTH);
    const padA = randomBytes(padALength);

    // Send: Ya + PadA
    const step1Message = Buffer.concat([publicKey, padA]);
    await socketWrite(socket, step1Message);

    // Step 2: Receive Yb + PadB from peer
    // We need at least DH_KEY_LENGTH bytes for the public key
    const recvBuffer = await readMinBytes(socket, DH_KEY_LENGTH, timeout);

    // Check if peer sent plaintext BitTorrent handshake instead of MSE
    if (recvBuffer[0] === 0x13) {
      return {
        success: false,
        error: 'Peer sent plaintext handshake instead of MSE',
      };
    }

    // Extract peer's public key
    const peerPublicKey = Buffer.from(recvBuffer.subarray(0, DH_KEY_LENGTH));

    // Compute shared secret
    const sharedSecret = computeDHSecret(privateKey, peerPublicKey);

    // Step 3: Send our crypto request
    const req1Hash = hashSync1(sharedSecret);
    const req2Hash = hashSync2(infoHash);
    const req3Hash = hashSync3(sharedSecret, infoHash);

    // XOR req2Hash with req3Hash to obfuscate the info hash
    const skeyXor = Buffer.alloc(20);
    for (let i = 0; i < 20; i++) {
      skeyXor[i] = req2Hash[i] ^ req3Hash[i];
    }

    // Build crypto_provide flags
    let cryptoProvide = CryptoProvide.RC4;
    if (allowPlaintext && !requireEncryption) {
      cryptoProvide |= CryptoProvide.PLAINTEXT;
    }

    // Random padding for step 3
    const padCLength = Math.floor(Math.random() * MAX_PAD_LENGTH);
    const padC = randomBytes(padCLength);

    // Empty initial payload (BitTorrent handshake will follow)
    const initialPayload = Buffer.alloc(0);

    // Build step 3 message
    // Format: req1Hash(20) + skeyXor(20) + VC(8) + crypto_provide(4) + len(PadC)(2) + PadC + len(IA)(2) + IA
    const step3Plain = Buffer.alloc(20 + 20 + 8 + 4 + 2 + padCLength + 2 + initialPayload.length);
    let offset = 0;

    req1Hash.copy(step3Plain, offset);
    offset += 20;

    skeyXor.copy(step3Plain, offset);
    offset += 20;

    VC.copy(step3Plain, offset);
    offset += 8;

    step3Plain.writeUInt32BE(cryptoProvide, offset);
    offset += 4;

    step3Plain.writeUInt16BE(padCLength, offset);
    offset += 2;

    padC.copy(step3Plain, offset);
    offset += padCLength;

    step3Plain.writeUInt16BE(initialPayload.length, offset);
    offset += 2;

    initialPayload.copy(step3Plain, offset);

    // Derive RC4 keys for encryption
    // As initiator: we encrypt with keyA, decrypt with keyB
    const { encryptKey, decryptKey } = deriveRC4Keys(sharedSecret, infoHash);
    const encryptStream = new RC4Stream(encryptKey);

    // Encrypt the part after req1Hash + skeyXor (from VC onwards)
    const toEncrypt = step3Plain.subarray(40); // Skip the hashes
    encryptStream.process(toEncrypt);

    await socketWrite(socket, step3Plain);

    // Step 4: Receive peer's response
    // We need to find VC in the encrypted stream from peer
    // Read more data (we may already have some from step 2)
    let searchBuffer = recvBuffer;
    const moreData = await readMinBytes(socket, 512, timeout);
    searchBuffer = Buffer.concat([searchBuffer, moreData]);

    // Search for VC by decrypting from each position
    const searchStart = DH_KEY_LENGTH;
    let foundVC = false;
    let vcOffset = -1;

    for (let i = searchStart; i <= searchBuffer.length - 8; i++) {
      // Try decrypting from this position
      const tempDecrypt = new RC4Stream(decryptKey);
      const testData = Buffer.from(searchBuffer.subarray(i, i + 8));
      tempDecrypt.process(testData);

      if (testData.equals(VC)) {
        vcOffset = i;
        foundVC = true;
        break;
      }
    }

    if (!foundVC) {
      return {
        success: false,
        error: 'Could not find VC in peer response',
      };
    }

    // Decrypt the response from vcOffset
    const finalDecryptStream = new RC4Stream(decryptKey);

    // Minimum response: VC(8) + crypto_select(4) + len(PadD)(2) = 14 bytes
    const minResponseSize = 14;
    const responseEnd = vcOffset + minResponseSize;

    // Read more if needed
    if (searchBuffer.length < responseEnd) {
      const extraData = await readMinBytes(socket, responseEnd - searchBuffer.length, timeout);
      searchBuffer = Buffer.concat([searchBuffer, extraData]);
    }

    // Decrypt the response
    const encryptedResponse = Buffer.from(searchBuffer.subarray(vcOffset, vcOffset + minResponseSize));
    finalDecryptStream.process(encryptedResponse);

    // Parse response - skip VC (already verified)
    const cryptoSelect = encryptedResponse.readUInt32BE(8);
    const padDLength = encryptedResponse.readUInt16BE(12);

    // Validate crypto selection
    let selectedMethod: CryptoMethod;
    if (cryptoSelect === CryptoProvide.RC4) {
      selectedMethod = 'rc4';
    } else if (cryptoSelect === CryptoProvide.PLAINTEXT) {
      if (requireEncryption) {
        return {
          success: false,
          error: 'Peer selected plaintext but encryption is required',
        };
      }
      selectedMethod = 'plaintext';
    } else {
      return {
        success: false,
        error: `Invalid crypto selection: ${cryptoSelect}`,
      };
    }

    // Read PadD if present
    const handshakeEnd = vcOffset + minResponseSize + padDLength;
    if (searchBuffer.length < handshakeEnd) {
      const extraData = await readMinBytes(socket, handshakeEnd - searchBuffer.length, timeout);
      searchBuffer = Buffer.concat([searchBuffer, extraData]);
    }

    // Decrypt PadD (consume from stream)
    if (padDLength > 0) {
      const padD = Buffer.from(searchBuffer.subarray(vcOffset + minResponseSize, handshakeEnd));
      finalDecryptStream.process(padD);
    }

    // Calculate remainder (any data after handshake)
    const remainder = Buffer.from(searchBuffer.subarray(handshakeEnd));

    // Decrypt remainder if RC4 selected
    if (selectedMethod === 'rc4' && remainder.length > 0) {
      finalDecryptStream.process(remainder);
    }

    return {
      success: true,
      method: selectedMethod,
      encryptStream: selectedMethod === 'rc4' ? encryptStream : undefined,
      decryptStream: selectedMethod === 'rc4' ? finalDecryptStream : undefined,
      remainder,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// Exports
// =============================================================================

export default attemptEncryptedConnection;
