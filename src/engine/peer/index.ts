/**
 * Peer Protocol Module
 *
 * Exports all peer protocol components for BitTorrent peer communication.
 *
 * @module engine/peer
 */

// Messages - Protocol message encoding/decoding
export {
  // Constants
  PROTOCOL_STRING,
  PROTOCOL_STRING_LENGTH,
  HANDSHAKE_LENGTH,
  RESERVED_LENGTH,
  INFO_HASH_LENGTH,
  PEER_ID_LENGTH,
  MESSAGE_LENGTH_PREFIX,
  BLOCK_SIZE,

  // Enums and Types
  MessageType,
  type HandshakeMessage,
  type KeepAliveMessage,
  type ChokeMessage,
  type UnchokeMessage,
  type InterestedMessage,
  type NotInterestedMessage,
  type HaveMessage,
  type BitfieldMessage,
  type RequestMessage,
  type PieceMessage,
  type CancelMessage,
  type PeerMessage,
  type DecodedMessage,

  // Handshake functions
  encodeHandshake,
  decodeHandshake,

  // Message encoding functions
  encodeKeepAlive,
  encodeChoke,
  encodeUnchoke,
  encodeInterested,
  encodeNotInterested,
  encodeHave,
  encodeBitfield,
  encodeRequest,
  encodePiece,
  encodeCancel,
  encodeMessage,

  // Message decoding functions
  decodeMessage,
  decodeHave,
  decodeBitfield,
  decodeRequest,
  decodePiece,
  decodeCancel,
  parseMessage,

  // Bitfield utilities
  allocateBitfield,
  setBit,
  clearBit,
  hasBit,
  countBits,
  isComplete,

  // Message utilities
  calculateMessageLength,
  getExpectedPayloadLength,
  getMessageName,
  writeUInt32BE,
  readUInt32BE,

  // Aliases for backward compatibility
  MessageId,
  createHandshake,
  createKeepAlive,
  createChoke,
  createUnchoke,
  createInterested,
  createNotInterested,
  createHave,
  createBitfield,
  createRequest,
  createPiece,
  createCancel,
  parseHandshake,
} from './messages.js';

// Connection - TCP socket wrapper
export {
  PeerConnection,
  createPeerConnection,
  ConnectionState,
  type PeerConnectionEvents,
  type PeerConnectionOptions,
  type FromSocketOptions,
} from './connection.js';

// Smart Connection - Dual-attempt connection strategy
export {
  smartConnect,
  type SmartConnectionResult,
  type SmartConnectionOptions,
  type EncryptionMode,
} from './smart-connect.js';

// Encrypted Connection Attempt
export {
  attemptEncryptedConnection,
  type EncryptedConnectionResult,
  type EncryptedConnectionOptions,
} from './encrypted-connection.js';

// Plaintext Connection Attempt
export {
  attemptPlaintextConnection,
  type PlaintextConnectionResult,
  type PlaintextConnectionOptions,
} from './plaintext-connection.js';

// Protocol - Wire protocol handler
export {
  WireProtocol,
  ProtocolState,
  MAX_BLOCK_SIZE,
  MAX_MESSAGE_LENGTH,
  type WireProtocolEvents,
} from './protocol.js';

// Manager - Peer connection manager
export {
  PeerManager,
  DisconnectReason,
  type PeerManagerEvents,
  type PeerManagerOptions,
} from './manager.js';

// Extension Protocol (BEP 10) and PEX (BEP 11)
export {
  ExtensionManager,
  KnownExtensions,
  PexFlags,
  type ExtensionHandshake,
  type PexPeer,
  type PexMessage,
  type ExtensionEvents,
} from './extension.js';

// Reserved bytes utilities for capability advertisement
export {
  ReservedBits,
  createReservedBytes,
  hasCapability,
  encodeExtended,
  decodeExtended,
  type ExtendedMessage,
} from './messages.js';

// Protocol Encryption (MSE/PE)
export {
  EncryptedConnection,
  RC4Stream,
  CryptoProvide,
  generateDHKeyPair,
  computeDHSecret,
  deriveRC4Keys,
  hashSync1,
  hashSync2,
  hashSync3,
  createInitiatorHandshake,
  buildCryptoProvide,
  selectCryptoMethod,
  DH_KEY_LENGTH,
  VC,
  type EncryptionResult,
  type EncryptionOptions,
  type CryptoMethod,
} from './encryption.js';

// MSE Handshake (full encryption negotiation)
export {
  performMSEHandshake,
  looksLikeMSE,
  type MSEHandshakeResult,
  type MSEHandshakeFailure,
  type MSEResult,
} from './mse-handshake.js';
