/**
 * Piece State Tracking Module for Torm Engine
 *
 * Tracks the download state of pieces and blocks within a torrent.
 * Manages piece completion, block states, and bitfield operations.
 *
 * @module engine/piece/state
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Standard block size used in BitTorrent requests (16 KiB)
 */
export const BLOCK_SIZE = 16384;

// =============================================================================
// Enums
// =============================================================================

/**
 * State of a single block within a piece
 */
export enum BlockState {
  /** Block has not been requested yet */
  Missing = 'missing',

  /** Block request has been sent to a peer */
  Requested = 'requested',

  /** Block data has been received (pending piece verification) */
  Received = 'received',
}

// =============================================================================
// PieceState Class
// =============================================================================

/**
 * Tracks download state for a single piece
 *
 * A piece is divided into blocks (typically 16 KiB each). This class
 * tracks which blocks have been requested and received, and accumulates
 * the piece data as blocks arrive.
 *
 * @example
 * ```typescript
 * const piece = new PieceState(0, 262144); // 256 KiB piece
 * console.log(piece.blockCount); // 16 blocks
 *
 * // Request first block
 * piece.setBlockState(0, BlockState.Requested);
 *
 * // Receive block data
 * piece.writeBlock(0, blockData);
 *
 * // Check completion
 * if (piece.isComplete()) {
 *   const data = piece.getData();
 *   // Verify hash...
 * }
 * ```
 */
export class PieceState {
  /** Index of this piece within the torrent */
  public readonly pieceIndex: number;

  /** Total bytes in this piece */
  public readonly pieceLength: number;

  /** Number of blocks in this piece */
  public readonly blockCount: number;

  /** State of each block */
  public readonly blocks: BlockState[];

  /** Accumulated piece data (null until first block received) */
  public data: Buffer | null;

  /**
   * Create a new PieceState
   *
   * @param pieceIndex - Index of this piece within the torrent
   * @param pieceLength - Total bytes in this piece
   */
  constructor(pieceIndex: number, pieceLength: number) {
    if (pieceIndex < 0) {
      throw new Error(
        `Invalid piece index: ${pieceIndex} (must be non-negative)`
      );
    }
    if (pieceLength <= 0) {
      throw new Error(
        `Invalid piece length: ${pieceLength} (must be positive)`
      );
    }

    this.pieceIndex = pieceIndex;
    this.pieceLength = pieceLength;
    this.blockCount = Math.ceil(pieceLength / BLOCK_SIZE);
    this.blocks = new Array(this.blockCount).fill(BlockState.Missing);
    this.data = null;
  }

  /**
   * Get the state of a specific block
   *
   * @param blockIndex - Zero-based index of the block
   * @returns The block's current state
   * @throws Error if blockIndex is out of range
   */
  getBlockState(blockIndex: number): BlockState {
    this.validateBlockIndex(blockIndex);
    return this.blocks[blockIndex];
  }

  /**
   * Set the state of a specific block
   *
   * @param blockIndex - Zero-based index of the block
   * @param state - The new state for the block
   * @throws Error if blockIndex is out of range
   */
  setBlockState(blockIndex: number, state: BlockState): void {
    this.validateBlockIndex(blockIndex);
    this.blocks[blockIndex] = state;
  }

  /**
   * Get the byte offset of a block within the piece
   *
   * @param blockIndex - Zero-based index of the block
   * @returns Byte offset within the piece
   * @throws Error if blockIndex is out of range
   */
  getBlockOffset(blockIndex: number): number {
    this.validateBlockIndex(blockIndex);
    return blockIndex * BLOCK_SIZE;
  }

  /**
   * Get the length of a specific block
   *
   * All blocks are BLOCK_SIZE (16 KiB) except the last block,
   * which may be smaller if the piece length is not evenly divisible.
   *
   * @param blockIndex - Zero-based index of the block
   * @returns Block length in bytes
   * @throws Error if blockIndex is out of range
   */
  getBlockLength(blockIndex: number): number {
    this.validateBlockIndex(blockIndex);

    const isLastBlock = blockIndex === this.blockCount - 1;
    if (isLastBlock) {
      const remainder = this.pieceLength % BLOCK_SIZE;
      return remainder === 0 ? BLOCK_SIZE : remainder;
    }

    return BLOCK_SIZE;
  }

  /**
   * Write received block data to the piece buffer
   *
   * Allocates the piece data buffer on first write and copies
   * the block data to the correct position.
   *
   * @param blockIndex - Zero-based index of the block
   * @param data - The block data to write
   * @throws Error if blockIndex is out of range
   * @throws Error if data length doesn't match expected block length
   */
  writeBlock(blockIndex: number, data: Buffer): void {
    this.validateBlockIndex(blockIndex);

    const expectedLength = this.getBlockLength(blockIndex);
    if (data.length !== expectedLength) {
      throw new Error(
        `Invalid block data length: expected ${expectedLength}, got ${data.length}`
      );
    }

    // Allocate data buffer on first write
    if (this.data === null) {
      this.data = Buffer.alloc(this.pieceLength);
    }

    // Copy block data to correct position
    const offset = this.getBlockOffset(blockIndex);
    data.copy(this.data, offset);

    // Update block state to received
    this.blocks[blockIndex] = BlockState.Received;
  }

  /**
   * Get indices of all blocks in Missing state
   *
   * @returns Array of block indices that have not been requested
   */
  getMissingBlocks(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this.blockCount; i++) {
      if (this.blocks[i] === BlockState.Missing) {
        missing.push(i);
      }
    }
    return missing;
  }

  /**
   * Get indices of all blocks in Requested state
   *
   * @returns Array of block indices that are currently requested
   */
  getRequestedBlocks(): number[] {
    const requested: number[] = [];
    for (let i = 0; i < this.blockCount; i++) {
      if (this.blocks[i] === BlockState.Requested) {
        requested.push(i);
      }
    }
    return requested;
  }

  /**
   * Check if all blocks have been received
   *
   * @returns true if all blocks are in Received state
   */
  isComplete(): boolean {
    return this.blocks.every((state) => state === BlockState.Received);
  }

  /**
   * Get the accumulated piece data
   *
   * @returns The piece data buffer
   * @throws Error if piece is not complete
   */
  getData(): Buffer {
    if (!this.isComplete()) {
      throw new Error(
        `Piece ${this.pieceIndex} is not complete (received ${this.getReceivedCount()}/${this.blockCount} blocks)`
      );
    }

    if (this.data === null) {
      throw new Error(`Piece ${this.pieceIndex} has no data`);
    }

    return this.data;
  }

  /**
   * Reset all blocks to Missing state and clear data
   *
   * Used when piece verification fails and needs to be re-downloaded.
   */
  reset(): void {
    this.blocks.fill(BlockState.Missing);
    this.data = null;
  }

  /**
   * Get count of received blocks
   *
   * @returns Number of blocks in Received state
   */
  private getReceivedCount(): number {
    return this.blocks.filter((state) => state === BlockState.Received).length;
  }

  /**
   * Validate a block index is within range
   *
   * @param blockIndex - Block index to validate
   * @throws Error if index is out of range
   */
  private validateBlockIndex(blockIndex: number): void {
    if (blockIndex < 0 || blockIndex >= this.blockCount) {
      throw new Error(
        `Invalid block index: ${blockIndex} (valid range: 0-${this.blockCount - 1})`
      );
    }
  }
}

// =============================================================================
// TorrentPieceMap Class
// =============================================================================

/**
 * Tracks piece state for an entire torrent
 *
 * Manages a map of piece states, lazily creating them as needed.
 * Tracks which pieces are complete (verified) and provides
 * bitfield generation for the have/bitfield protocol messages.
 *
 * @example
 * ```typescript
 * const pieceMap = new TorrentPieceMap(100, 262144, 26214400);
 *
 * // Get or create piece state
 * const piece = pieceMap.getPieceState(0);
 *
 * // After downloading and verifying
 * pieceMap.markPieceComplete(0);
 *
 * // Generate bitfield for peers
 * const bitfield = pieceMap.getBitfield();
 * ```
 */
export class TorrentPieceMap {
  /** Total number of pieces in the torrent */
  public readonly pieceCount: number;

  /** Standard piece length (all pieces except possibly the last) */
  public readonly pieceLength: number;

  /** Total torrent size in bytes */
  public readonly totalLength: number;

  /** Map of piece index to PieceState (lazily created) */
  public readonly pieces: Map<number, PieceState>;

  /** Set of piece indices that have been verified complete */
  public readonly completedPieces: Set<number>;

  /**
   * Create a new TorrentPieceMap
   *
   * @param pieceCount - Total number of pieces in the torrent
   * @param pieceLength - Standard piece length (except last piece)
   * @param totalLength - Total torrent size in bytes
   */
  constructor(pieceCount: number, pieceLength: number, totalLength: number) {
    if (pieceCount <= 0) {
      throw new Error(`Invalid piece count: ${pieceCount} (must be positive)`);
    }
    if (pieceLength <= 0) {
      throw new Error(
        `Invalid piece length: ${pieceLength} (must be positive)`
      );
    }
    if (totalLength <= 0) {
      throw new Error(
        `Invalid total length: ${totalLength} (must be positive)`
      );
    }

    this.pieceCount = pieceCount;
    this.pieceLength = pieceLength;
    this.totalLength = totalLength;
    this.pieces = new Map();
    this.completedPieces = new Set();
  }

  /**
   * Get or create PieceState for a piece
   *
   * Lazily creates a PieceState if one doesn't exist for the given index.
   *
   * @param pieceIndex - Index of the piece
   * @returns The PieceState for the piece
   * @throws Error if pieceIndex is out of range
   */
  getPieceState(pieceIndex: number): PieceState {
    this.validatePieceIndex(pieceIndex);

    // Check if already completed
    if (this.completedPieces.has(pieceIndex)) {
      throw new Error(`Piece ${pieceIndex} is already complete`);
    }

    // Get existing or create new
    let pieceState = this.pieces.get(pieceIndex);
    if (!pieceState) {
      const length = this.getPieceLength(pieceIndex);
      pieceState = new PieceState(pieceIndex, length);
      this.pieces.set(pieceIndex, pieceState);
    }

    return pieceState;
  }

  /**
   * Get the actual length of a specific piece
   *
   * All pieces have the standard piece length except the last piece,
   * which may be smaller.
   *
   * @param pieceIndex - Index of the piece
   * @returns Piece length in bytes
   * @throws Error if pieceIndex is out of range
   */
  getPieceLength(pieceIndex: number): number {
    this.validatePieceIndex(pieceIndex);

    const isLastPiece = pieceIndex === this.pieceCount - 1;
    if (isLastPiece) {
      const remainder = this.totalLength % this.pieceLength;
      return remainder === 0 ? this.pieceLength : remainder;
    }

    return this.pieceLength;
  }

  /**
   * Mark a piece as complete (verified)
   *
   * Adds the piece to completedPieces and removes it from the
   * pieces map (no longer needed in memory).
   *
   * @param pieceIndex - Index of the piece
   * @throws Error if pieceIndex is out of range
   */
  markPieceComplete(pieceIndex: number): void {
    this.validatePieceIndex(pieceIndex);

    this.completedPieces.add(pieceIndex);
    this.pieces.delete(pieceIndex);
  }

  /**
   * Mark a piece as failed (verification failed)
   *
   * Resets the piece state so it can be re-downloaded.
   *
   * @param pieceIndex - Index of the piece
   * @throws Error if pieceIndex is out of range
   */
  markPieceFailed(pieceIndex: number): void {
    this.validatePieceIndex(pieceIndex);

    const pieceState = this.pieces.get(pieceIndex);
    if (pieceState) {
      pieceState.reset();
    }
  }

  /**
   * Check if we have a complete verified piece
   *
   * @param pieceIndex - Index of the piece
   * @returns true if piece is in completedPieces
   */
  hasPiece(pieceIndex: number): boolean {
    if (pieceIndex < 0 || pieceIndex >= this.pieceCount) {
      return false;
    }
    return this.completedPieces.has(pieceIndex);
  }

  /**
   * Get the number of completed pieces
   *
   * @returns Number of pieces in completedPieces
   */
  getCompletedCount(): number {
    return this.completedPieces.size;
  }

  /**
   * Get download progress as a ratio
   *
   * @returns Ratio of completed pieces (0-1)
   */
  getProgress(): number {
    return this.completedPieces.size / this.pieceCount;
  }

  /**
   * Generate bitfield buffer for completed pieces
   *
   * Creates a bitfield where each bit represents a piece.
   * Bit is set (1) if piece is complete, clear (0) otherwise.
   * High bit of first byte represents piece 0.
   *
   * @returns Bitfield buffer
   */
  getBitfield(): Buffer {
    const bitfield = allocateBitfield(this.pieceCount);

    for (const pieceIndex of this.completedPieces) {
      setBit(bitfield, pieceIndex);
    }

    return bitfield;
  }

  /**
   * Get indices of pieces that are in progress
   *
   * A piece is in progress if it has a PieceState (at least one
   * block has been requested or received).
   *
   * @returns Array of piece indices that are in progress
   */
  getInProgressPieces(): number[] {
    return Array.from(this.pieces.keys());
  }

  /**
   * Validate a piece index is within range
   *
   * @param pieceIndex - Piece index to validate
   * @throws Error if index is out of range
   */
  private validatePieceIndex(pieceIndex: number): void {
    if (pieceIndex < 0 || pieceIndex >= this.pieceCount) {
      throw new Error(
        `Invalid piece index: ${pieceIndex} (valid range: 0-${this.pieceCount - 1})`
      );
    }
  }
}

// =============================================================================
// Bitfield Utilities
// =============================================================================

/**
 * Allocate an empty bitfield buffer for a given number of pieces
 *
 * @param pieceCount - Total number of pieces
 * @returns Zero-filled buffer with enough bytes for all pieces
 *
 * @example
 * ```typescript
 * const bitfield = allocateBitfield(100); // 13 bytes (100/8 = 12.5, rounded up)
 * ```
 */
export function allocateBitfield(pieceCount: number): Buffer {
  if (pieceCount < 0) {
    throw new Error(
      `Invalid piece count: ${pieceCount} (must be non-negative)`
    );
  }
  if (pieceCount === 0) {
    return Buffer.alloc(0);
  }
  const byteCount = Math.ceil(pieceCount / 8);
  return Buffer.alloc(byteCount);
}

/**
 * Check if a bit is set in a bitfield
 *
 * @param bitfield - The bitfield buffer to check
 * @param index - Zero-based index of the bit
 * @returns true if the bit is set, false otherwise
 *
 * @example
 * ```typescript
 * if (hasBit(peerBitfield, pieceIndex)) {
 *   console.log('Peer has piece:', pieceIndex);
 * }
 * ```
 */
export function hasBit(bitfield: Buffer, index: number): boolean {
  if (index < 0) {
    return false;
  }

  const byteIndex = Math.floor(index / 8);
  if (byteIndex >= bitfield.length) {
    return false;
  }

  const bitIndex = 7 - (index % 8); // High bit first
  return (bitfield[byteIndex] & (1 << bitIndex)) !== 0;
}

/**
 * Set a bit in a bitfield
 *
 * @param bitfield - The bitfield buffer to modify
 * @param index - Zero-based index of the bit to set
 *
 * @example
 * ```typescript
 * const bitfield = allocateBitfield(100);
 * setBit(bitfield, 0);  // Mark piece 0 as having
 * setBit(bitfield, 42); // Mark piece 42 as having
 * ```
 */
export function setBit(bitfield: Buffer, index: number): void {
  if (index < 0) {
    throw new Error(`Invalid bit index: ${index} (must be non-negative)`);
  }

  const byteIndex = Math.floor(index / 8);
  if (byteIndex >= bitfield.length) {
    throw new Error(
      `Bit index ${index} out of range for bitfield of ${bitfield.length * 8} bits`
    );
  }

  const bitIndex = 7 - (index % 8); // High bit first
  bitfield[byteIndex] |= 1 << bitIndex;
}

/**
 * Clear a bit in a bitfield
 *
 * @param bitfield - The bitfield buffer to modify
 * @param index - Zero-based index of the bit to clear
 */
export function clearBit(bitfield: Buffer, index: number): void {
  if (index < 0) {
    throw new Error(`Invalid bit index: ${index} (must be non-negative)`);
  }

  const byteIndex = Math.floor(index / 8);
  if (byteIndex >= bitfield.length) {
    throw new Error(
      `Bit index ${index} out of range for bitfield of ${bitfield.length * 8} bits`
    );
  }

  const bitIndex = 7 - (index % 8); // High bit first
  bitfield[byteIndex] &= ~(1 << bitIndex);
}

/**
 * Count the number of set bits in a bitfield
 *
 * @param bitfield - The bitfield buffer to count
 * @returns Number of bits set (pieces available)
 *
 * @example
 * ```typescript
 * const peerPieces = countBits(peerBitfield);
 * console.log(`Peer has ${peerPieces} pieces`);
 * ```
 */
export function countBits(bitfield: Buffer): number {
  let count = 0;
  for (let i = 0; i < bitfield.length; i++) {
    // Brian Kernighan's algorithm for counting set bits
    let byte = bitfield[i];
    while (byte) {
      count++;
      byte &= byte - 1;
    }
  }
  return count;
}
