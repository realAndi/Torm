/**
 * Piece Selection Strategies for BitTorrent Downloads
 *
 * Implements various piece selection algorithms used by BitTorrent clients
 * to determine which pieces to download next. The main strategies are:
 *
 * - **Rarest First**: Download pieces that fewest peers have (default)
 * - **Sequential**: Download pieces in order (for streaming/preview)
 * - **Random**: Random selection (used for initial pieces to avoid thundering herd)
 *
 * The module also provides availability tracking to monitor which peers
 * have which pieces, enabling intelligent piece selection decisions.
 *
 * @module engine/piece/selector
 */

import { hasBit, countBits, allocateBitfield, setBit } from './state.js';

// =============================================================================
// Enums
// =============================================================================

/**
 * Piece selection strategies for downloading.
 *
 * Different strategies optimize for different use cases:
 * - RarestFirst: Maximizes piece availability in the swarm
 * - Sequential: Enables streaming and preview functionality
 * - Random: Prevents all clients from requesting the same pieces initially
 */
export enum SelectionStrategy {
  /** Prefer pieces that fewest peers have (default strategy) */
  RarestFirst = 'rarest-first',

  /** Download pieces in sequential order (for streaming) */
  Sequential = 'sequential',

  /** Select pieces randomly (for initial piece distribution) */
  Random = 'random',
}

// =============================================================================
// Piece Availability Tracking
// =============================================================================

/**
 * Tracks piece availability across all connected peers.
 *
 * This class maintains a count of how many peers have each piece,
 * allowing the piece selector to make intelligent decisions about
 * which pieces to prioritize.
 *
 * @example
 * ```typescript
 * const availability = new PieceAvailability(100);
 *
 * // Register a peer with their bitfield
 * availability.addPeer('peer-1', peerBitfield);
 *
 * // Check how rare a piece is
 * const count = availability.getAvailability(42);
 * console.log(`Piece 42 is available from ${count} peers`);
 *
 * // Get the rarest pieces (excluding ones we already have)
 * const rarest = availability.getRarestPieces(ownedPieces);
 * ```
 */
export class PieceAvailability {
  /** Total number of pieces in the torrent */
  public readonly pieceCount: number;

  /** Count of peers that have each piece (indexed by piece index) */
  public readonly availability: number[];

  /** Map of peer ID to their bitfield */
  public readonly peerBitfields: Map<string, Buffer>;

  /** Cached sorted piece indices by rarity (invalidated on changes) */
  private cachedRanking: number[] | null = null;

  /** Set of pieces to exclude from ranking (owned/in-progress) */
  private lastExcludeSet: Set<number> | null = null;

  /**
   * Create a new piece availability tracker.
   *
   * @param pieceCount - Total number of pieces in the torrent
   */
  constructor(pieceCount: number) {
    this.pieceCount = pieceCount;
    this.availability = new Array(pieceCount).fill(0);
    this.peerBitfields = new Map();
  }

  /**
   * Invalidate the cached ranking (called when availability changes)
   */
  private invalidateCache(): void {
    this.cachedRanking = null;
    this.lastExcludeSet = null;
  }

  /**
   * Register a new peer with their piece bitfield.
   *
   * Adds the peer to tracking and increments availability counts
   * for all pieces the peer has.
   *
   * @param peerId - Unique identifier for the peer
   * @param bitfield - The peer's bitfield indicating which pieces they have
   *
   * @example
   * ```typescript
   * availability.addPeer('peer-abc', peerBitfield);
   * ```
   */
  addPeer(peerId: string, bitfield: Buffer): void {
    // If peer already exists, remove them first to update counts correctly
    if (this.peerBitfields.has(peerId)) {
      this.removePeer(peerId);
    }

    // Store a copy of the bitfield
    const bitfieldCopy = Buffer.from(bitfield);
    this.peerBitfields.set(peerId, bitfieldCopy);

    // Increment availability for each piece the peer has
    for (let i = 0; i < this.pieceCount; i++) {
      if (hasBit(bitfieldCopy, i)) {
        this.availability[i]++;
      }
    }

    // Invalidate cache since availability changed
    this.invalidateCache();
  }

  /**
   * Remove a peer from tracking.
   *
   * Decrements availability counts for all pieces the peer had.
   *
   * @param peerId - Unique identifier for the peer to remove
   *
   * @example
   * ```typescript
   * availability.removePeer('peer-abc');
   * ```
   */
  removePeer(peerId: string): void {
    const bitfield = this.peerBitfields.get(peerId);
    if (!bitfield) {
      return;
    }

    // Decrement availability for each piece the peer had
    for (let i = 0; i < this.pieceCount; i++) {
      if (hasBit(bitfield, i)) {
        this.availability[i]--;
      }
    }

    this.peerBitfields.delete(peerId);

    // Invalidate cache since availability changed
    this.invalidateCache();
  }

  /**
   * Update availability when a peer announces they have a new piece.
   *
   * Called when receiving a HAVE message from a peer.
   *
   * @param peerId - Unique identifier for the peer
   * @param pieceIndex - Index of the piece the peer now has
   *
   * @example
   * ```typescript
   * // Peer announced they have piece 42
   * availability.updatePeerHave('peer-abc', 42);
   * ```
   */
  updatePeerHave(peerId: string, pieceIndex: number): void {
    const bitfield = this.peerBitfields.get(peerId);
    if (!bitfield) {
      // Peer not tracked yet - create a new bitfield for them
      const newBitfield = allocateBitfield(this.pieceCount);
      setBit(newBitfield, pieceIndex);
      this.peerBitfields.set(peerId, newBitfield);
      this.availability[pieceIndex]++;
      // Invalidate cache since availability changed
      this.invalidateCache();
      return;
    }

    // Only increment if they didn't already have this piece
    if (!hasBit(bitfield, pieceIndex)) {
      setBit(bitfield, pieceIndex);
      this.availability[pieceIndex]++;
      // Invalidate cache since availability changed
      this.invalidateCache();
    }
  }

  /**
   * Get the number of peers that have a specific piece.
   *
   * @param pieceIndex - Index of the piece to check
   * @returns Number of peers that have this piece
   *
   * @example
   * ```typescript
   * const peerCount = availability.getAvailability(42);
   * if (peerCount === 0) {
   *   console.log('Piece 42 is not available from any peer!');
   * }
   * ```
   */
  getAvailability(pieceIndex: number): number {
    if (pieceIndex < 0 || pieceIndex >= this.pieceCount) {
      return 0;
    }
    return this.availability[pieceIndex];
  }

  /**
   * Get piece indices sorted by rarity (ascending - rarest first).
   *
   * Uses caching to avoid re-sorting on every call when availability hasn't changed.
   * Excludes pieces in the exclude set (typically pieces we already have
   * or are currently downloading).
   *
   * @param exclude - Set of piece indices to exclude from results
   * @returns Array of piece indices sorted by availability (rarest first)
   *
   * @example
   * ```typescript
   * const ownedPieces = new Set([0, 1, 2, 3]); // Pieces we already have
   * const rarestPieces = availability.getRarestPieces(ownedPieces);
   * console.log('Rarest piece:', rarestPieces[0]);
   * ```
   */
  getRarestPieces(exclude: Set<number>): number[] {
    // Check if we can use cached ranking (same exclude set and cache valid)
    if (
      this.cachedRanking &&
      this.lastExcludeSet &&
      this.setsEqual(exclude, this.lastExcludeSet)
    ) {
      return this.cachedRanking;
    }

    // Create array of [pieceIndex, availability] pairs
    const pieces: Array<{ index: number; count: number }> = [];

    for (let i = 0; i < this.pieceCount; i++) {
      if (!exclude.has(i) && this.availability[i] > 0) {
        pieces.push({ index: i, count: this.availability[i] });
      }
    }

    // Sort by availability (ascending), then by index (ascending) for ties
    pieces.sort((a, b) => {
      if (a.count !== b.count) {
        return a.count - b.count;
      }
      return a.index - b.index;
    });

    const result = pieces.map((p) => p.index);

    // Cache the result
    this.cachedRanking = result;
    this.lastExcludeSet = new Set(exclude);

    return result;
  }

  /**
   * Check if two sets are equal (for cache validation)
   */
  private setsEqual(a: Set<number>, b: Set<number>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }

  /**
   * Get the rarest available piece for a specific peer (optimized for frequent calls)
   * Uses cached rankings when possible
   */
  getRarestForPeer(peerBitfield: Buffer, exclude: Set<number>): number | null {
    // Get cached or compute full ranking
    const ranking = this.getRarestPieces(exclude);

    // Find the first piece in ranking that the peer has
    for (const pieceIndex of ranking) {
      if (hasBit(peerBitfield, pieceIndex)) {
        return pieceIndex;
      }
    }

    return null;
  }

  /**
   * Get the IDs of all peers that have a specific piece.
   *
   * @param pieceIndex - Index of the piece to check
   * @returns Array of peer IDs that have this piece
   *
   * @example
   * ```typescript
   * const peers = availability.getPeersWithPiece(42);
   * console.log(`Piece 42 is available from: ${peers.join(', ')}`);
   * ```
   */
  getPeersWithPiece(pieceIndex: number): string[] {
    const peers: string[] = [];

    for (const [peerId, bitfield] of this.peerBitfields) {
      if (hasBit(bitfield, pieceIndex)) {
        peers.push(peerId);
      }
    }

    return peers;
  }

  /**
   * Check if a peer is currently being tracked.
   *
   * @param peerId - Unique identifier for the peer
   * @returns true if the peer is registered, false otherwise
   *
   * @example
   * ```typescript
   * if (availability.hasPeer('peer-abc')) {
   *   console.log('Peer is being tracked');
   * }
   * ```
   */
  hasPeer(peerId: string): boolean {
    return this.peerBitfields.has(peerId);
  }
}

// =============================================================================
// Piece Selector
// =============================================================================

/**
 * Selects which piece to download next based on the configured strategy.
 *
 * The piece selector considers:
 * - Which pieces we already have (ownBitfield)
 * - Which pieces the peer has (peerBitfield)
 * - Which pieces are currently being downloaded (inProgress)
 * - Piece availability across all peers (for rarest-first strategy)
 *
 * @example
 * ```typescript
 * const selector = new PieceSelector(100); // 100-piece torrent
 *
 * // Add peer bitfields for availability tracking
 * selector.availability.addPeer('peer-1', peer1Bitfield);
 * selector.availability.addPeer('peer-2', peer2Bitfield);
 *
 * // Select a piece to request from a specific peer
 * const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);
 * if (piece !== null) {
 *   console.log(`Requesting piece ${piece}`);
 * }
 * ```
 */
export class PieceSelector {
  /** The current selection strategy */
  public strategy: SelectionStrategy;

  /** Piece availability tracker */
  public readonly availability: PieceAvailability;

  /** Total number of pieces */
  private readonly pieceCount: number;

  /**
   * Create a new piece selector.
   *
   * @param pieceCount - Total number of pieces in the torrent
   * @param strategy - Selection strategy to use (default: RarestFirst)
   */
  constructor(
    pieceCount: number,
    strategy: SelectionStrategy = SelectionStrategy.RarestFirst
  ) {
    this.pieceCount = pieceCount;
    this.strategy = strategy;
    this.availability = new PieceAvailability(pieceCount);
  }

  /**
   * Change the piece selection strategy.
   *
   * @param strategy - The new strategy to use
   *
   * @example
   * ```typescript
   * // Switch to sequential mode for streaming
   * selector.setStrategy(SelectionStrategy.Sequential);
   * ```
   */
  setStrategy(strategy: SelectionStrategy): void {
    this.strategy = strategy;
  }

  /**
   * Select a single piece to download from a peer.
   *
   * Returns the index of a piece to download, or null if no suitable
   * piece is available from this peer.
   *
   * @param ownBitfield - Our bitfield (pieces we already have)
   * @param peerBitfield - The peer's bitfield (pieces they have)
   * @param inProgress - Set of piece indices currently being downloaded
   * @returns Piece index to download, or null if none available
   *
   * @example
   * ```typescript
   * const piece = selector.selectPiece(ownBitfield, peerBitfield, inProgress);
   * if (piece !== null) {
   *   requestPiece(peer, piece);
   * } else {
   *   console.log('No interesting pieces from this peer');
   * }
   * ```
   */
  selectPiece(
    ownBitfield: Buffer,
    peerBitfield: Buffer,
    inProgress: Set<number>
  ): number | null {
    // Get candidate pieces (peer has, we don't have, not in progress)
    const candidates = this.getCandidatePieces(
      ownBitfield,
      peerBitfield,
      inProgress
    );

    if (candidates.length === 0) {
      return null;
    }

    switch (this.strategy) {
      case SelectionStrategy.RarestFirst:
        return this.selectRarestFirst(candidates);

      case SelectionStrategy.Sequential:
        return this.selectSequential(candidates);

      case SelectionStrategy.Random:
        return this.selectRandom(candidates);

      default:
        return this.selectRarestFirst(candidates);
    }
  }

  /**
   * Select multiple pieces to download from a peer.
   *
   * Useful for request pipelining where multiple pieces can be
   * requested simultaneously for better throughput.
   *
   * @param ownBitfield - Our bitfield (pieces we already have)
   * @param peerBitfield - The peer's bitfield (pieces they have)
   * @param inProgress - Set of piece indices currently being downloaded
   * @param count - Maximum number of pieces to select
   * @returns Array of piece indices to download
   *
   * @example
   * ```typescript
   * // Select up to 5 pieces for pipelined requests
   * const pieces = selector.selectPieces(ownBitfield, peerBitfield, inProgress, 5);
   * for (const piece of pieces) {
   *   requestPiece(peer, piece);
   * }
   * ```
   */
  selectPieces(
    ownBitfield: Buffer,
    peerBitfield: Buffer,
    inProgress: Set<number>,
    count: number
  ): number[] {
    const result: number[] = [];
    const tempInProgress = new Set(inProgress);

    for (let i = 0; i < count; i++) {
      const piece = this.selectPiece(ownBitfield, peerBitfield, tempInProgress);
      if (piece === null) {
        break;
      }
      result.push(piece);
      tempInProgress.add(piece);
    }

    return result;
  }

  /**
   * Get candidate pieces that can be requested from a peer.
   *
   * A candidate piece is one where:
   * - We don't have it (not set in ownBitfield)
   * - The peer has it (set in peerBitfield)
   * - It's not already being downloaded (not in inProgress)
   *
   * @param ownBitfield - Our bitfield
   * @param peerBitfield - Peer's bitfield
   * @param inProgress - Set of pieces being downloaded
   * @returns Array of candidate piece indices
   */
  private getCandidatePieces(
    ownBitfield: Buffer,
    peerBitfield: Buffer,
    inProgress: Set<number>
  ): number[] {
    const candidates: number[] = [];

    for (let i = 0; i < this.pieceCount; i++) {
      // Skip if we already have this piece
      if (hasBit(ownBitfield, i)) {
        continue;
      }

      // Skip if peer doesn't have this piece
      if (!hasBit(peerBitfield, i)) {
        continue;
      }

      // Skip if piece is already in progress
      if (inProgress.has(i)) {
        continue;
      }

      candidates.push(i);
    }

    return candidates;
  }

  /**
   * Select the rarest piece from candidates using availability data.
   *
   * Optimized to avoid full sort - uses cached rankings when possible,
   * otherwise finds minimum in O(n) instead of O(n log n) sort.
   *
   * @param candidates - Array of candidate piece indices
   * @returns The rarest piece index
   */
  private selectRarestFirst(candidates: number[]): number {
    if (candidates.length === 0) {
      // This shouldn't happen as we check in selectPiece, but TypeScript safety
      return candidates[0];
    }

    // For small candidate sets, just find minimum (O(n) instead of O(n log n))
    let rarestIndex = candidates[0];
    let rarestAvail = this.availability.getAvailability(candidates[0]);

    for (let i = 1; i < candidates.length; i++) {
      const avail = this.availability.getAvailability(candidates[i]);
      if (
        avail < rarestAvail ||
        (avail === rarestAvail && candidates[i] < rarestIndex)
      ) {
        rarestAvail = avail;
        rarestIndex = candidates[i];
      }
    }

    return rarestIndex;
  }

  /**
   * Select the piece with the lowest index from candidates.
   *
   * @param candidates - Array of candidate piece indices
   * @returns The lowest-index piece
   */
  private selectSequential(candidates: number[]): number {
    // Candidates are already in order from getCandidatePieces
    // But let's be explicit and find the minimum
    return Math.min(...candidates);
  }

  /**
   * Select a random piece from candidates.
   *
   * @param candidates - Array of candidate piece indices
   * @returns A randomly selected piece index
   */
  private selectRandom(candidates: number[]): number {
    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }
}

// =============================================================================
// Endgame Mode Helper
// =============================================================================

/**
 * Get pieces to request in endgame mode.
 *
 * In endgame mode (when most pieces are downloaded), we request the same
 * blocks from multiple peers to finish faster. This function returns the
 * pieces we're still missing when we're close to completion.
 *
 * Endgame mode is typically activated when:
 * - We have more than (pieceCount - threshold) pieces
 * - Only a few pieces remain and they're being downloaded slowly
 *
 * @param ownBitfield - Our bitfield (pieces we already have)
 * @param pieceCount - Total number of pieces in the torrent
 * @param threshold - Number of remaining pieces to trigger endgame
 * @returns Array of piece indices we're missing (for endgame requests)
 *
 * @example
 * ```typescript
 * // Check if we're in endgame mode (less than 5 pieces remaining)
 * const missingPieces = getEndgamePieces(ownBitfield, pieceCount, 5);
 * if (missingPieces.length > 0 && missingPieces.length <= 5) {
 *   // Enter endgame mode - request remaining pieces from all peers
 *   for (const piece of missingPieces) {
 *     requestFromAllPeers(piece);
 *   }
 * }
 * ```
 */
export function getEndgamePieces(
  ownBitfield: Buffer,
  pieceCount: number,
  threshold: number
): number[] {
  const ownedCount = countBits(ownBitfield);
  const missingCount = pieceCount - ownedCount;

  // Only return pieces if we're in endgame mode
  if (missingCount > threshold) {
    return [];
  }

  // Find all missing pieces
  const missingPieces: number[] = [];
  for (let i = 0; i < pieceCount; i++) {
    if (!hasBit(ownBitfield, i)) {
      missingPieces.push(i);
    }
  }

  return missingPieces;
}
