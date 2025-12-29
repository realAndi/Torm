/**
 * BitTorrent Peer Wire Protocol Messages
 *
 * Implements BEP-3 peer wire protocol message types, serialization, and
 * deserialization. All messages use big-endian byte order for multi-byte
 * integers as specified in the protocol.
 *
 * Protocol overview:
 * - Handshake: 68 bytes (pstrlen + pstr + reserved + info_hash + peer_id)
 * - Messages: 4-byte length prefix + message id + payload
 * - Keep-alive: length = 0 (no message id or payload)
 *
 * @module engine/peer/messages
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * The BitTorrent protocol string identifier
 */
export const PROTOCOL_STRING = 'BitTorrent protocol';

/**
 * Length of the protocol string (always 19 for BitTorrent)
 */
export const PROTOCOL_STRING_LENGTH = 19;

/**
 * Total length of a handshake message in bytes
 * 1 (pstrlen) + 19 (pstr) + 8 (reserved) + 20 (info_hash) + 20 (peer_id) = 68
 */
export const HANDSHAKE_LENGTH = 68;

/**
 * Length of the reserved bytes field in handshake
 */
export const RESERVED_LENGTH = 8;

/**
 * Length of info_hash in bytes (SHA-1 hash)
 */
export const INFO_HASH_LENGTH = 20;

/**
 * Length of peer_id in bytes
 */
export const PEER_ID_LENGTH = 20;

/**
 * Length of the message length prefix
 */
export const MESSAGE_LENGTH_PREFIX = 4;

/**
 * Standard block size used in requests (16 KiB)
 */
export const BLOCK_SIZE = 16384;

// =============================================================================
// Message Types
// =============================================================================

/**
 * BitTorrent protocol message type identifiers
 *
 * Each message type has a specific ID that appears after the length prefix.
 * Keep-alive messages have no ID (length = 0).
 */
export enum MessageType {
  /** Choke the peer - stop sending data */
  Choke = 0,

  /** Unchoke the peer - allow data to be sent */
  Unchoke = 1,

  /** Express interest in the peer's pieces */
  Interested = 2,

  /** Express lack of interest in the peer's pieces */
  NotInterested = 3,

  /** Announce possession of a piece */
  Have = 4,

  /** Send bitfield of all pieces we have */
  Bitfield = 5,

  /** Request a block from a piece */
  Request = 6,

  /** Send a block of piece data */
  Piece = 7,

  /** Cancel a pending request */
  Cancel = 8,

  /** Extended message (BEP 10) */
  Extended = 20,
}

// =============================================================================
// Reserved Bytes Flags (BEP 10, BEP 6, etc.)
// =============================================================================

/**
 * Reserved bytes bit flags for capability advertisement
 * These are set in the 8-byte reserved field during handshake
 */
export const ReservedBits = {
  /** BEP 10: Extension Protocol support (byte 5, bit 4 from right = 0x10) */
  EXTENSION_PROTOCOL: { byte: 5, mask: 0x10 },

  /** BEP 6: Fast Extension support (byte 7, bit 2 from right = 0x04) */
  FAST_EXTENSION: { byte: 7, mask: 0x04 },

  /** DHT support (byte 7, bit 0 from right = 0x01) */
  DHT: { byte: 7, mask: 0x01 },
} as const;

/**
 * Create reserved bytes with specified capabilities
 */
export function createReservedBytes(
  options: {
    extensionProtocol?: boolean;
    fastExtension?: boolean;
    dht?: boolean;
  } = {}
): Buffer {
  const reserved = Buffer.alloc(8, 0);

  if (options.extensionProtocol) {
    reserved[ReservedBits.EXTENSION_PROTOCOL.byte] |=
      ReservedBits.EXTENSION_PROTOCOL.mask;
  }
  if (options.fastExtension) {
    reserved[ReservedBits.FAST_EXTENSION.byte] |=
      ReservedBits.FAST_EXTENSION.mask;
  }
  if (options.dht) {
    reserved[ReservedBits.DHT.byte] |= ReservedBits.DHT.mask;
  }

  return reserved;
}

/**
 * Check if a reserved bytes buffer has a specific capability
 */
export function hasCapability(
  reserved: Buffer,
  capability: keyof typeof ReservedBits
): boolean {
  const { byte, mask } = ReservedBits[capability];
  return (reserved[byte] & mask) !== 0;
}

// =============================================================================
// Message Interfaces
// =============================================================================

/**
 * Handshake message structure
 *
 * The handshake is the first message exchanged between peers.
 * It identifies the protocol, torrent, and peer.
 */
export interface HandshakeMessage {
  /** Protocol string (should be "BitTorrent protocol") */
  protocolString: string;

  /** Reserved bytes for protocol extensions (8 bytes) */
  reserved: Buffer;

  /** SHA-1 hash of the torrent info dictionary (20 bytes) */
  infoHash: Buffer;

  /** Unique peer identifier (20 bytes) */
  peerId: Buffer;
}

/**
 * Keep-alive message (no payload)
 *
 * Sent periodically to maintain the connection when no other
 * messages are being exchanged.
 */
export interface KeepAliveMessage {
  type: 'keep-alive';
}

/**
 * Choke message (id = 0, no payload)
 *
 * Indicates that the sender will not send any data to the receiver
 * until an unchoke message is sent.
 */
export interface ChokeMessage {
  type: MessageType.Choke;
}

/**
 * Unchoke message (id = 1, no payload)
 *
 * Indicates that the sender is willing to send data to the receiver.
 */
export interface UnchokeMessage {
  type: MessageType.Unchoke;
}

/**
 * Interested message (id = 2, no payload)
 *
 * Indicates that the sender is interested in pieces that the
 * receiver has.
 */
export interface InterestedMessage {
  type: MessageType.Interested;
}

/**
 * Not Interested message (id = 3, no payload)
 *
 * Indicates that the sender is not interested in any pieces
 * the receiver has.
 */
export interface NotInterestedMessage {
  type: MessageType.NotInterested;
}

/**
 * Have message (id = 4)
 *
 * Announces that the sender has successfully downloaded and
 * verified a piece.
 */
export interface HaveMessage {
  type: MessageType.Have;

  /** Zero-based index of the piece */
  pieceIndex: number;
}

/**
 * Bitfield message (id = 5)
 *
 * Sent after handshake to indicate which pieces the sender has.
 * Each bit represents a piece (1 = have, 0 = don't have).
 * High bit of first byte is piece 0.
 */
export interface BitfieldMessage {
  type: MessageType.Bitfield;

  /** Bitfield buffer where each bit represents a piece */
  bitfield: Buffer;
}

/**
 * Request message (id = 6)
 *
 * Requests a block of data from a piece.
 */
export interface RequestMessage {
  type: MessageType.Request;

  /** Zero-based index of the piece */
  pieceIndex: number;

  /** Byte offset within the piece */
  begin: number;

  /** Length of the block in bytes (typically 16384) */
  length: number;
}

/**
 * Piece message (id = 7)
 *
 * Contains a block of piece data. This is the actual payload
 * data being transferred.
 */
export interface PieceMessage {
  type: MessageType.Piece;

  /** Zero-based index of the piece */
  pieceIndex: number;

  /** Byte offset within the piece */
  begin: number;

  /** The actual block data */
  block: Buffer;
}

/**
 * Cancel message (id = 8)
 *
 * Cancels a previously sent request. Has the same format as
 * the request message.
 */
export interface CancelMessage {
  type: MessageType.Cancel;

  /** Zero-based index of the piece */
  pieceIndex: number;

  /** Byte offset within the piece */
  begin: number;

  /** Length of the block that was requested */
  length: number;
}

/**
 * Union type of all peer wire protocol messages (excluding handshake)
 */
export type PeerMessage =
  | KeepAliveMessage
  | ChokeMessage
  | UnchokeMessage
  | InterestedMessage
  | NotInterestedMessage
  | HaveMessage
  | BitfieldMessage
  | RequestMessage
  | PieceMessage
  | CancelMessage;

/**
 * Decoded message result from decodeMessage
 */
export interface DecodedMessage {
  /** Message type ID (undefined for keep-alive) */
  type: MessageType | undefined;

  /** Raw payload buffer (empty for keep-alive and no-payload messages) */
  payload: Buffer;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Write a 32-bit unsigned integer in big-endian format
 *
 * @param value - The integer value to write
 * @returns A 4-byte buffer containing the value
 */
export function writeUInt32BE(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

/**
 * Read a 32-bit unsigned integer from a buffer in big-endian format
 *
 * @param buffer - The buffer to read from
 * @param offset - The byte offset to start reading (default: 0)
 * @returns The 32-bit unsigned integer value
 */
export function readUInt32BE(buffer: Buffer, offset = 0): number {
  return buffer.readUInt32BE(offset);
}

// =============================================================================
// Handshake Encoding/Decoding
// =============================================================================

/**
 * Encode a handshake message
 *
 * Creates a 68-byte handshake buffer to initiate or respond to
 * a peer connection.
 *
 * @param infoHash - 20-byte SHA-1 hash of the torrent info dictionary
 * @param peerId - 20-byte unique peer identifier
 * @param reserved - 8-byte reserved field for extensions (optional, defaults to zeros)
 * @returns 68-byte handshake buffer
 *
 * @throws Error if infoHash is not 20 bytes
 * @throws Error if peerId is not 20 bytes
 * @throws Error if reserved is provided and not 8 bytes
 *
 * @example
 * ```typescript
 * const infoHash = Buffer.from('...', 'hex'); // 20 bytes
 * const peerId = Buffer.from('-TR3000-xxxxxxxxxxxx'); // 20 bytes
 * const handshake = encodeHandshake(infoHash, peerId);
 * socket.write(handshake);
 * ```
 */
export function encodeHandshake(
  infoHash: Buffer,
  peerId: Buffer,
  reserved?: Buffer
): Buffer {
  // Validate inputs
  if (infoHash.length !== INFO_HASH_LENGTH) {
    throw new Error(
      `Invalid infoHash length: expected ${INFO_HASH_LENGTH}, got ${infoHash.length}`
    );
  }

  if (peerId.length !== PEER_ID_LENGTH) {
    throw new Error(
      `Invalid peerId length: expected ${PEER_ID_LENGTH}, got ${peerId.length}`
    );
  }

  if (reserved !== undefined && reserved.length !== RESERVED_LENGTH) {
    throw new Error(
      `Invalid reserved length: expected ${RESERVED_LENGTH}, got ${reserved.length}`
    );
  }

  // Allocate buffer for handshake
  const buffer = Buffer.allocUnsafe(HANDSHAKE_LENGTH);
  let offset = 0;

  // 1 byte: pstrlen (19)
  buffer.writeUInt8(PROTOCOL_STRING_LENGTH, offset);
  offset += 1;

  // 19 bytes: pstr ("BitTorrent protocol")
  buffer.write(PROTOCOL_STRING, offset, 'ascii');
  offset += PROTOCOL_STRING_LENGTH;

  // 8 bytes: reserved
  if (reserved) {
    reserved.copy(buffer, offset);
  } else {
    buffer.fill(0, offset, offset + RESERVED_LENGTH);
  }
  offset += RESERVED_LENGTH;

  // 20 bytes: info_hash
  infoHash.copy(buffer, offset);
  offset += INFO_HASH_LENGTH;

  // 20 bytes: peer_id
  peerId.copy(buffer, offset);

  return buffer;
}

/**
 * Decode a handshake message
 *
 * Parses a 68-byte handshake buffer and validates its contents.
 *
 * @param data - 68-byte handshake buffer
 * @returns Parsed handshake message
 *
 * @throws Error if data is not 68 bytes
 * @throws Error if protocol string length is not 19
 * @throws Error if protocol string is not "BitTorrent protocol"
 *
 * @example
 * ```typescript
 * const handshake = decodeHandshake(buffer);
 * if (handshake.infoHash.equals(expectedInfoHash)) {
 *   console.log('Peer ID:', handshake.peerId.toString());
 * }
 * ```
 */
export function decodeHandshake(data: Buffer): HandshakeMessage {
  if (data.length < HANDSHAKE_LENGTH) {
    throw new Error(
      `Invalid handshake length: expected ${HANDSHAKE_LENGTH}, got ${data.length}`
    );
  }

  let offset = 0;

  // 1 byte: pstrlen
  const pstrlen = data.readUInt8(offset);
  offset += 1;

  if (pstrlen !== PROTOCOL_STRING_LENGTH) {
    throw new Error(
      `Invalid protocol string length: expected ${PROTOCOL_STRING_LENGTH}, got ${pstrlen}`
    );
  }

  // 19 bytes: pstr
  const protocolString = data
    .subarray(offset, offset + pstrlen)
    .toString('ascii');
  offset += pstrlen;

  if (protocolString !== PROTOCOL_STRING) {
    throw new Error(
      `Invalid protocol string: expected "${PROTOCOL_STRING}", got "${protocolString}"`
    );
  }

  // 8 bytes: reserved
  const reserved = Buffer.from(data.subarray(offset, offset + RESERVED_LENGTH));
  offset += RESERVED_LENGTH;

  // 20 bytes: info_hash
  const infoHash = Buffer.from(
    data.subarray(offset, offset + INFO_HASH_LENGTH)
  );
  offset += INFO_HASH_LENGTH;

  // 20 bytes: peer_id
  const peerId = Buffer.from(data.subarray(offset, offset + PEER_ID_LENGTH));

  return {
    protocolString,
    reserved,
    infoHash,
    peerId,
  };
}

// =============================================================================
// Message Encoding
// =============================================================================

/**
 * Encode a keep-alive message
 *
 * Keep-alive messages have a length prefix of 0 and no body.
 *
 * @returns 4-byte keep-alive message
 *
 * @example
 * ```typescript
 * const keepAlive = encodeKeepAlive();
 * socket.write(keepAlive);
 * ```
 */
export function encodeKeepAlive(): Buffer {
  return Buffer.alloc(4); // 4 bytes of zeros
}

/**
 * Encode a choke message (id = 0)
 *
 * @returns 5-byte choke message
 */
export function encodeChoke(): Buffer {
  const buffer = Buffer.allocUnsafe(5);
  buffer.writeUInt32BE(1, 0); // length = 1
  buffer.writeUInt8(MessageType.Choke, 4);
  return buffer;
}

/**
 * Encode an unchoke message (id = 1)
 *
 * @returns 5-byte unchoke message
 */
export function encodeUnchoke(): Buffer {
  const buffer = Buffer.allocUnsafe(5);
  buffer.writeUInt32BE(1, 0); // length = 1
  buffer.writeUInt8(MessageType.Unchoke, 4);
  return buffer;
}

/**
 * Encode an interested message (id = 2)
 *
 * @returns 5-byte interested message
 */
export function encodeInterested(): Buffer {
  const buffer = Buffer.allocUnsafe(5);
  buffer.writeUInt32BE(1, 0); // length = 1
  buffer.writeUInt8(MessageType.Interested, 4);
  return buffer;
}

/**
 * Encode a not interested message (id = 3)
 *
 * @returns 5-byte not interested message
 */
export function encodeNotInterested(): Buffer {
  const buffer = Buffer.allocUnsafe(5);
  buffer.writeUInt32BE(1, 0); // length = 1
  buffer.writeUInt8(MessageType.NotInterested, 4);
  return buffer;
}

/**
 * Encode a have message (id = 4)
 *
 * @param pieceIndex - Zero-based index of the piece we have
 * @returns 9-byte have message
 *
 * @example
 * ```typescript
 * const have = encodeHave(42);
 * socket.write(have);
 * ```
 */
export function encodeHave(pieceIndex: number): Buffer {
  const buffer = Buffer.allocUnsafe(9);
  buffer.writeUInt32BE(5, 0); // length = 1 (id) + 4 (piece index)
  buffer.writeUInt8(MessageType.Have, 4);
  buffer.writeUInt32BE(pieceIndex, 5);
  return buffer;
}

/**
 * Encode a bitfield message (id = 5)
 *
 * @param bitfield - Buffer representing pieces we have (bit per piece)
 * @returns Bitfield message buffer
 *
 * @example
 * ```typescript
 * // Create bitfield for 16 pieces, having pieces 0, 1, and 15
 * const bitfield = Buffer.from([0b11000000, 0b00000001]);
 * const message = encodeBitfield(bitfield);
 * socket.write(message);
 * ```
 */
export function encodeBitfield(bitfield: Buffer): Buffer {
  const length = 1 + bitfield.length; // 1 (id) + bitfield
  const buffer = Buffer.allocUnsafe(4 + length);
  buffer.writeUInt32BE(length, 0);
  buffer.writeUInt8(MessageType.Bitfield, 4);
  bitfield.copy(buffer, 5);
  return buffer;
}

/**
 * Encode a request message (id = 6)
 *
 * @param pieceIndex - Zero-based index of the piece
 * @param begin - Byte offset within the piece
 * @param length - Length of the block to request
 * @returns 17-byte request message
 *
 * @example
 * ```typescript
 * const request = encodeRequest(5, 0, 16384); // Request first block of piece 5
 * socket.write(request);
 * ```
 */
export function encodeRequest(
  pieceIndex: number,
  begin: number,
  length: number
): Buffer {
  const buffer = Buffer.allocUnsafe(17);
  buffer.writeUInt32BE(13, 0); // length = 1 (id) + 4 + 4 + 4
  buffer.writeUInt8(MessageType.Request, 4);
  buffer.writeUInt32BE(pieceIndex, 5);
  buffer.writeUInt32BE(begin, 9);
  buffer.writeUInt32BE(length, 13);
  return buffer;
}

/**
 * Encode a piece message (id = 7)
 *
 * @param pieceIndex - Zero-based index of the piece
 * @param begin - Byte offset within the piece
 * @param block - The block data
 * @returns Piece message buffer
 *
 * @example
 * ```typescript
 * const block = Buffer.from('...'); // Block data
 * const piece = encodePiece(5, 0, block);
 * socket.write(piece);
 * ```
 */
export function encodePiece(
  pieceIndex: number,
  begin: number,
  block: Buffer
): Buffer {
  const length = 1 + 4 + 4 + block.length; // id + piece index + begin + block
  const buffer = Buffer.allocUnsafe(4 + length);
  buffer.writeUInt32BE(length, 0);
  buffer.writeUInt8(MessageType.Piece, 4);
  buffer.writeUInt32BE(pieceIndex, 5);
  buffer.writeUInt32BE(begin, 9);
  block.copy(buffer, 13);
  return buffer;
}

/**
 * Encode a cancel message (id = 8)
 *
 * @param pieceIndex - Zero-based index of the piece
 * @param begin - Byte offset within the piece
 * @param length - Length of the block to cancel
 * @returns 17-byte cancel message
 *
 * @example
 * ```typescript
 * const cancel = encodeCancel(5, 0, 16384); // Cancel request for first block of piece 5
 * socket.write(cancel);
 * ```
 */
export function encodeCancel(
  pieceIndex: number,
  begin: number,
  length: number
): Buffer {
  const buffer = Buffer.allocUnsafe(17);
  buffer.writeUInt32BE(13, 0); // length = 1 (id) + 4 + 4 + 4
  buffer.writeUInt8(MessageType.Cancel, 4);
  buffer.writeUInt32BE(pieceIndex, 5);
  buffer.writeUInt32BE(begin, 9);
  buffer.writeUInt32BE(length, 13);
  return buffer;
}

/**
 * Encode a generic message with type and optional payload
 *
 * This is a lower-level function for encoding any message type.
 * Prefer using the specific encode functions for type safety.
 *
 * @param type - Message type ID
 * @param payload - Optional payload buffer
 * @returns Encoded message buffer
 *
 * @example
 * ```typescript
 * // Encode a choke message manually
 * const choke = encodeMessage(MessageType.Choke);
 *
 * // Encode a have message manually
 * const payload = Buffer.allocUnsafe(4);
 * payload.writeUInt32BE(42, 0);
 * const have = encodeMessage(MessageType.Have, payload);
 * ```
 */
export function encodeMessage(type: MessageType, payload?: Buffer): Buffer {
  const payloadLength = payload ? payload.length : 0;
  const length = 1 + payloadLength; // 1 (id) + payload

  const buffer = Buffer.allocUnsafe(4 + length);
  buffer.writeUInt32BE(length, 0);
  buffer.writeUInt8(type, 4);

  if (payload) {
    payload.copy(buffer, 5);
  }

  return buffer;
}

// =============================================================================
// Message Decoding
// =============================================================================

/**
 * Decode a peer wire protocol message
 *
 * Parses a message buffer (without the 4-byte length prefix) and returns
 * the message type and payload.
 *
 * @param data - Message buffer (message id + payload, length already stripped)
 * @returns Decoded message with type and payload
 *
 * @example
 * ```typescript
 * // Assuming we've already read the length prefix and have the message body
 * const decoded = decodeMessage(messageBody);
 * if (decoded.type === MessageType.Have) {
 *   const pieceIndex = decoded.payload.readUInt32BE(0);
 *   console.log('Peer has piece:', pieceIndex);
 * }
 * ```
 */
export function decodeMessage(data: Buffer): DecodedMessage {
  // Keep-alive: empty buffer
  if (data.length === 0) {
    return {
      type: undefined,
      payload: Buffer.alloc(0),
    };
  }

  const type = data.readUInt8(0) as MessageType;
  const payload = data.subarray(1);

  return { type, payload };
}

/**
 * Decode a have message payload
 *
 * @param payload - 4-byte payload from a have message
 * @returns Have message object
 *
 * @throws Error if payload is not 4 bytes
 */
export function decodeHave(payload: Buffer): HaveMessage {
  if (payload.length !== 4) {
    throw new Error(
      `Invalid have payload length: expected 4, got ${payload.length}`
    );
  }

  return {
    type: MessageType.Have,
    pieceIndex: payload.readUInt32BE(0),
  };
}

/**
 * Decode a bitfield message payload
 *
 * @param payload - Variable-length bitfield payload
 * @returns Bitfield message object
 */
export function decodeBitfield(payload: Buffer): BitfieldMessage {
  return {
    type: MessageType.Bitfield,
    bitfield: Buffer.from(payload),
  };
}

/**
 * Decode a request message payload
 *
 * @param payload - 12-byte payload from a request message
 * @returns Request message object
 *
 * @throws Error if payload is not 12 bytes
 */
export function decodeRequest(payload: Buffer): RequestMessage {
  if (payload.length !== 12) {
    throw new Error(
      `Invalid request payload length: expected 12, got ${payload.length}`
    );
  }

  return {
    type: MessageType.Request,
    pieceIndex: payload.readUInt32BE(0),
    begin: payload.readUInt32BE(4),
    length: payload.readUInt32BE(8),
  };
}

/**
 * Decode a piece message payload
 *
 * @param payload - Variable-length payload from a piece message
 * @returns Piece message object
 *
 * @throws Error if payload is less than 8 bytes
 */
export function decodePiece(payload: Buffer): PieceMessage {
  if (payload.length < 8) {
    throw new Error(
      `Invalid piece payload length: expected at least 8, got ${payload.length}`
    );
  }

  return {
    type: MessageType.Piece,
    pieceIndex: payload.readUInt32BE(0),
    begin: payload.readUInt32BE(4),
    block: Buffer.from(payload.subarray(8)),
  };
}

/**
 * Decode a cancel message payload
 *
 * @param payload - 12-byte payload from a cancel message
 * @returns Cancel message object
 *
 * @throws Error if payload is not 12 bytes
 */
export function decodeCancel(payload: Buffer): CancelMessage {
  if (payload.length !== 12) {
    throw new Error(
      `Invalid cancel payload length: expected 12, got ${payload.length}`
    );
  }

  return {
    type: MessageType.Cancel,
    pieceIndex: payload.readUInt32BE(0),
    begin: payload.readUInt32BE(4),
    length: payload.readUInt32BE(8),
  };
}

/**
 * Parse a raw message buffer into a typed message object
 *
 * This is a convenience function that combines decodeMessage with
 * the appropriate payload decoder.
 *
 * @param data - Message buffer (message id + payload, length already stripped)
 * @returns Parsed message object
 *
 * @throws Error if message type is unknown
 * @throws Error if payload is invalid for the message type
 *
 * @example
 * ```typescript
 * const message = parseMessage(messageBody);
 * switch (message.type) {
 *   case MessageType.Have:
 *     console.log('Peer has piece:', message.pieceIndex);
 *     break;
 *   case MessageType.Piece:
 *     console.log('Received block:', message.pieceIndex, message.begin);
 *     break;
 * }
 * ```
 */
export function parseMessage(data: Buffer): PeerMessage {
  const { type, payload } = decodeMessage(data);

  // Keep-alive
  if (type === undefined) {
    return { type: 'keep-alive' };
  }

  switch (type) {
    case MessageType.Choke:
      return { type: MessageType.Choke };

    case MessageType.Unchoke:
      return { type: MessageType.Unchoke };

    case MessageType.Interested:
      return { type: MessageType.Interested };

    case MessageType.NotInterested:
      return { type: MessageType.NotInterested };

    case MessageType.Have:
      return decodeHave(payload);

    case MessageType.Bitfield:
      return decodeBitfield(payload);

    case MessageType.Request:
      return decodeRequest(payload);

    case MessageType.Piece:
      return decodePiece(payload);

    case MessageType.Cancel:
      return decodeCancel(payload);

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

// =============================================================================
// Bitfield Utilities
// =============================================================================

/**
 * Allocate an empty bitfield buffer for a given number of pieces
 *
 * @param pieceCount - Total number of pieces
 * @returns A buffer of zeros with enough bytes to represent all pieces
 *
 * @example
 * ```typescript
 * const bitfield = allocateBitfield(100); // Creates 13-byte buffer (100/8 = 12.5, rounded up)
 * ```
 */
export function allocateBitfield(pieceCount: number): Buffer {
  const byteCount = Math.ceil(pieceCount / 8);
  return Buffer.alloc(byteCount);
}

/**
 * Set a piece bit in a bitfield
 *
 * @param bitfield - The bitfield buffer to modify
 * @param pieceIndex - Zero-based index of the piece to set
 *
 * @example
 * ```typescript
 * const bitfield = createBitfield(100);
 * setBit(bitfield, 0);  // Mark piece 0 as having
 * setBit(bitfield, 42); // Mark piece 42 as having
 * ```
 */
export function setBit(bitfield: Buffer, pieceIndex: number): void {
  const byteIndex = Math.floor(pieceIndex / 8);
  const bitIndex = 7 - (pieceIndex % 8); // High bit first
  bitfield[byteIndex] |= 1 << bitIndex;
}

/**
 * Clear a piece bit in a bitfield
 *
 * @param bitfield - The bitfield buffer to modify
 * @param pieceIndex - Zero-based index of the piece to clear
 */
export function clearBit(bitfield: Buffer, pieceIndex: number): void {
  const byteIndex = Math.floor(pieceIndex / 8);
  const bitIndex = 7 - (pieceIndex % 8); // High bit first
  bitfield[byteIndex] &= ~(1 << bitIndex);
}

/**
 * Check if a piece bit is set in a bitfield
 *
 * @param bitfield - The bitfield buffer to check
 * @param pieceIndex - Zero-based index of the piece to check
 * @returns true if the piece bit is set, false otherwise
 *
 * @example
 * ```typescript
 * if (hasBit(peerBitfield, pieceIndex)) {
 *   console.log('Peer has piece:', pieceIndex);
 * }
 * ```
 */
export function hasBit(bitfield: Buffer, pieceIndex: number): boolean {
  const byteIndex = Math.floor(pieceIndex / 8);
  const bitIndex = 7 - (pieceIndex % 8); // High bit first
  return (bitfield[byteIndex] & (1 << bitIndex)) !== 0;
}

/**
 * Count the number of pieces set in a bitfield
 *
 * @param bitfield - The bitfield buffer to count
 * @returns Number of bits set (pieces available)
 */
export function countBits(bitfield: Buffer): number {
  let count = 0;
  for (let i = 0; i < bitfield.length; i++) {
    // Brian Kernighan's algorithm for counting set bits
    let b = bitfield[i];
    while (b) {
      count++;
      b &= b - 1;
    }
  }
  return count;
}

/**
 * Check if a bitfield represents a complete torrent (all pieces)
 *
 * @param bitfield - The bitfield buffer to check
 * @param pieceCount - Total number of pieces in the torrent
 * @returns true if all pieces are present
 */
export function isComplete(bitfield: Buffer, pieceCount: number): boolean {
  // Check all full bytes
  const fullBytes = Math.floor(pieceCount / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (bitfield[i] !== 0xff) {
      return false;
    }
  }

  // Check remaining bits in the last byte
  const remainingBits = pieceCount % 8;
  if (remainingBits > 0) {
    const lastByte = bitfield[fullBytes];
    const mask = 0xff << (8 - remainingBits);
    if ((lastByte & mask) !== mask) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// Message Length Calculation
// =============================================================================

/**
 * Calculate the total wire length of a message (including length prefix)
 *
 * @param type - Message type
 * @param payloadLength - Length of the payload in bytes
 * @returns Total message length in bytes
 */
export function calculateMessageLength(
  type: MessageType,
  payloadLength: number
): number {
  return MESSAGE_LENGTH_PREFIX + 1 + payloadLength; // 4 (length) + 1 (id) + payload
}

/**
 * Get the expected payload length for a message type
 *
 * @param type - Message type
 * @returns Expected payload length, or -1 for variable-length messages
 */
export function getExpectedPayloadLength(type: MessageType): number {
  switch (type) {
    case MessageType.Choke:
    case MessageType.Unchoke:
    case MessageType.Interested:
    case MessageType.NotInterested:
      return 0;

    case MessageType.Have:
      return 4;

    case MessageType.Request:
    case MessageType.Cancel:
      return 12;

    case MessageType.Bitfield:
    case MessageType.Piece:
      return -1; // Variable length

    default:
      return -1;
  }
}

/**
 * Get the human-readable name of a message type
 *
 * @param type - Message type or undefined for keep-alive
 * @returns Human-readable message name
 */
export function getMessageName(type: MessageType | undefined): string {
  if (type === undefined) {
    return 'keep-alive';
  }

  switch (type) {
    case MessageType.Choke:
      return 'choke';
    case MessageType.Unchoke:
      return 'unchoke';
    case MessageType.Interested:
      return 'interested';
    case MessageType.NotInterested:
      return 'not-interested';
    case MessageType.Have:
      return 'have';
    case MessageType.Bitfield:
      return 'bitfield';
    case MessageType.Request:
      return 'request';
    case MessageType.Piece:
      return 'piece';
    case MessageType.Cancel:
      return 'cancel';
    default:
      return `unknown(${type})`;
  }
}

// =============================================================================
// Aliases (for compatibility with protocol.ts)
// =============================================================================

/**
 * Alias for MessageType enum for backward compatibility
 */
export const MessageId = MessageType;

// Create function aliases using "create" naming convention
export const createHandshake = encodeHandshake;
export const createKeepAlive = encodeKeepAlive;
export const createChoke = encodeChoke;
export const createUnchoke = encodeUnchoke;
export const createInterested = encodeInterested;
export const createNotInterested = encodeNotInterested;
export const createHave = encodeHave;
export const createBitfield = encodeBitfield;
export const createRequest = encodeRequest;
export const createPiece = encodePiece;
export const createCancel = encodeCancel;

// Parse function alias
export const parseHandshake = decodeHandshake;

// =============================================================================
// Extended Message Encoding/Decoding (BEP 10)
// =============================================================================

/**
 * Extended message interface (BEP 10)
 */
export interface ExtendedMessage {
  type: MessageType.Extended;
  /** Extended message ID (0 = handshake, others are extension-specific) */
  extendedId: number;
  /** Message payload (bencoded for handshake, extension-specific otherwise) */
  payload: Buffer;
}

/**
 * Encode an extended message (BEP 10)
 *
 * Extended messages have message ID 20, followed by an extended message ID,
 * then the payload.
 *
 * @param extendedId - Extended message ID (0 = handshake)
 * @param payload - Message payload
 * @returns Encoded extended message
 */
export function encodeExtended(extendedId: number, payload: Buffer): Buffer {
  const length = 2 + payload.length; // 1 (msg id 20) + 1 (ext id) + payload
  const buffer = Buffer.allocUnsafe(4 + length);
  buffer.writeUInt32BE(length, 0);
  buffer.writeUInt8(MessageType.Extended, 4);
  buffer.writeUInt8(extendedId, 5);
  payload.copy(buffer, 6);
  return buffer;
}

/**
 * Decode an extended message payload
 *
 * @param payload - Payload from an extended message (after message type byte)
 * @returns Decoded extended message
 */
export function decodeExtended(payload: Buffer): ExtendedMessage {
  if (payload.length < 1) {
    throw new Error('Invalid extended message: missing extended ID');
  }

  const extendedId = payload.readUInt8(0);
  const messagePayload = payload.subarray(1);

  return {
    type: MessageType.Extended,
    extendedId,
    payload: messagePayload,
  };
}

// Alias for extended message
export const createExtended = encodeExtended;
