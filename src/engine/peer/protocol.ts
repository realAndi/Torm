/**
 * BitTorrent Wire Protocol Handler
 *
 * Implements the BitTorrent wire protocol with stream-based message parsing.
 * Handles handshakes, keep-alives, and all standard peer messages as defined
 * in BEP-3: https://www.bittorrent.org/beps/bep_0003.html
 *
 * The wire protocol is a binary protocol with the following structure:
 * - Handshake (68 bytes, no length prefix): 1 + 19 + 8 + 20 + 20 bytes
 * - Regular messages: 4-byte length prefix (big-endian) + message content
 *
 * @module engine/peer/protocol
 */

import { TypedEventEmitter } from '../events.js';
import {
  MessageType,
  PROTOCOL_STRING,
  encodeHandshake,
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
  encodeExtended,
  decodeHandshake,
  createReservedBytes,
} from './messages.js';
import type { PeerConnection } from './connection.js';

// =============================================================================
// Constants
// =============================================================================

/** Minimum message length (4 bytes for length prefix) */
const MIN_MESSAGE_LENGTH = 4;

/** Maximum message length (16 KB for piece messages + overhead) */
const MAX_MESSAGE_LENGTH = 16 * 1024 + 13;

/** Maximum block size (16 KB as per specification) */
const MAX_BLOCK_SIZE = 16 * 1024;

// =============================================================================
// Types
// =============================================================================

/**
 * Protocol state machine states.
 */
enum ProtocolState {
  /** Waiting for handshake from peer */
  WaitingHandshake = 'waiting_handshake',

  /** Active connection, processing regular messages */
  Active = 'active',

  /** Connection closed */
  Closed = 'closed',
}

/**
 * Event map for wire protocol events.
 *
 * All events and their payload types for the WireProtocol class.
 */
export interface WireProtocolEvents {
  /** Received handshake from peer */
  handshake: {
    infoHash: Buffer;
    peerId: Buffer;
    reserved: Buffer;
  };

  /** Received keep-alive message */
  keepAlive: void;

  /** Peer is choking us (not sending data) */
  choke: void;

  /** Peer unchoked us (willing to send data) */
  unchoke: void;

  /** Peer is interested in our pieces */
  interested: void;

  /** Peer is not interested in our pieces */
  notInterested: void;

  /** Peer has a piece */
  have: number;

  /** Peer's bitfield indicating which pieces they have */
  bitfield: Buffer;

  /** Peer is requesting a block */
  request: {
    pieceIndex: number;
    begin: number;
    length: number;
  };

  /** Received a piece block */
  piece: {
    pieceIndex: number;
    begin: number;
    block: Buffer;
  };

  /** Peer cancelled a previously requested block */
  cancel: {
    pieceIndex: number;
    begin: number;
    length: number;
  };

  /** Extended message (BEP 10) */
  extended: {
    extendedId: number;
    payload: Buffer;
  };

  /** Protocol error occurred */
  error: Error;

  /** Connection closed */
  close: void;

  /** Connection ended by peer */
  end: void;
}

// =============================================================================
// WireProtocol Class
// =============================================================================

/**
 * BitTorrent wire protocol handler with stream-based message parsing.
 *
 * Handles the complete BitTorrent wire protocol including:
 * - Handshake exchange
 * - Keep-alive messages
 * - Choke/unchoke/interested/not-interested state messages
 * - Have/bitfield piece availability messages
 * - Request/piece/cancel data transfer messages
 *
 * Uses a state machine to handle the protocol phases:
 * 1. WaitingHandshake: Initial state, waiting for peer handshake
 * 2. Active: Normal operation, processing regular messages
 * 3. Closed: Connection has been closed
 *
 * @example
 * ```typescript
 * const protocol = new WireProtocol(connection);
 *
 * protocol.on('handshake', ({ infoHash, peerId, reserved }) => {
 *   console.log(`Peer ${peerId.toString('hex')} connected`);
 * });
 *
 * protocol.on('piece', ({ pieceIndex, begin, block }) => {
 *   console.log(`Received block at ${pieceIndex}:${begin}`);
 * });
 *
 * protocol.on('error', (error) => {
 *   console.error('Protocol error:', error.message);
 * });
 *
 * // Send handshake to initiate connection
 * await protocol.sendHandshake(infoHash, peerId);
 * ```
 */
export class WireProtocol extends TypedEventEmitter<WireProtocolEvents> {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** The underlying peer connection */
  private readonly connection: PeerConnection;

  /** Buffer for accumulating incoming data */
  private buffer: Buffer;

  /** Current protocol state */
  private state: ProtocolState;

  /** Whether we've sent our handshake */
  private handshakeSent: boolean;

  /** Whether we've received peer's handshake */
  private handshakeReceived: boolean;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Creates a new WireProtocol handler.
   *
   * @param connection - The underlying peer connection
   */
  constructor(connection: PeerConnection) {
    super();

    this.connection = connection;
    this.buffer = Buffer.alloc(0);
    this.state = ProtocolState.WaitingHandshake;
    this.handshakeSent = false;
    this.handshakeReceived = false;

    // Bind connection events
    this.setupConnectionHandlers();
  }

  // ===========================================================================
  // Public Methods - Sending Messages
  // ===========================================================================

  /**
   * Sends a handshake message to the peer.
   *
   * The handshake is the first message sent in the protocol.
   * It identifies the torrent we want to share and our peer ID.
   *
   * @param infoHash - 20-byte info hash of the torrent
   * @param peerId - 20-byte peer ID
   * @throws {Error} If info hash or peer ID is not 20 bytes
   */
  async sendHandshake(infoHash: Buffer, peerId: Buffer): Promise<void> {
    if (infoHash.length !== 20) {
      throw new Error('info_hash must be 20 bytes');
    }
    if (peerId.length !== 20) {
      throw new Error('peer_id must be 20 bytes');
    }

    // Create reserved bytes with extension protocol support (BEP 10)
    const reserved = createReservedBytes({
      extensionProtocol: true,
    });

    const message = encodeHandshake(infoHash, peerId, reserved);
    await this.send(message);
    this.handshakeSent = true;
  }

  /**
   * Sends an extended message (BEP 10)
   *
   * @param extendedId - Extended message ID (0 = handshake)
   * @param payload - Message payload
   */
  async sendExtended(extendedId: number, payload: Buffer): Promise<void> {
    this.ensureActive();
    await this.send(encodeExtended(extendedId, payload));
  }

  /**
   * Sends a keep-alive message to the peer.
   *
   * Keep-alive messages prevent the connection from timing out.
   * They should be sent every 2 minutes if no other messages are sent.
   */
  async sendKeepAlive(): Promise<void> {
    this.ensureActive();
    await this.send(encodeKeepAlive());
  }

  /**
   * Sends a choke message to the peer.
   *
   * Indicates that we are not willing to send data to the peer.
   */
  async sendChoke(): Promise<void> {
    this.ensureActive();
    await this.send(encodeChoke());
  }

  /**
   * Sends an unchoke message to the peer.
   *
   * Indicates that we are willing to send data to the peer.
   */
  async sendUnchoke(): Promise<void> {
    this.ensureActive();
    await this.send(encodeUnchoke());
  }

  /**
   * Sends an interested message to the peer.
   *
   * Indicates that we are interested in pieces the peer has.
   */
  async sendInterested(): Promise<void> {
    this.ensureActive();
    await this.send(encodeInterested());
  }

  /**
   * Sends a not-interested message to the peer.
   *
   * Indicates that we are not interested in any pieces the peer has.
   */
  async sendNotInterested(): Promise<void> {
    this.ensureActive();
    await this.send(encodeNotInterested());
  }

  /**
   * Sends a have message to the peer.
   *
   * Indicates that we now have the specified piece.
   *
   * @param pieceIndex - Zero-based index of the piece we have
   */
  async sendHave(pieceIndex: number): Promise<void> {
    this.ensureActive();
    this.validatePieceIndex(pieceIndex);
    await this.send(encodeHave(pieceIndex));
  }

  /**
   * Sends a bitfield message to the peer.
   *
   * The bitfield indicates which pieces we have. Each bit represents
   * a piece, with the high bit of the first byte being piece 0.
   *
   * This message should only be sent immediately after the handshake.
   *
   * @param bitfield - Buffer where each bit indicates piece availability
   */
  async sendBitfield(bitfield: Buffer): Promise<void> {
    this.ensureActive();
    await this.send(encodeBitfield(bitfield));
  }

  /**
   * Sends a request message to the peer.
   *
   * Requests a block of data from the peer.
   *
   * @param pieceIndex - Zero-based index of the piece
   * @param begin - Byte offset within the piece
   * @param length - Number of bytes to request (max 16384)
   */
  async sendRequest(
    pieceIndex: number,
    begin: number,
    length: number
  ): Promise<void> {
    this.ensureActive();
    this.validatePieceIndex(pieceIndex);
    this.validateOffset(begin);
    this.validateBlockLength(length);
    await this.send(encodeRequest(pieceIndex, begin, length));
  }

  /**
   * Sends a piece message to the peer.
   *
   * Sends a block of data to the peer.
   *
   * @param pieceIndex - Zero-based index of the piece
   * @param begin - Byte offset within the piece
   * @param block - The block data
   */
  async sendPiece(
    pieceIndex: number,
    begin: number,
    block: Buffer
  ): Promise<void> {
    this.ensureActive();
    this.validatePieceIndex(pieceIndex);
    this.validateOffset(begin);

    if (block.length > MAX_BLOCK_SIZE) {
      throw new Error(
        `Block size ${block.length} exceeds maximum ${MAX_BLOCK_SIZE}`
      );
    }

    await this.send(encodePiece(pieceIndex, begin, block));
  }

  /**
   * Sends a cancel message to the peer.
   *
   * Cancels a previously sent request.
   *
   * @param pieceIndex - Zero-based index of the piece
   * @param begin - Byte offset within the piece
   * @param length - Number of bytes (must match original request)
   */
  async sendCancel(
    pieceIndex: number,
    begin: number,
    length: number
  ): Promise<void> {
    this.ensureActive();
    this.validatePieceIndex(pieceIndex);
    this.validateOffset(begin);
    this.validateBlockLength(length);
    await this.send(encodeCancel(pieceIndex, begin, length));
  }

  // ===========================================================================
  // Public Methods - Receiving
  // ===========================================================================

  /**
   * Waits for and returns the peer's handshake.
   *
   * This is a convenience method that returns a promise resolving
   * with the handshake data when received.
   *
   * @returns Promise resolving to handshake data
   */
  receiveHandshake(): Promise<{
    infoHash: Buffer;
    peerId: Buffer;
    reserved: Buffer;
  }> {
    return new Promise((resolve, reject) => {
      // If already received, resolve immediately
      if (this.handshakeReceived) {
        reject(new Error('Handshake already received'));
        return;
      }

      // Set up one-time listener for handshake
      const onHandshake = (data: {
        infoHash: Buffer;
        peerId: Buffer;
        reserved: Buffer;
      }) => {
        this.off('error', onError);
        resolve(data);
      };

      const onError = (error: Error) => {
        this.off('handshake', onHandshake);
        reject(error);
      };

      this.once('handshake', onHandshake);
      this.once('error', onError);
    });
  }

  // ===========================================================================
  // Public Methods - State
  // ===========================================================================

  /**
   * Checks if the protocol is in active state.
   *
   * @returns true if handshake is complete and connection is active
   */
  isActive(): boolean {
    return this.state === ProtocolState.Active;
  }

  /**
   * Checks if the handshake has been completed.
   *
   * @returns true if both handshakes have been exchanged
   */
  isHandshakeComplete(): boolean {
    return this.handshakeSent && this.handshakeReceived;
  }

  /**
   * Closes the protocol and cleans up resources.
   */
  close(): void {
    if (this.state === ProtocolState.Closed) {
      return;
    }

    this.state = ProtocolState.Closed;
    this.buffer = Buffer.alloc(0);
    this.emit('close');
  }

  // ===========================================================================
  // Private Methods - Connection Handling
  // ===========================================================================

  /**
   * Sets up handlers for connection events.
   */
  private setupConnectionHandlers(): void {
    this.connection.on('data', (data: Buffer) => {
      this.onData(data);
    });

    this.connection.on('close', () => {
      this.close();
    });

    this.connection.on('error', (error: Error) => {
      this.onError(error);
    });

    // Also listen for timeout as an 'end' condition
    this.connection.on('timeout', () => {
      this.emit('end');
      this.close();
    });
  }

  /**
   * Handles incoming data from the connection.
   *
   * Accumulates data in the internal buffer and attempts to
   * parse complete messages.
   */
  private onData(data: Buffer): void {
    if (this.state === ProtocolState.Closed) {
      return;
    }

    // Append data to buffer
    this.buffer = Buffer.concat([this.buffer, data]);

    // Process messages until we need more data
    try {
      this.processBuffer();
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handles connection errors.
   */
  private onError(error: Error): void {
    this.emit('error', error);
    this.close();
  }

  // ===========================================================================
  // Private Methods - Message Parsing
  // ===========================================================================

  /**
   * Processes the internal buffer, extracting and handling complete messages.
   *
   * Handles both handshake and regular message parsing based on current state.
   * Continues processing until buffer doesn't contain a complete message.
   */
  private processBuffer(): void {
    while (this.buffer.length > 0) {
      if (this.state === ProtocolState.Closed) {
        break;
      }

      let consumed: number;

      if (this.state === ProtocolState.WaitingHandshake) {
        consumed = this.tryParseHandshake();
      } else {
        consumed = this.tryParseMessage();
      }

      if (consumed === 0) {
        // Need more data
        break;
      }

      // Remove consumed bytes from buffer
      this.buffer = this.buffer.subarray(consumed);
    }
  }

  /**
   * Attempts to parse a handshake from the buffer.
   *
   * @returns Number of bytes consumed, or 0 if more data is needed
   */
  private tryParseHandshake(): number {
    // Need at least 1 byte to check protocol string length
    if (this.buffer.length < 1) {
      return 0;
    }

    const pstrLen = this.buffer[0];

    // Validate protocol string length
    if (pstrLen !== 19) {
      throw new Error(
        `Invalid protocol string length: ${pstrLen} (expected 19)`
      );
    }

    // Handshake format: 1 + pstrLen + 8 + 20 + 20 = 68 bytes
    const handshakeLength = 1 + pstrLen + 8 + 20 + 20;

    if (this.buffer.length < handshakeLength) {
      return 0;
    }

    // Extract handshake
    const handshakeData = this.buffer.subarray(0, handshakeLength);

    // Validate protocol string
    const pstr = handshakeData.subarray(1, 1 + pstrLen).toString('ascii');
    if (pstr !== PROTOCOL_STRING) {
      throw new Error(
        `Invalid protocol string: "${pstr}" (expected "${PROTOCOL_STRING}")`
      );
    }

    // Parse handshake components
    const handshake = decodeHandshake(handshakeData);

    // Transition to active state
    this.state = ProtocolState.Active;
    this.handshakeReceived = true;

    // Emit handshake event
    this.emit('handshake', {
      infoHash: handshake.infoHash,
      peerId: handshake.peerId,
      reserved: handshake.reserved,
    });

    return handshakeLength;
  }

  /**
   * Attempts to parse a regular message from the buffer.
   *
   * @returns Number of bytes consumed, or 0 if more data is needed
   */
  private tryParseMessage(): number {
    // Need at least 4 bytes for length prefix
    if (this.buffer.length < MIN_MESSAGE_LENGTH) {
      return 0;
    }

    // Read message length (big-endian)
    const messageLength = this.buffer.readUInt32BE(0);

    // Handle keep-alive (length = 0)
    if (messageLength === 0) {
      this.emit('keepAlive');
      return 4;
    }

    // Validate message length
    if (messageLength > MAX_MESSAGE_LENGTH) {
      throw new Error(
        `Message length ${messageLength} exceeds maximum ${MAX_MESSAGE_LENGTH}`
      );
    }

    // Check if we have the complete message
    const totalLength = 4 + messageLength;
    if (this.buffer.length < totalLength) {
      return 0;
    }

    // Extract message payload (excluding length prefix)
    const messageData = this.buffer.subarray(4, totalLength);

    // Parse and handle the message
    this.handleMessage(messageData);

    return totalLength;
  }

  /**
   * Handles a parsed message payload.
   *
   * @param data - Message payload (message ID + optional payload)
   */
  private handleMessage(data: Buffer): void {
    if (data.length < 1) {
      throw new Error('Empty message payload');
    }

    const messageId = data[0];
    const payload = data.subarray(1);

    switch (messageId) {
      case MessageType.Choke:
        this.handleChoke(payload);
        break;

      case MessageType.Unchoke:
        this.handleUnchoke(payload);
        break;

      case MessageType.Interested:
        this.handleInterested(payload);
        break;

      case MessageType.NotInterested:
        this.handleNotInterested(payload);
        break;

      case MessageType.Have:
        this.handleHave(payload);
        break;

      case MessageType.Bitfield:
        this.handleBitfield(payload);
        break;

      case MessageType.Request:
        this.handleRequest(payload);
        break;

      case MessageType.Piece:
        this.handlePieceMessage(payload);
        break;

      case MessageType.Cancel:
        this.handleCancel(payload);
        break;

      case MessageType.Extended:
        this.handleExtended(payload);
        break;

      default:
        // Unknown message ID - emit error but don't close
        // This allows for protocol extensions
        this.emit('error', new Error(`Unknown message ID: ${messageId}`));
    }
  }

  /**
   * Handles an extended message (BEP 10)
   */
  private handleExtended(payload: Buffer): void {
    if (payload.length < 1) {
      throw new Error('Invalid extended message: missing extended ID');
    }

    const extendedId = payload[0];
    const messagePayload = payload.subarray(1);

    this.emit('extended', { extendedId, payload: messagePayload });
  }

  /**
   * Handles a choke message.
   */
  private handleChoke(payload: Buffer): void {
    if (payload.length !== 0) {
      throw new Error(
        `Invalid choke payload length: ${payload.length} (expected 0)`
      );
    }
    this.emit('choke');
  }

  /**
   * Handles an unchoke message.
   */
  private handleUnchoke(payload: Buffer): void {
    if (payload.length !== 0) {
      throw new Error(
        `Invalid unchoke payload length: ${payload.length} (expected 0)`
      );
    }
    this.emit('unchoke');
  }

  /**
   * Handles an interested message.
   */
  private handleInterested(payload: Buffer): void {
    if (payload.length !== 0) {
      throw new Error(
        `Invalid interested payload length: ${payload.length} (expected 0)`
      );
    }
    this.emit('interested');
  }

  /**
   * Handles a not-interested message.
   */
  private handleNotInterested(payload: Buffer): void {
    if (payload.length !== 0) {
      throw new Error(
        `Invalid not-interested payload length: ${payload.length} (expected 0)`
      );
    }
    this.emit('notInterested');
  }

  /**
   * Handles a have message.
   */
  private handleHave(payload: Buffer): void {
    if (payload.length !== 4) {
      throw new Error(
        `Invalid have payload length: ${payload.length} (expected 4)`
      );
    }

    const pieceIndex = payload.readUInt32BE(0);
    this.emit('have', pieceIndex);
  }

  /**
   * Handles a bitfield message.
   */
  private handleBitfield(payload: Buffer): void {
    // Bitfield can be any length (depends on number of pieces)
    this.emit('bitfield', Buffer.from(payload));
  }

  /**
   * Handles a request message.
   */
  private handleRequest(payload: Buffer): void {
    if (payload.length !== 12) {
      throw new Error(
        `Invalid request payload length: ${payload.length} (expected 12)`
      );
    }

    const pieceIndex = payload.readUInt32BE(0);
    const begin = payload.readUInt32BE(4);
    const length = payload.readUInt32BE(8);

    // Validate block length
    if (length > MAX_BLOCK_SIZE) {
      throw new Error(
        `Requested block length ${length} exceeds maximum ${MAX_BLOCK_SIZE}`
      );
    }

    this.emit('request', { pieceIndex, begin, length });
  }

  /**
   * Handles a piece message.
   */
  private handlePieceMessage(payload: Buffer): void {
    if (payload.length < 8) {
      throw new Error(
        `Invalid piece payload length: ${payload.length} (minimum 8)`
      );
    }

    const pieceIndex = payload.readUInt32BE(0);
    const begin = payload.readUInt32BE(4);
    const block = Buffer.from(payload.subarray(8));

    this.emit('piece', { pieceIndex, begin, block });
  }

  /**
   * Handles a cancel message.
   */
  private handleCancel(payload: Buffer): void {
    if (payload.length !== 12) {
      throw new Error(
        `Invalid cancel payload length: ${payload.length} (expected 12)`
      );
    }

    const pieceIndex = payload.readUInt32BE(0);
    const begin = payload.readUInt32BE(4);
    const length = payload.readUInt32BE(8);

    this.emit('cancel', { pieceIndex, begin, length });
  }

  // ===========================================================================
  // Private Methods - Sending
  // ===========================================================================

  /**
   * Sends a message over the connection.
   *
   * @param message - The complete message buffer to send
   */
  private async send(message: Buffer): Promise<void> {
    if (this.state === ProtocolState.Closed) {
      throw new Error('Cannot send: connection is closed');
    }

    await this.connection.write(message);
  }

  // ===========================================================================
  // Private Methods - Validation
  // ===========================================================================

  /**
   * Ensures the protocol is in active state.
   *
   * @throws {Error} If protocol is not active
   */
  private ensureActive(): void {
    if (this.state !== ProtocolState.Active) {
      throw new Error(`Cannot send message: protocol state is ${this.state}`);
    }
  }

  /**
   * Validates a piece index.
   *
   * @throws {Error} If piece index is invalid
   */
  private validatePieceIndex(pieceIndex: number): void {
    if (!Number.isInteger(pieceIndex) || pieceIndex < 0) {
      throw new Error(`Invalid piece index: ${pieceIndex}`);
    }
  }

  /**
   * Validates an offset.
   *
   * @throws {Error} If offset is invalid
   */
  private validateOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`Invalid offset: ${offset}`);
    }
  }

  /**
   * Validates a block length.
   *
   * @throws {Error} If length is invalid
   */
  private validateBlockLength(length: number): void {
    if (!Number.isInteger(length) || length <= 0 || length > MAX_BLOCK_SIZE) {
      throw new Error(
        `Invalid block length: ${length} (must be 1-${MAX_BLOCK_SIZE})`
      );
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

export { ProtocolState, MAX_BLOCK_SIZE, MAX_MESSAGE_LENGTH };
