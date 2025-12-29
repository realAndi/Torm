/**
 * Piece Verification Module for Torm BitTorrent Client
 *
 * Provides SHA-1 hash verification for completed pieces against expected
 * hashes from torrent metadata. Implements both synchronous and asynchronous
 * verification methods for flexibility in different usage scenarios.
 *
 * @module engine/piece/verifier
 */

import { createHash } from 'crypto';
import { TypedEventEmitter } from '../events.js';

// =============================================================================
// Constants
// =============================================================================

/** Size of a SHA-1 hash in bytes */
const SHA1_HASH_SIZE = 20;

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a piece verification operation.
 *
 * Contains the verification outcome along with both expected and actual
 * hashes for debugging failed verifications.
 */
export interface VerificationResult {
  /** Zero-based index of the verified piece */
  pieceIndex: number;

  /** Whether the piece data matches the expected hash */
  valid: boolean;

  /** The expected SHA-1 hash from torrent metadata */
  expectedHash: Buffer;

  /** The computed SHA-1 hash of the piece data */
  actualHash: Buffer;
}

/**
 * Event map for piece verifier events.
 *
 * Emitted during verification operations to notify listeners of results.
 */
export interface PieceVerifierEvents {
  /** Emitted when a piece is successfully verified */
  verified: { pieceIndex: number };

  /** Emitted when a piece fails verification */
  failed: {
    pieceIndex: number;
    expectedHash: Buffer;
    actualHash: Buffer;
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Computes the SHA-1 hash of the provided data.
 *
 * Uses Node.js crypto module for efficient hash computation.
 *
 * @param data - The buffer to hash
 * @returns 20-byte SHA-1 hash
 *
 * @example
 * ```typescript
 * const hash = computeSha1(Buffer.from('hello'));
 * console.log(hash.toString('hex'));
 * // aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
 * ```
 */
export function computeSha1(data: Buffer): Buffer {
  return createHash('sha1').update(data).digest();
}

/**
 * Asynchronously verifies a piece against its expected hash.
 *
 * This function yields to the event loop between hash computation
 * and comparison, preventing blocking on large pieces.
 *
 * @param pieceIndex - Zero-based index of the piece
 * @param data - The piece data to verify
 * @param expectedHash - The expected 20-byte SHA-1 hash
 * @returns Promise resolving to the verification result
 *
 * @example
 * ```typescript
 * const result = await verifyPieceAsync(0, pieceData, expectedHash);
 * if (result.valid) {
 *   console.log('Piece verified successfully');
 * }
 * ```
 */
export async function verifyPieceAsync(
  pieceIndex: number,
  data: Buffer,
  expectedHash: Buffer
): Promise<VerificationResult> {
  // Yield to the event loop to prevent blocking
  await new Promise<void>((resolve) => setImmediate(resolve));

  const actualHash = computeSha1(data);
  const valid = actualHash.equals(expectedHash);

  return {
    pieceIndex,
    valid,
    expectedHash: Buffer.from(expectedHash),
    actualHash,
  };
}

/**
 * Verifies multiple pieces against their expected hashes.
 *
 * Processes pieces sequentially, yielding to the event loop between each
 * piece to prevent blocking. Returns results for all pieces.
 *
 * @param pieces - Array of pieces to verify, each with pieceIndex and data
 * @param pieceHashes - Concatenated 20-byte SHA-1 hashes for all pieces
 * @returns Promise resolving to array of verification results
 *
 * @throws {Error} If any piece index is out of bounds
 *
 * @example
 * ```typescript
 * const results = await verifyPieces(
 *   [{ pieceIndex: 0, data: piece0 }, { pieceIndex: 1, data: piece1 }],
 *   pieceHashes
 * );
 * const allValid = results.every(r => r.valid);
 * ```
 */
export async function verifyPieces(
  pieces: Array<{ pieceIndex: number; data: Buffer }>,
  pieceHashes: Buffer
): Promise<VerificationResult[]> {
  const pieceCount = pieceHashes.length / SHA1_HASH_SIZE;

  // Validate piece hashes length
  if (pieceHashes.length % SHA1_HASH_SIZE !== 0) {
    throw new Error(
      `Invalid pieceHashes length: ${pieceHashes.length} is not a multiple of ${SHA1_HASH_SIZE}`
    );
  }

  const results: VerificationResult[] = [];

  for (const { pieceIndex, data } of pieces) {
    // Validate piece index
    if (pieceIndex < 0 || pieceIndex >= pieceCount) {
      throw new Error(
        `Piece index ${pieceIndex} out of bounds (0-${pieceCount - 1})`
      );
    }

    const hashOffset = pieceIndex * SHA1_HASH_SIZE;
    const expectedHash = pieceHashes.subarray(
      hashOffset,
      hashOffset + SHA1_HASH_SIZE
    );

    const result = await verifyPieceAsync(pieceIndex, data, expectedHash);
    results.push(result);
  }

  return results;
}

// =============================================================================
// PieceVerifier Class
// =============================================================================

/**
 * Piece verifier for BitTorrent torrents.
 *
 * Verifies completed pieces against their expected SHA-1 hashes from
 * torrent metadata. Extends TypedEventEmitter to provide events for
 * verification results.
 *
 * @example
 * ```typescript
 * // Create verifier with piece hashes from torrent metadata
 * const verifier = new PieceVerifier(torrentInfo.pieces);
 *
 * // Listen for verification events
 * verifier.on('verified', ({ pieceIndex }) => {
 *   console.log(`Piece ${pieceIndex} verified`);
 * });
 *
 * verifier.on('failed', ({ pieceIndex, expectedHash, actualHash }) => {
 *   console.log(`Piece ${pieceIndex} failed verification`);
 * });
 *
 * // Verify a piece with event emission
 * const valid = verifier.verifyAndEmit(pieceIndex, pieceData);
 * ```
 */
export class PieceVerifier extends TypedEventEmitter<PieceVerifierEvents> {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** Concatenated 20-byte SHA-1 hashes for all pieces */
  private readonly _pieceHashes: Buffer;

  /** Total number of pieces in the torrent */
  private readonly _pieceCount: number;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Creates a new PieceVerifier instance.
   *
   * @param pieceHashes - Concatenated 20-byte SHA-1 hashes for all pieces
   * @throws {Error} If pieceHashes length is not a multiple of 20
   *
   * @example
   * ```typescript
   * // pieceHashes from torrent info dictionary 'pieces' field
   * const verifier = new PieceVerifier(torrentInfo.pieces);
   * console.log(`Torrent has ${verifier.pieceCount} pieces`);
   * ```
   */
  constructor(pieceHashes: Buffer) {
    super();

    if (pieceHashes.length % SHA1_HASH_SIZE !== 0) {
      throw new Error(
        `Invalid pieceHashes length: ${pieceHashes.length} is not a multiple of ${SHA1_HASH_SIZE}`
      );
    }

    this._pieceHashes = Buffer.from(pieceHashes);
    this._pieceCount = pieceHashes.length / SHA1_HASH_SIZE;
  }

  // ===========================================================================
  // Public Properties
  // ===========================================================================

  /**
   * Total number of pieces in the torrent.
   *
   * Derived from the pieceHashes buffer length.
   */
  get pieceCount(): number {
    return this._pieceCount;
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Verifies a piece against its expected SHA-1 hash.
   *
   * Computes the SHA-1 hash of the provided data and compares it to
   * the expected hash for the given piece index.
   *
   * @param pieceIndex - Zero-based index of the piece to verify
   * @param data - The piece data to verify
   * @returns true if the piece is valid, false otherwise
   * @throws {Error} If pieceIndex is out of bounds
   *
   * @example
   * ```typescript
   * if (verifier.verify(0, pieceData)) {
   *   console.log('Piece 0 is valid');
   * } else {
   *   console.log('Piece 0 is corrupted');
   * }
   * ```
   */
  verify(pieceIndex: number, data: Buffer): boolean {
    this.validatePieceIndex(pieceIndex);

    const expectedHash = this.getExpectedHash(pieceIndex);
    const actualHash = computeSha1(data);

    return actualHash.equals(expectedHash);
  }

  /**
   * Returns the expected 20-byte SHA-1 hash for a piece.
   *
   * @param pieceIndex - Zero-based index of the piece
   * @returns The 20-byte expected hash
   * @throws {Error} If pieceIndex is out of bounds
   *
   * @example
   * ```typescript
   * const hash = verifier.getExpectedHash(0);
   * console.log(`Expected hash: ${hash.toString('hex')}`);
   * ```
   */
  getExpectedHash(pieceIndex: number): Buffer {
    this.validatePieceIndex(pieceIndex);

    const hashOffset = pieceIndex * SHA1_HASH_SIZE;
    return Buffer.from(
      this._pieceHashes.subarray(hashOffset, hashOffset + SHA1_HASH_SIZE)
    );
  }

  /**
   * Verifies a piece and emits the appropriate event.
   *
   * Emits 'verified' event on success, 'failed' event on failure.
   * The events include relevant information for handling the result.
   *
   * @param pieceIndex - Zero-based index of the piece to verify
   * @param data - The piece data to verify
   * @returns true if the piece is valid, false otherwise
   * @throws {Error} If pieceIndex is out of bounds
   *
   * @example
   * ```typescript
   * verifier.on('verified', ({ pieceIndex }) => {
   *   markPieceComplete(pieceIndex);
   * });
   *
   * verifier.on('failed', ({ pieceIndex }) => {
   *   redownloadPiece(pieceIndex);
   * });
   *
   * verifier.verifyAndEmit(0, pieceData);
   * ```
   */
  verifyAndEmit(pieceIndex: number, data: Buffer): boolean {
    this.validatePieceIndex(pieceIndex);

    const expectedHash = this.getExpectedHash(pieceIndex);
    const actualHash = computeSha1(data);
    const valid = actualHash.equals(expectedHash);

    if (valid) {
      this.emit('verified', { pieceIndex });
    } else {
      this.emit('failed', {
        pieceIndex,
        expectedHash,
        actualHash,
      });
    }

    return valid;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Validates that a piece index is within bounds.
   *
   * @param pieceIndex - The piece index to validate
   * @throws {Error} If pieceIndex is out of bounds
   */
  private validatePieceIndex(pieceIndex: number): void {
    if (!Number.isInteger(pieceIndex)) {
      throw new Error(`Piece index must be an integer: ${pieceIndex}`);
    }

    if (pieceIndex < 0 || pieceIndex >= this._pieceCount) {
      throw new Error(
        `Piece index ${pieceIndex} out of bounds (0-${this._pieceCount - 1})`
      );
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

export { SHA1_HASH_SIZE };
