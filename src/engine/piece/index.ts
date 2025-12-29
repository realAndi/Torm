// Piece management and verification
export {
  PieceVerifier,
  computeSha1,
  verifyPieceAsync,
  verifyPieces,
  SHA1_HASH_SIZE,
} from './verifier.js';

export type { VerificationResult, PieceVerifierEvents } from './verifier.js';

// Piece state tracking
// Note: Bitfield utilities (allocateBitfield, hasBit, setBit, clearBit, countBits, BLOCK_SIZE)
// are exported from peer/messages.js to avoid duplicate exports
export {
  BlockState,
  PieceState,
  TorrentPieceMap,
  BLOCK_SIZE,
  allocateBitfield,
  hasBit,
  setBit,
  clearBit,
  countBits,
} from './state.js';

// Piece selection strategies
export {
  SelectionStrategy,
  PieceAvailability,
  PieceSelector,
  getEndgamePieces,
} from './selector.js';

// Piece manager coordinator
export {
  PieceManager,
  DEFAULT_PIPELINE_LENGTH,
  DEFAULT_ENDGAME_THRESHOLD,
  MAX_PIECE_RETRIES,
} from './manager.js';

export type { PieceManagerEvents, PieceManagerOptions } from './manager.js';
