/**
 * MSE/PE (Message Stream Encryption / Protocol Encryption) Implementation
 *
 * Implements BitTorrent protocol encryption as used by qBittorrent, μTorrent,
 * and other modern clients. This provides:
 * - Obfuscation of BitTorrent traffic from ISP throttling
 * - Privacy from passive listeners
 *
 * The protocol uses:
 * - Diffie-Hellman key exchange (768-bit prime)
 * - RC4 stream cipher (first 1024 bytes discarded)
 * - Info hash as shared secret (SKEY)
 *
 * @see https://wiki.vuze.com/w/Message_Stream_Encryption
 * @module engine/peer/encryption
 */

import { createHash, randomBytes } from 'crypto';

// =============================================================================
// Constants
// =============================================================================

/**
 * 768-bit prime P for Diffie-Hellman key exchange
 * This is the standard prime used by all MSE/PE implementations
 */
const DH_PRIME = Buffer.from(
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
    '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
    'E485B576625E7EC6F44C42E9A63A36210000000000090563',
  'hex'
);

/** Generator G for Diffie-Hellman (G = 2) */
const DH_GENERATOR = BigInt(2);

/** Length of DH public key in bytes (768 bits = 96 bytes) */
const DH_KEY_LENGTH = 96;

/** Number of RC4 bytes to discard (security measure) */
const RC4_DISCARD_BYTES = 1024;

/** VC (Verification Constant) - 8 zero bytes */
const VC = Buffer.alloc(8, 0);

/** Crypto provide flags */
export const CryptoProvide = {
  /** Plaintext (no encryption) */
  PLAINTEXT: 0x01,
  /** RC4 encryption */
  RC4: 0x02,
} as const;

/** Crypto selection */
export type CryptoMethod = 'plaintext' | 'rc4';

// =============================================================================
// Types
// =============================================================================

/**
 * Encryption handshake result
 */
export interface EncryptionResult {
  /** Whether encryption was successfully negotiated */
  success: boolean;
  /** Selected encryption method */
  method: CryptoMethod;
  /** Encrypted stream for reading (if RC4 selected) */
  decryptStream?: RC4Stream;
  /** Encrypted stream for writing (if RC4 selected) */
  encryptStream?: RC4Stream;
  /** Any remaining data after handshake */
  remainder?: Buffer;
}

/**
 * Encryption negotiation options
 */
export interface EncryptionOptions {
  /** Info hash of the torrent (used as shared key) */
  infoHash: Buffer;
  /** Whether we prefer encryption (if true, try RC4 first) */
  preferEncryption?: boolean;
  /** Whether to require encryption (reject plaintext) */
  requireEncryption?: boolean;
  /** Whether to allow plaintext fallback */
  allowPlaintext?: boolean;
}

// =============================================================================
// RC4 Stream Cipher
// =============================================================================

/**
 * RC4 stream cipher implementation
 *
 * Used for encrypting/decrypting the BitTorrent stream after handshake.
 * The first 1024 bytes of output are discarded for security.
 */
export class RC4Stream {
  private S: Uint8Array;
  private i: number = 0;
  private j: number = 0;

  /**
   * Create a new RC4 stream with the given key
   *
   * @param key - Encryption key
   */
  constructor(key: Buffer) {
    // Initialize S-box
    this.S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      this.S[i] = i;
    }

    // Key-scheduling algorithm (KSA)
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + this.S[i] + key[i % key.length]) & 0xff;
      [this.S[i], this.S[j]] = [this.S[j], this.S[i]];
    }

    // Discard first 1024 bytes (Fluhrer, Mantin, Shamir attack mitigation)
    const discard = Buffer.alloc(RC4_DISCARD_BYTES);
    this.process(discard);
  }

  /**
   * Process (encrypt or decrypt) data in-place
   *
   * RC4 is symmetric - the same operation encrypts and decrypts.
   *
   * @param data - Data to process (modified in-place)
   * @returns The same buffer (for chaining)
   */
  process(data: Buffer): Buffer {
    for (let k = 0; k < data.length; k++) {
      this.i = (this.i + 1) & 0xff;
      this.j = (this.j + this.S[this.i]) & 0xff;
      [this.S[this.i], this.S[this.j]] = [this.S[this.j], this.S[this.i]];
      const keyByte = this.S[(this.S[this.i] + this.S[this.j]) & 0xff];
      data[k] ^= keyByte;
    }
    return data;
  }

  /**
   * Process data and return a new buffer (doesn't modify original)
   *
   * @param data - Data to process
   * @returns New buffer with processed data
   */
  processCopy(data: Buffer): Buffer {
    const copy = Buffer.from(data);
    return this.process(copy);
  }
}

// =============================================================================
// Diffie-Hellman Utilities
// =============================================================================

/**
 * Convert a buffer to a BigInt (big-endian)
 */
function bufferToBigInt(buf: Buffer): bigint {
  let result = BigInt(0);
  for (const byte of buf) {
    result = (result << BigInt(8)) + BigInt(byte);
  }
  return result;
}

/**
 * Convert a BigInt to a fixed-length buffer (big-endian)
 */
function bigIntToBuffer(num: bigint, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let temp = num;
  for (let i = length - 1; i >= 0; i--) {
    buf[i] = Number(temp & BigInt(0xff));
    temp = temp >> BigInt(8);
  }
  return buf;
}

/**
 * Modular exponentiation: (base^exp) mod mod
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BigInt(1);
  base = base % mod;
  while (exp > 0) {
    if (exp % BigInt(2) === BigInt(1)) {
      result = (result * base) % mod;
    }
    exp = exp >> BigInt(1);
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Generate a Diffie-Hellman key pair
 *
 * @returns Object with private key (Xa) and public key (Ya)
 */
export function generateDHKeyPair(): { privateKey: Buffer; publicKey: Buffer } {
  // Generate random private key (160 bits as per spec)
  const privateKey = randomBytes(20);
  const Xa = bufferToBigInt(privateKey);

  // Calculate public key: Ya = G^Xa mod P
  const P = bufferToBigInt(DH_PRIME);
  const Ya = modPow(DH_GENERATOR, Xa, P);
  const publicKey = bigIntToBuffer(Ya, DH_KEY_LENGTH);

  return { privateKey, publicKey };
}

/**
 * Compute the shared secret from DH exchange
 *
 * @param privateKey - Our private key (Xa)
 * @param remotePublicKey - Remote party's public key (Yb)
 * @returns Shared secret S
 */
export function computeDHSecret(
  privateKey: Buffer,
  remotePublicKey: Buffer
): Buffer {
  const Xa = bufferToBigInt(privateKey);
  const Yb = bufferToBigInt(remotePublicKey);
  const P = bufferToBigInt(DH_PRIME);

  // S = Yb^Xa mod P
  const S = modPow(Yb, Xa, P);
  return bigIntToBuffer(S, DH_KEY_LENGTH);
}

// =============================================================================
// Key Derivation
// =============================================================================

/**
 * Derive RC4 encryption keys from DH shared secret and info hash
 *
 * @param S - DH shared secret
 * @param SKEY - Shared key (info hash)
 * @returns Object with encryption and decryption keys
 */
export function deriveRC4Keys(
  S: Buffer,
  SKEY: Buffer
): { encryptKey: Buffer; decryptKey: Buffer } {
  // keyA = SHA1("keyA" + S + SKEY)
  const keyA = createHash('sha1')
    .update('keyA')
    .update(S)
    .update(SKEY)
    .digest();

  // keyB = SHA1("keyB" + S + SKEY)
  const keyB = createHash('sha1')
    .update('keyB')
    .update(S)
    .update(SKEY)
    .digest();

  return { encryptKey: keyA, decryptKey: keyB };
}

/**
 * Hash for synchronization: SHA1("req1" + S)
 */
export function hashSync1(S: Buffer): Buffer {
  return createHash('sha1').update('req1').update(S).digest();
}

/**
 * Hash for SKEY verification: SHA1("req2" + SKEY)
 */
export function hashSync2(SKEY: Buffer): Buffer {
  return createHash('sha1').update('req2').update(SKEY).digest();
}

/**
 * XOR hash for SKEY obfuscation: SHA1("req3" + S) XOR SKEY
 */
export function hashSync3(S: Buffer, SKEY: Buffer): Buffer {
  const hash = createHash('sha1').update('req3').update(S).digest();

  // XOR with SKEY (padded/truncated to 20 bytes)
  const result = Buffer.alloc(20);
  for (let i = 0; i < 20; i++) {
    result[i] = hash[i] ^ (SKEY[i] || 0);
  }
  return result;
}

// =============================================================================
// EncryptedConnection Class
// =============================================================================

/**
 * Wrapper for encrypted peer connections
 *
 * Handles the MSE/PE handshake and provides transparent encryption
 * for subsequent data transfers.
 */
export class EncryptedConnection {
  /** Whether encryption is active */
  private encrypted: boolean = false;

  /** RC4 stream for decrypting incoming data */
  private decryptStream?: RC4Stream;

  /** RC4 stream for encrypting outgoing data */
  private encryptStream?: RC4Stream;

  /** Selected crypto method */
  private method: CryptoMethod = 'plaintext';

  constructor() {}

  /**
   * Check if connection is using encryption
   */
  isEncrypted(): boolean {
    return this.encrypted && this.method === 'rc4';
  }

  /**
   * Get the selected crypto method
   */
  getMethod(): CryptoMethod {
    return this.method;
  }

  /**
   * Initialize encryption with the given keys
   *
   * @param encryptKey - Key for outgoing encryption
   * @param decryptKey - Key for incoming decryption
   * @param method - Crypto method to use
   */
  initialize(
    encryptKey: Buffer,
    decryptKey: Buffer,
    method: CryptoMethod
  ): void {
    this.method = method;

    if (method === 'rc4') {
      this.encryptStream = new RC4Stream(encryptKey);
      this.decryptStream = new RC4Stream(decryptKey);
      this.encrypted = true;
    }
  }

  /**
   * Encrypt outgoing data (if encryption is active)
   *
   * @param data - Data to encrypt
   * @returns Encrypted data (new buffer)
   */
  encrypt(data: Buffer): Buffer {
    if (this.encryptStream) {
      return this.encryptStream.processCopy(data);
    }
    return data;
  }

  /**
   * Decrypt incoming data (if encryption is active)
   *
   * @param data - Data to decrypt
   * @returns Decrypted data (new buffer)
   */
  decrypt(data: Buffer): Buffer {
    if (this.decryptStream) {
      return this.decryptStream.processCopy(data);
    }
    return data;
  }

  /**
   * Decrypt incoming data in-place (more efficient)
   *
   * @param data - Data to decrypt (modified in-place)
   * @returns The same buffer
   */
  decryptInPlace(data: Buffer): Buffer {
    if (this.decryptStream) {
      return this.decryptStream.process(data);
    }
    return data;
  }
}

// =============================================================================
// Handshake Utilities
// =============================================================================

/**
 * Create the initial handshake message (A -> B)
 *
 * Format: Pad(A) + Ya + Pad(B)
 *
 * @param publicKey - Our DH public key (Ya)
 * @returns Handshake message buffer
 */
export function createInitiatorHandshake(publicKey: Buffer): Buffer {
  // Random padding before public key (0-512 bytes)
  const padALength = Math.floor(Math.random() * 512);
  const padA = randomBytes(padALength);

  // Random padding after public key (0-512 bytes)
  const padBLength = Math.floor(Math.random() * 512);
  const padB = randomBytes(padBLength);

  return Buffer.concat([padA, publicKey, padB]);
}

/**
 * Build crypto_provide flags
 *
 * @param options - Encryption options
 * @returns Crypto provide flags
 */
export function buildCryptoProvide(options: EncryptionOptions): number {
  let flags = 0;

  if (options.allowPlaintext !== false) {
    flags |= CryptoProvide.PLAINTEXT;
  }

  // Always offer RC4 if we support encryption
  flags |= CryptoProvide.RC4;

  return flags;
}

/**
 * Select crypto method from provided options
 *
 * @param cryptoProvide - Flags from remote peer
 * @param options - Our encryption options
 * @returns Selected crypto method, or null if no compatible method
 */
export function selectCryptoMethod(
  cryptoProvide: number,
  options: EncryptionOptions
): CryptoMethod | null {
  // Prefer RC4 if both support it and we prefer encryption
  if (cryptoProvide & CryptoProvide.RC4 && options.preferEncryption) {
    return 'rc4';
  }

  // Fall back to RC4 if available
  if (cryptoProvide & CryptoProvide.RC4) {
    return 'rc4';
  }

  // Use plaintext if allowed
  if (cryptoProvide & CryptoProvide.PLAINTEXT && !options.requireEncryption) {
    return 'plaintext';
  }

  return null;
}

// =============================================================================
// Exports
// =============================================================================

export { DH_KEY_LENGTH, VC };

export default EncryptedConnection;
