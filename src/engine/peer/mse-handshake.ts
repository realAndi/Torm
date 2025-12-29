/**
 * MSE/PE Handshake Implementation
 *
 * Implements the complete MSE/PE (Message Stream Encryption / Protocol Encryption)
 * handshake flow for establishing encrypted peer connections.
 *
 * The handshake flow:
 * 1. A -> B: Ya (DH public key) + PadA
 * 2. B -> A: Yb (DH public key) + PadB
 * 3. A -> B: HASH('req1' + S) + HASH('req2' + SKEY) XOR HASH('req3' + S) + VC + crypto_provide + len(PadC) + PadC + len(IA) + IA
 * 4. B -> A: VC + crypto_select + len(PadD) + PadD
 *
 * After the handshake, both sides have RC4 encryption streams set up.
 *
 * @see https://wiki.vuze.com/w/Message_Stream_Encryption
 * @module engine/peer/mse-handshake
 */

import { randomBytes } from 'crypto';
import type { Socket } from 'net';
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
  type EncryptionOptions,
} from './encryption.js';

// =============================================================================
// Constants
// =============================================================================

/** Maximum padding length for DH key exchange */
const MAX_PAD_LENGTH = 512;

/** Timeout for reading from socket in milliseconds (reduced from 10s to 5s) */
const READ_TIMEOUT = 5000;

/** Maximum buffer size to prevent memory exhaustion attacks */
const MAX_BUFFER_SIZE = 65536;

/** BitTorrent protocol handshake first byte (0x13 = 19 = length of "BitTorrent protocol") */
const BITTORRENT_PROTOCOL_BYTE = 0x13;

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a successful MSE handshake
 */
export interface MSEHandshakeResult {
  /** Whether the handshake succeeded */
  success: true;
  /** Selected encryption method */
  method: CryptoMethod;
  /** RC4 stream for encrypting outgoing data (if RC4 selected) */
  encryptStream?: RC4Stream;
  /** RC4 stream for decrypting incoming data (if RC4 selected) */
  decryptStream?: RC4Stream;
  /** Any remaining data in the buffer after handshake */
  remainder: Buffer;
}

/**
 * Result of a failed MSE handshake
 */
export interface MSEHandshakeFailure {
  /** Whether the handshake succeeded */
  success: false;
  /** Error message */
  error: string;
}

export type MSEResult = MSEHandshakeResult | MSEHandshakeFailure;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Read exactly n bytes from a socket with timeout
 */
async function readExact(
  socket: Socket,
  buffer: Buffer,
  offset: number,
  length: number,
  timeout: number
): Promise<{ buffer: Buffer; bytesRead: number }> {
  return new Promise((resolve, reject) => {
    let currentBuffer = buffer;
    let totalRead = 0;
    let timeoutId: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    const onData = (data: Buffer) => {
      // Append to buffer
      if (offset + totalRead + data.length > currentBuffer.length) {
        // Need to grow buffer
        const newBuffer = Buffer.alloc(Math.max(currentBuffer.length * 2, offset + totalRead + data.length));
        currentBuffer.copy(newBuffer);
        currentBuffer = newBuffer;
      }
      data.copy(currentBuffer, offset + totalRead);
      totalRead += data.length;

      if (totalRead >= length) {
        cleanup();
        resolve({ buffer: currentBuffer, bytesRead: totalRead });
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
      reject(new Error('Timeout during MSE handshake'));
    }, timeout);

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

/**
 * Read until a pattern is found in the buffer
 */
async function readUntilPattern(
  socket: Socket,
  buffer: Buffer,
  offset: number,
  pattern: Buffer,
  maxLength: number,
  timeout: number
): Promise<{ buffer: Buffer; patternOffset: number; totalRead: number }> {
  return new Promise((resolve, reject) => {
    let currentBuffer = buffer;
    let totalRead = 0;
    let timeoutId: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    const checkPattern = (): number => {
      // Search for pattern in the buffer
      for (let i = offset; i <= offset + totalRead - pattern.length; i++) {
        let found = true;
        for (let j = 0; j < pattern.length; j++) {
          if (currentBuffer[i + j] !== pattern[j]) {
            found = false;
            break;
          }
        }
        if (found) {
          return i;
        }
      }
      return -1;
    };

    const onData = (data: Buffer) => {
      // Check buffer size limit
      if (offset + totalRead + data.length > maxLength) {
        cleanup();
        reject(new Error('MSE handshake buffer overflow'));
        return;
      }

      // Grow buffer if needed
      if (offset + totalRead + data.length > currentBuffer.length) {
        const newSize = Math.min(Math.max(currentBuffer.length * 2, offset + totalRead + data.length), maxLength);
        const newBuffer = Buffer.alloc(newSize);
        currentBuffer.copy(newBuffer);
        currentBuffer = newBuffer;
      }

      data.copy(currentBuffer, offset + totalRead);
      totalRead += data.length;

      const patternPos = checkPattern();
      if (patternPos >= 0) {
        cleanup();
        resolve({ buffer: currentBuffer, patternOffset: patternPos, totalRead });
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

    // Check if pattern already exists in buffer
    const existingPatternPos = checkPattern();
    if (existingPatternPos >= 0) {
      resolve({ buffer: currentBuffer, patternOffset: existingPatternPos, totalRead });
      return;
    }

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting for MSE pattern'));
    }, timeout);

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

/**
 * Write data to socket with promise wrapper
 */
function socketWrite(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// =============================================================================
// MSE Handshake (Initiator/Client Side)
// =============================================================================

/**
 * Perform MSE handshake as the initiator (client connecting to peer)
 *
 * @param socket - Raw TCP socket (must be connected)
 * @param infoHash - 20-byte info hash of the torrent
 * @param options - Encryption options
 * @returns Handshake result with encryption streams if successful
 */
export async function performMSEHandshake(
  socket: Socket,
  infoHash: Buffer,
  options: EncryptionOptions
): Promise<MSEResult> {
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
    let recvBuffer: Buffer = Buffer.alloc(MAX_BUFFER_SIZE);
    const { buffer: dhBuffer, bytesRead: dhBytesRead } = await readExact(
      socket,
      recvBuffer,
      0,
      DH_KEY_LENGTH,
      READ_TIMEOUT
    );
    recvBuffer = dhBuffer;

    // Early plaintext detection: If first byte is 0x13, peer sent BitTorrent handshake
    // instead of MSE DH key. This means peer doesn't support encryption.
    if (recvBuffer[0] === BITTORRENT_PROTOCOL_BYTE) {
      return {
        success: false,
        error: 'Peer sent plaintext BitTorrent handshake (no MSE support)',
      };
    }

    // Extract peer's public key
    const peerPublicKey = Buffer.from(recvBuffer.subarray(0, DH_KEY_LENGTH));

    // Compute shared secret
    const sharedSecret = computeDHSecret(privateKey, peerPublicKey);

    // Step 3: Send our crypto request
    // HASH('req1' + S) + HASH('req2' + SKEY) XOR HASH('req3' + S) + VC + crypto_provide + len(PadC) + PadC

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
    if (options.allowPlaintext !== false && !options.requireEncryption) {
      cryptoProvide |= CryptoProvide.PLAINTEXT;
    }

    // Random padding for step 3
    const padCLength = Math.floor(Math.random() * MAX_PAD_LENGTH);
    const padC = randomBytes(padCLength);

    // Get the initial payload (IA) - this is empty for now, BitTorrent handshake will follow
    const initialPayload = Buffer.alloc(0);

    // Build step 3 message (before encryption starts)
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
    const decryptStream = new RC4Stream(decryptKey);

    // Encrypt the part after req1Hash + skeyXor (from VC onwards)
    const toEncrypt = step3Plain.subarray(40); // Skip the hashes
    encryptStream.process(toEncrypt);

    await socketWrite(socket, step3Plain);

    // Step 4: Receive peer's response
    // We need to find VC in the encrypted stream from peer
    // Peer sends: VC(8) + crypto_select(4) + len(PadD)(2) + PadD

    // Read more data to find VC (it's encrypted, so we need to decrypt and search)
    // The peer's VC will appear after their random padding from step 2

    // We may have extra data from step 2 (padding after Yb)
    const searchStart = DH_KEY_LENGTH;
    let searchBuffer: Buffer = recvBuffer;
    let totalReceived = dhBytesRead;

    // Keep reading until we find the encrypted VC
    // VC after encryption should be found by decrypting chunks and looking for 8 zero bytes
    let foundVC = false;
    let vcOffset = -1;

    // Read more data
    const { buffer: moreBuffer, bytesRead: moreBytesRead } = await readExact(
      socket,
      searchBuffer,
      totalReceived,
      512, // Read at least 512 more bytes
      READ_TIMEOUT
    );
    searchBuffer = moreBuffer;
    totalReceived += moreBytesRead;

    // The response from peer is encrypted starting from VC
    // We need to find where their encrypted data starts by looking for the pattern
    // that decrypts to VC (8 zero bytes)

    // Create a temporary decryption stream for searching
    const tempDecryptKey = Buffer.from(decryptKey);

    for (let i = searchStart; i <= totalReceived - 8; i++) {
      // Try decrypting from this position
      const tempDecrypt = new RC4Stream(tempDecryptKey);
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

    // Now decrypt the response from vcOffset
    // Re-create the decrypt stream to start fresh
    const finalDecryptStream = new RC4Stream(decryptKey);

    // Decrypt from vcOffset: VC(8) + crypto_select(4) + len(PadD)(2) = 14 bytes minimum
    const minResponseSize = 14;
    if (totalReceived - vcOffset < minResponseSize) {
      // Read more
      const { buffer: respBuffer, bytesRead: respBytes } = await readExact(
        socket,
        searchBuffer,
        totalReceived,
        minResponseSize - (totalReceived - vcOffset),
        READ_TIMEOUT
      );
      searchBuffer = respBuffer;
      totalReceived += respBytes;
    }

    // Decrypt the response
    const encryptedResponse = Buffer.from(searchBuffer.subarray(vcOffset, vcOffset + minResponseSize));
    finalDecryptStream.process(encryptedResponse);

    // Parse response
    // Skip VC (already verified)
    const cryptoSelect = encryptedResponse.readUInt32BE(8);
    const padDLength = encryptedResponse.readUInt16BE(12);

    // Validate crypto selection
    let selectedMethod: CryptoMethod;
    if (cryptoSelect === CryptoProvide.RC4) {
      selectedMethod = 'rc4';
    } else if (cryptoSelect === CryptoProvide.PLAINTEXT) {
      if (options.requireEncryption) {
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
    if (padDLength > 0) {
      const padDEnd = vcOffset + minResponseSize + padDLength;
      if (totalReceived < padDEnd) {
        const { buffer: padBuffer, bytesRead: padBytes } = await readExact(
          socket,
          searchBuffer,
          totalReceived,
          padDEnd - totalReceived,
          READ_TIMEOUT
        );
        searchBuffer = padBuffer;
        totalReceived += padBytes;
      }
      // Decrypt PadD (we need to consume it from the stream)
      const padD = Buffer.from(searchBuffer.subarray(vcOffset + minResponseSize, vcOffset + minResponseSize + padDLength));
      finalDecryptStream.process(padD);
    }

    // Calculate remainder (any data after the handshake)
    const handshakeEnd = vcOffset + minResponseSize + padDLength;
    const remainder = Buffer.from(searchBuffer.subarray(handshakeEnd, totalReceived));

    // If RC4 selected, decrypt the remainder
    if (selectedMethod === 'rc4' && remainder.length > 0) {
      finalDecryptStream.process(remainder);
    }

    // For the encrypt stream, we already used it for step 3, so it's positioned correctly
    // For the decrypt stream, we need to use finalDecryptStream which is positioned after PadD

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

/**
 * Check if a connection appears to be using MSE
 *
 * This checks if the first bytes look like an MSE handshake rather than
 * a standard BitTorrent handshake.
 *
 * @param firstByte - First byte received from peer
 * @returns true if this looks like MSE
 */
export function looksLikeMSE(firstByte: number): boolean {
  // Standard BitTorrent handshake starts with 0x13 (19, the length of "BitTorrent protocol")
  // MSE starts with random data (the DH public key)
  // If the first byte is not 0x13, it might be MSE
  return firstByte !== 0x13;
}

// =============================================================================
// Exports
// =============================================================================

export default {
  performMSEHandshake,
  looksLikeMSE,
};
