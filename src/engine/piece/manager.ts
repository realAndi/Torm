/**
 * Piece Manager for Torm BitTorrent Client
 *
 * Coordinates piece downloading by integrating:
 * - Piece state tracking (TorrentPieceMap)
 * - SHA-1 piece verification (PieceVerifier)
 * - Piece selection strategies (PieceSelector)
 * - Block request management and endgame mode
 *
 * The PieceManager orchestrates the download process, deciding which pieces
 * to request from which peers, tracking block-level progress, and verifying
 * completed pieces against their expected hashes.
 *
 * @module engine/piece/manager
 */

import { TypedEventEmitter } from '../events.js';
import {
  BlockState,
  PieceState,
  TorrentPieceMap,
  BLOCK_SIZE,
  hasBit,
} from './state.js';
import { PieceVerifier } from './verifier.js';
import {
  PieceSelector,
  PieceAvailability,
  SelectionStrategy,
  getEndgamePieces,
} from './selector.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default number of blocks to pipeline per peer.
 *
 * qBittorrent uses 256 blocks (4MB in-flight) for optimal throughput.
 * With 16KB blocks, this means:
 * - 256 blocks × 16KB = 4MB in-flight per peer
 * - On 100ms RTT: ~40 MB/s sustainable per peer
 *
 * The old value of 16 blocks (256KB) severely limited throughput to ~2.5 MB/s per peer.
 */
const DEFAULT_PIPELINE_LENGTH = 256;

/**
 * Base number of missing pieces to trigger endgame mode.
 * Higher value means earlier endgame activation for better tail latency.
 */
const DEFAULT_ENDGAME_THRESHOLD = 20;

/**
 * Calculate dynamic endgame threshold based on piece count.
 * Uses min(20, 15% of pieces) to enter endgame earlier for better completion.
 * This is more aggressive than qBittorrent's 5% to reduce tail latency.
 */
function calculateEndgameThreshold(pieceCount: number): number {
  const percentBased = Math.ceil(pieceCount * 0.15);
  return Math.min(DEFAULT_ENDGAME_THRESHOLD, percentBased);
}

/** Maximum number of times to re-download a failed piece before giving up */
const MAX_PIECE_RETRIES = 3;

/**
 * Timeout for pending requests in milliseconds.
 * Increased from 10s to 30s to avoid unnecessary re-requests on slow peers.
 * The slow peer detection and choking algorithm will handle truly slow peers.
 */
const REQUEST_TIMEOUT_MS = 30000;

// =============================================================================
// Types
// =============================================================================

/**
 * Events emitted by the PieceManager
 */
export interface PieceManagerEvents {
  /** Emitted when a piece passes SHA-1 verification */
  pieceComplete: {
    pieceIndex: number;
    data: Buffer;
  };

  /** Emitted when a piece fails SHA-1 verification */
  pieceFailed: {
    pieceIndex: number;
    expectedHash: Buffer;
    actualHash: Buffer;
    retryCount: number;
  };

  /** Emitted when all pieces are complete */
  downloadComplete: void;

  /** Emitted when a block is needed from a peer */
  blockRequest: {
    peerId: string;
    pieceIndex: number;
    begin: number;
    length: number;
  };

  /** Emitted when endgame mode is entered */
  endgameStarted: {
    missingPieces: number[];
  };

  /** Emitted when a piece cannot be downloaded after max retries */
  pieceGaveUp: {
    pieceIndex: number;
    retryCount: number;
  };
}

/**
 * Configuration options for the PieceManager
 */
export interface PieceManagerOptions {
  /** Total number of pieces in the torrent */
  pieceCount: number;

  /** Standard piece length (bytes) */
  pieceLength: number;

  /** Total torrent size (bytes) */
  totalLength: number;

  /** Concatenated SHA-1 hashes for all pieces (pieceCount * 20 bytes) */
  pieceHashes: Buffer;

  /** Number of outstanding block requests to maintain per peer (default: 5) */
  pipelineLength?: number;

  /** Number of missing pieces to trigger endgame mode (default: 10) */
  endgameThreshold?: number;

  /** Initial selection strategy (default: RarestFirst) */
  strategy?: SelectionStrategy;
}

/**
 * Information about a pending block request
 */
interface PendingRequest {
  /** Peer ID that received the request */
  peerId: string;

  /** Piece index */
  pieceIndex: number;

  /** Block index within the piece */
  blockIndex: number;

  /** Byte offset within the piece */
  begin: number;

  /** Block length in bytes */
  length: number;

  /** Timestamp when the request was sent */
  requestedAt: number;
}

/**
 * Tracks retry counts for pieces that have failed verification
 */
interface PieceRetryInfo {
  /** Number of times this piece has been re-downloaded */
  retryCount: number;

  /** Peer IDs that have sent bad data for this piece */
  badPeers: Set<string>;
}

// =============================================================================
// PieceManager Class
// =============================================================================

/**
 * Coordinates piece downloading for a torrent.
 *
 * The PieceManager is responsible for:
 * - Tracking which pieces and blocks have been downloaded
 * - Selecting which pieces to request from peers
 * - Managing block-level requests and pipelining
 * - Verifying completed pieces against their SHA-1 hashes
 * - Handling verification failures and retries
 * - Entering endgame mode when download is nearly complete
 *
 * @example
 * ```typescript
 * const pieceManager = new PieceManager({
 *   pieceCount: 100,
 *   pieceLength: 262144,
 *   totalLength: 26214400,
 *   pieceHashes: torrentInfo.pieces,
 * });
 *
 * // Listen for completed pieces
 * pieceManager.on('pieceComplete', ({ pieceIndex, data }) => {
 *   disk.writePiece(pieceIndex, data);
 * });
 *
 * // Handle incoming peer bitfield
 * pieceManager.addPeerBitfield('peer-123', peerBitfield);
 *
 * // Request blocks from peers
 * const requests = pieceManager.getBlockRequests('peer-123', 5);
 * for (const req of requests) {
 *   peerManager.sendRequest(infoHash, 'peer-123', req.pieceIndex, req.begin, req.length);
 * }
 *
 * // Handle received block
 * pieceManager.handleBlock('peer-123', pieceIndex, begin, blockData);
 * ```
 */
export class PieceManager extends TypedEventEmitter<PieceManagerEvents> {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** Piece state tracking */
  private readonly pieceMap: TorrentPieceMap;

  /** Piece verification */
  private readonly verifier: PieceVerifier;

  /** Piece selection */
  private readonly selector: PieceSelector;

  /** Number of block requests to pipeline per peer */
  private readonly pipelineLength: number;

  /** Threshold for entering endgame mode */
  private readonly endgameThreshold: number;

  /** Pending block requests by request key */
  private readonly pendingRequests: Map<string, PendingRequest>;

  /** Requests grouped by peer ID */
  private readonly requestsByPeer: Map<string, Set<string>>;

  /** Requests grouped by piece index */
  private readonly requestsByPiece: Map<number, Set<string>>;

  /** Retry information for pieces that failed verification */
  private readonly pieceRetries: Map<number, PieceRetryInfo>;

  /** Whether we're in endgame mode */
  private inEndgame: boolean;

  /** Set of pieces being downloaded in endgame mode */
  private endgamePieces: Set<number>;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Create a new PieceManager
   *
   * @param options - Manager configuration
   */
  constructor(options: PieceManagerOptions) {
    super();

    this.pieceMap = new TorrentPieceMap(
      options.pieceCount,
      options.pieceLength,
      options.totalLength
    );

    this.verifier = new PieceVerifier(options.pieceHashes);
    this.selector = new PieceSelector(
      options.pieceCount,
      options.strategy ?? SelectionStrategy.RarestFirst
    );

    this.pipelineLength = options.pipelineLength ?? DEFAULT_PIPELINE_LENGTH;
    // Use dynamic endgame threshold based on piece count if not explicitly set
    this.endgameThreshold = options.endgameThreshold ?? calculateEndgameThreshold(options.pieceCount);

    this.pendingRequests = new Map();
    this.requestsByPeer = new Map();
    this.requestsByPiece = new Map();
    this.pieceRetries = new Map();

    this.inEndgame = false;
    this.endgamePieces = new Set();
  }

  // ===========================================================================
  // Public Properties
  // ===========================================================================

  /**
   * Total number of pieces in the torrent
   */
  get pieceCount(): number {
    return this.pieceMap.pieceCount;
  }

  /**
   * Number of completed (verified) pieces
   */
  get completedPieces(): number {
    return this.pieceMap.getCompletedCount();
  }

  /**
   * Download progress as a ratio (0-1)
   */
  get progress(): number {
    return this.pieceMap.getProgress();
  }

  /**
   * Whether the download is complete
   */
  get isComplete(): boolean {
    return this.completedPieces === this.pieceCount;
  }

  /**
   * Whether we're in endgame mode
   */
  get isEndgame(): boolean {
    return this.inEndgame;
  }

  /**
   * Access to the piece availability tracker
   */
  get availability(): PieceAvailability {
    return this.selector.availability;
  }

  // ===========================================================================
  // Public Methods - Peer Management
  // ===========================================================================

  /**
   * Register a peer with their bitfield
   *
   * @param peerId - Unique identifier for the peer
   * @param bitfield - The peer's bitfield indicating which pieces they have
   */
  addPeerBitfield(peerId: string, bitfield: Buffer): void {
    this.selector.availability.addPeer(peerId, bitfield);
  }

  /**
   * Update when a peer announces they have a new piece
   *
   * @param peerId - Unique identifier for the peer
   * @param pieceIndex - Index of the piece the peer now has
   */
  handlePeerHave(peerId: string, pieceIndex: number): void {
    this.selector.availability.updatePeerHave(peerId, pieceIndex);
  }

  /**
   * Remove a peer from tracking
   *
   * Cancels all pending requests to this peer and removes them from availability.
   *
   * @param peerId - Unique identifier for the peer
   */
  removePeer(peerId: string): void {
    // Cancel all pending requests for this peer
    const peerRequests = this.requestsByPeer.get(peerId);
    if (peerRequests) {
      for (const requestKey of peerRequests) {
        const request = this.pendingRequests.get(requestKey);
        if (request) {
          // Reset block state to missing so it can be re-requested
          const pieceState = this.pieceMap.pieces.get(request.pieceIndex);
          if (pieceState) {
            const blockState = pieceState.getBlockState(request.blockIndex);
            if (blockState === BlockState.Requested) {
              pieceState.setBlockState(request.blockIndex, BlockState.Missing);
            }
          }

          // Clean up piece request tracking
          const pieceRequests = this.requestsByPiece.get(request.pieceIndex);
          if (pieceRequests) {
            pieceRequests.delete(requestKey);
          }

          this.pendingRequests.delete(requestKey);
        }
      }
      this.requestsByPeer.delete(peerId);
    }

    // Remove from availability tracking
    this.selector.availability.removePeer(peerId);
  }

  // ===========================================================================
  // Public Methods - Block Requests
  // ===========================================================================

  /**
   * Get block requests for a peer
   *
   * Returns up to `count` block requests that can be sent to the specified peer.
   * Takes into account the peer's available pieces, our current state, and
   * any pending requests.
   *
   * @param peerId - Peer to get requests for
   * @param peerBitfield - The peer's bitfield
   * @param count - Maximum number of requests to return (default: pipelineLength)
   * @returns Array of block request objects
   */
  getBlockRequests(
    peerId: string,
    peerBitfield: Buffer,
    count?: number
  ): Array<{ pieceIndex: number; begin: number; length: number }> {
    const maxRequests = count ?? this.pipelineLength;
    const requests: Array<{ pieceIndex: number; begin: number; length: number }> = [];

    // Check existing pending requests for this peer
    const existingRequests = this.requestsByPeer.get(peerId)?.size ?? 0;
    const neededRequests = maxRequests - existingRequests;

    // In endgame mode, be more aggressive - don't limit based on existing requests
    if (this.inEndgame) {
      // Get our bitfield to check completion
      const ownBitfield = this.pieceMap.getBitfield();

      // Request aggressively - use full pipeline even if we have pending requests
      // This allows same blocks to be requested from multiple peers
      const endgameNeeded = Math.max(neededRequests, maxRequests);
      return this.getEndgameRequests(peerId, peerBitfield, endgameNeeded);
    }

    if (neededRequests <= 0) {
      return requests;
    }

    // Build set of in-progress pieces for selection
    const inProgress = new Set<number>();
    for (const pieceIndex of this.pieceMap.getInProgressPieces()) {
      inProgress.add(pieceIndex);
    }

    // Get our bitfield
    const ownBitfield = this.pieceMap.getBitfield();

    // Normal mode: select pieces using the strategy
    for (let i = 0; i < neededRequests; i++) {
      // First, try to get blocks from pieces already in progress
      const inProgressRequest = this.getRequestFromInProgress(peerId, peerBitfield);
      if (inProgressRequest) {
        requests.push(inProgressRequest);
        continue;
      }

      // Select a new piece
      const pieceIndex = this.selector.selectPiece(ownBitfield, peerBitfield, inProgress);
      if (pieceIndex === null) {
        break;
      }

      // Get or create piece state
      const pieceState = this.pieceMap.getPieceState(pieceIndex);
      inProgress.add(pieceIndex);

      // Get the first missing block
      const missingBlocks = pieceState.getMissingBlocks();
      if (missingBlocks.length === 0) {
        continue;
      }

      const blockIndex = missingBlocks[0];
      const request = this.createBlockRequest(peerId, pieceIndex, blockIndex, pieceState);
      if (request) {
        requests.push(request);
      }
    }

    // Check if we should enter endgame mode
    this.checkEndgame();

    return requests;
  }

  /**
   * Handle a received block from a peer
   *
   * Writes the block data to the piece buffer and checks if the piece
   * is complete. If complete, verifies the piece hash.
   *
   * @param peerId - Peer that sent the block
   * @param pieceIndex - Index of the piece
   * @param begin - Byte offset within the piece
   * @param data - Block data
   */
  handleBlock(peerId: string, pieceIndex: number, begin: number, data: Buffer): void {
    // Find and remove the pending request
    const blockIndex = Math.floor(begin / BLOCK_SIZE);
    const requestKey = this.getRequestKey(pieceIndex, blockIndex);
    const request = this.pendingRequests.get(requestKey);

    if (request) {
      this.pendingRequests.delete(requestKey);

      // Remove from peer tracking
      const peerRequests = this.requestsByPeer.get(request.peerId);
      if (peerRequests) {
        peerRequests.delete(requestKey);
      }

      // Remove from piece tracking
      const pieceRequests = this.requestsByPiece.get(pieceIndex);
      if (pieceRequests) {
        pieceRequests.delete(requestKey);
      }
    }

    // In endgame mode, clean up all peer-specific requests for this block
    // This prevents duplicate downloads and frees up request slots
    if (this.inEndgame) {
      // Remove endgame-style request keys from ALL peers for this block
      for (const [pId, peerRequests] of this.requestsByPeer) {
        const endgameKey = `${pId}:${pieceIndex}:${blockIndex}`;
        peerRequests.delete(endgameKey);
      }

      // Clean up piece tracking for endgame keys
      const pieceRequests = this.requestsByPiece.get(pieceIndex);
      if (pieceRequests) {
        // Remove all keys matching this block
        for (const key of Array.from(pieceRequests)) {
          if (key.endsWith(`:${pieceIndex}:${blockIndex}`)) {
            pieceRequests.delete(key);
          }
        }
      }
    }

    // In endgame mode, we may receive the same block from multiple peers
    // Check if we already have this block
    const pieceState = this.pieceMap.pieces.get(pieceIndex);
    if (!pieceState) {
      // Piece might already be complete
      return;
    }

    if (pieceState.getBlockState(blockIndex) === BlockState.Received) {
      // Already have this block (endgame duplicate)
      return;
    }

    // Write the block
    try {
      pieceState.writeBlock(blockIndex, data);
    } catch (err) {
      // Invalid block data - ignore
      return;
    }

    // Check if piece is complete
    if (pieceState.isComplete()) {
      this.verifyPiece(pieceIndex, pieceState, peerId);
    }
  }

  /**
   * Cancel a pending block request
   *
   * @param pieceIndex - Index of the piece
   * @param begin - Byte offset within the piece
   * @returns The peer ID that had the request, or null if not found
   */
  cancelRequest(pieceIndex: number, begin: number): string | null {
    const blockIndex = Math.floor(begin / BLOCK_SIZE);
    const requestKey = this.getRequestKey(pieceIndex, blockIndex);
    const request = this.pendingRequests.get(requestKey);

    if (!request) {
      return null;
    }

    // Remove from all tracking
    this.pendingRequests.delete(requestKey);

    const peerRequests = this.requestsByPeer.get(request.peerId);
    if (peerRequests) {
      peerRequests.delete(requestKey);
    }

    const pieceRequests = this.requestsByPiece.get(pieceIndex);
    if (pieceRequests) {
      pieceRequests.delete(requestKey);
    }

    // Reset block state
    const pieceState = this.pieceMap.pieces.get(pieceIndex);
    if (pieceState) {
      pieceState.setBlockState(blockIndex, BlockState.Missing);
    }

    return request.peerId;
  }

  // ===========================================================================
  // Public Methods - State Management
  // ===========================================================================

  /**
   * Mark a piece as already complete (for resuming downloads)
   *
   * @param pieceIndex - Index of the piece
   */
  markPieceComplete(pieceIndex: number): void {
    this.pieceMap.markPieceComplete(pieceIndex);

    if (this.isComplete) {
      this.emit('downloadComplete');
    }
  }

  /**
   * Check if we have a specific piece
   *
   * @param pieceIndex - Index of the piece
   * @returns true if the piece is complete
   */
  hasPiece(pieceIndex: number): boolean {
    return this.pieceMap.hasPiece(pieceIndex);
  }

  /**
   * Get the bitfield representing completed pieces
   *
   * @returns Bitfield buffer
   */
  getBitfield(): Buffer {
    return this.pieceMap.getBitfield();
  }

  /**
   * Change the piece selection strategy
   *
   * @param strategy - New selection strategy
   */
  setStrategy(strategy: SelectionStrategy): void {
    this.selector.setStrategy(strategy);
  }

  /**
   * Get the number of pending requests for a peer
   *
   * @param peerId - Peer ID
   * @returns Number of pending requests
   */
  getPendingRequestCount(peerId: string): number {
    return this.requestsByPeer.get(peerId)?.size ?? 0;
  }

  /**
   * Get all peers that have a specific piece
   *
   * @param pieceIndex - Index of the piece
   * @returns Array of peer IDs
   */
  getPeersWithPiece(pieceIndex: number): string[] {
    return this.selector.availability.getPeersWithPiece(pieceIndex);
  }

  /**
   * Cancel requests that have been pending for too long
   *
   * Resets blocks to Missing state so they can be re-requested from other peers.
   * This prevents downloads from stalling when peers disconnect or stop responding.
   *
   * @returns Number of requests cancelled
   */
  cancelStaleRequests(): number {
    const now = Date.now();
    let cancelled = 0;

    for (const [requestKey, request] of this.pendingRequests) {
      if (now - request.requestedAt > REQUEST_TIMEOUT_MS) {
        // Reset block state to missing
        const pieceState = this.pieceMap.pieces.get(request.pieceIndex);
        if (pieceState) {
          const blockState = pieceState.getBlockState(request.blockIndex);
          if (blockState === BlockState.Requested) {
            pieceState.setBlockState(request.blockIndex, BlockState.Missing);
          }
        }

        // Clean up tracking
        const peerRequests = this.requestsByPeer.get(request.peerId);
        if (peerRequests) {
          peerRequests.delete(requestKey);
        }

        const pieceRequests = this.requestsByPiece.get(request.pieceIndex);
        if (pieceRequests) {
          pieceRequests.delete(requestKey);
        }

        this.pendingRequests.delete(requestKey);
        cancelled++;
      }
    }

    return cancelled;
  }

  // ===========================================================================
  // Private Methods - Block Request Helpers
  // ===========================================================================

  /**
   * Get a block request from a piece already in progress
   */
  private getRequestFromInProgress(
    peerId: string,
    peerBitfield: Buffer
  ): { pieceIndex: number; begin: number; length: number } | null {
    for (const pieceIndex of this.pieceMap.getInProgressPieces()) {
      // Check if peer has this piece
      if (!hasBit(peerBitfield, pieceIndex)) {
        continue;
      }

      const pieceState = this.pieceMap.pieces.get(pieceIndex);
      if (!pieceState) {
        continue;
      }

      const missingBlocks = pieceState.getMissingBlocks();
      if (missingBlocks.length === 0) {
        continue;
      }

      const blockIndex = missingBlocks[0];
      return this.createBlockRequest(peerId, pieceIndex, blockIndex, pieceState);
    }

    return null;
  }

  /**
   * Create a block request and track it
   */
  private createBlockRequest(
    peerId: string,
    pieceIndex: number,
    blockIndex: number,
    pieceState: PieceState
  ): { pieceIndex: number; begin: number; length: number } | null {
    const begin = pieceState.getBlockOffset(blockIndex);
    const length = pieceState.getBlockLength(blockIndex);

    // Mark block as requested
    pieceState.setBlockState(blockIndex, BlockState.Requested);

    // Create pending request
    const requestKey = this.getRequestKey(pieceIndex, blockIndex);
    const request: PendingRequest = {
      peerId,
      pieceIndex,
      blockIndex,
      begin,
      length,
      requestedAt: Date.now(),
    };

    this.pendingRequests.set(requestKey, request);

    // Track by peer
    if (!this.requestsByPeer.has(peerId)) {
      this.requestsByPeer.set(peerId, new Set());
    }
    this.requestsByPeer.get(peerId)!.add(requestKey);

    // Track by piece
    if (!this.requestsByPiece.has(pieceIndex)) {
      this.requestsByPiece.set(pieceIndex, new Set());
    }
    this.requestsByPiece.get(pieceIndex)!.add(requestKey);

    return { pieceIndex, begin, length };
  }

  /**
   * Get requests for endgame mode
   *
   * In endgame mode, we request the same blocks from multiple peers
   * to finish faster.
   */
  private getEndgameRequests(
    peerId: string,
    peerBitfield: Buffer,
    count: number
  ): Array<{ pieceIndex: number; begin: number; length: number }> {
    const requests: Array<{ pieceIndex: number; begin: number; length: number }> = [];

    // In endgame mode, be more aggressive - request up to 2x normal pipeline
    // to ensure we're requesting from multiple peers simultaneously
    const endgameCount = Math.min(count * 2, 512);

    for (const pieceIndex of this.endgamePieces) {
      // Check if peer has this piece
      if (!hasBit(peerBitfield, pieceIndex)) {
        continue;
      }

      const pieceState = this.pieceMap.pieces.get(pieceIndex);
      if (!pieceState) {
        continue;
      }

      // Request any blocks that aren't received yet
      for (let blockIndex = 0; blockIndex < pieceState.blockCount; blockIndex++) {
        const blockState = pieceState.getBlockState(blockIndex);
        if (blockState === BlockState.Received) {
          continue;
        }

        // Use a peer-specific request key for endgame to allow duplicate tracking
        const endgameRequestKey = `${peerId}:${pieceIndex}:${blockIndex}`;

        // Check if THIS peer already requested this block
        const peerRequests = this.requestsByPeer.get(peerId);
        if (peerRequests?.has(endgameRequestKey)) {
          continue;
        }

        // In endgame, we allow duplicate requests from different peers
        const begin = pieceState.getBlockOffset(blockIndex);
        const length = pieceState.getBlockLength(blockIndex);

        // Track request with peer-specific key for endgame
        const request: PendingRequest = {
          peerId,
          pieceIndex,
          blockIndex,
          begin,
          length,
          requestedAt: Date.now(),
        };

        // Use standard key for primary tracking (first request wins)
        const standardKey = this.getRequestKey(pieceIndex, blockIndex);
        if (!this.pendingRequests.has(standardKey)) {
          this.pendingRequests.set(standardKey, request);
        }

        // Track per-peer with endgame key
        if (!this.requestsByPeer.has(peerId)) {
          this.requestsByPeer.set(peerId, new Set());
        }
        this.requestsByPeer.get(peerId)!.add(endgameRequestKey);

        if (!this.requestsByPiece.has(pieceIndex)) {
          this.requestsByPiece.set(pieceIndex, new Set());
        }
        this.requestsByPiece.get(pieceIndex)!.add(endgameRequestKey);

        requests.push({ pieceIndex, begin, length });

        if (requests.length >= endgameCount) {
          return requests;
        }
      }
    }

    return requests;
  }

  /**
   * Check if we should enter endgame mode
   */
  private checkEndgame(): void {
    if (this.inEndgame) {
      return;
    }

    const ownBitfield = this.pieceMap.getBitfield();
    const missingPieces = getEndgamePieces(
      ownBitfield,
      this.pieceCount,
      this.endgameThreshold
    );

    if (missingPieces.length > 0 && missingPieces.length <= this.endgameThreshold) {
      this.inEndgame = true;
      this.endgamePieces = new Set(missingPieces);
      this.emit('endgameStarted', { missingPieces });
    }
  }

  /**
   * Generate a unique key for a block request
   */
  private getRequestKey(pieceIndex: number, blockIndex: number): string {
    return `${pieceIndex}:${blockIndex}`;
  }

  // ===========================================================================
  // Private Methods - Piece Verification
  // ===========================================================================

  /**
   * Verify a completed piece
   */
  private verifyPiece(pieceIndex: number, pieceState: PieceState, peerId: string): void {
    const data = pieceState.getData();
    const valid = this.verifier.verify(pieceIndex, data);

    if (valid) {
      // Success! Mark piece as complete
      this.pieceMap.markPieceComplete(pieceIndex);

      // Remove from endgame tracking if applicable
      this.endgamePieces.delete(pieceIndex);

      // Clear retry info
      this.pieceRetries.delete(pieceIndex);

      // Clean up piece request tracking
      this.requestsByPiece.delete(pieceIndex);

      // Emit success event
      this.emit('pieceComplete', { pieceIndex, data });

      // Check if download is complete
      if (this.isComplete) {
        this.emit('downloadComplete');
      }
    } else {
      // Verification failed - handle retry
      this.handleVerificationFailure(pieceIndex, pieceState, peerId);
    }
  }

  /**
   * Handle a piece that failed verification
   */
  private handleVerificationFailure(
    pieceIndex: number,
    pieceState: PieceState,
    peerId: string
  ): void {
    // Get or create retry info
    let retryInfo = this.pieceRetries.get(pieceIndex);
    if (!retryInfo) {
      retryInfo = { retryCount: 0, badPeers: new Set() };
      this.pieceRetries.set(pieceIndex, retryInfo);
    }

    retryInfo.retryCount++;
    retryInfo.badPeers.add(peerId);

    const expectedHash = this.verifier.getExpectedHash(pieceIndex);
    const actualHash = pieceState.data
      ? Buffer.from(
          require('crypto').createHash('sha1').update(pieceState.data).digest()
        )
      : Buffer.alloc(20);

    // Emit failure event
    this.emit('pieceFailed', {
      pieceIndex,
      expectedHash,
      actualHash,
      retryCount: retryInfo.retryCount,
    });

    // Always reset piece for retry - don't leave pieces in limbo
    this.pieceMap.markPieceFailed(pieceIndex);

    if (retryInfo.retryCount >= MAX_PIECE_RETRIES) {
      // Emit gave up event for logging/monitoring
      this.emit('pieceGaveUp', {
        pieceIndex,
        retryCount: retryInfo.retryCount,
      });
      // Reset retry counter to allow fresh attempts
      // (piece was already reset above, so it can be re-downloaded)
      this.pieceRetries.delete(pieceIndex);
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  DEFAULT_PIPELINE_LENGTH,
  DEFAULT_ENDGAME_THRESHOLD,
  MAX_PIECE_RETRIES,
};
