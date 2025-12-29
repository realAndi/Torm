import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WireProtocol,
  WireProtocolEvents,
  MAX_BLOCK_SIZE,
  MAX_MESSAGE_LENGTH,
} from '../../../src/engine/peer/protocol.js';
import {
  PROTOCOL_STRING,
  HANDSHAKE_LENGTH,
  MessageType,
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
} from '../../../src/engine/peer/messages.js';

// =============================================================================
// Mock PeerConnection
// =============================================================================

/**
 * Creates a mock PeerConnection for unit testing.
 * The mock maintains event listeners and allows simulating data/close/error events.
 */
function createMockConnection() {
  const listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  const writtenData: Buffer[] = [];

  return {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(listener);
    }),

    write: vi.fn(async (data: Buffer) => {
      writtenData.push(Buffer.from(data));
    }),

    // Helper to simulate receiving data
    simulateData: (data: Buffer) => {
      const dataListeners = listeners.get('data');
      if (dataListeners) {
        for (const listener of dataListeners) {
          listener(data);
        }
      }
    },

    // Helper to simulate connection close
    simulateClose: () => {
      const closeListeners = listeners.get('close');
      if (closeListeners) {
        for (const listener of closeListeners) {
          listener();
        }
      }
    },

    // Helper to simulate connection error
    simulateError: (error: Error) => {
      const errorListeners = listeners.get('error');
      if (errorListeners) {
        for (const listener of errorListeners) {
          listener(error);
        }
      }
    },

    // Helper to simulate timeout
    simulateTimeout: () => {
      const timeoutListeners = listeners.get('timeout');
      if (timeoutListeners) {
        for (const listener of timeoutListeners) {
          listener();
        }
      }
    },

    // Access written data for verification
    getWrittenData: () => writtenData,

    // Clear written data
    clearWrittenData: () => {
      writtenData.length = 0;
    },

    // Get registered listeners
    getListeners: () => listeners,
  };
}

type MockConnection = ReturnType<typeof createMockConnection>;

// =============================================================================
// Test Data Helpers
// =============================================================================

const testInfoHash = Buffer.alloc(20, 0xab);
const testPeerId = Buffer.from('-TR3000-123456789012');
const testReserved = Buffer.alloc(8, 0x00);

/**
 * Creates a valid handshake buffer for testing
 */
function createHandshakeBuffer(
  infoHash: Buffer = testInfoHash,
  peerId: Buffer = testPeerId,
  reserved: Buffer = testReserved
): Buffer {
  return encodeHandshake(infoHash, peerId, reserved);
}

/**
 * Creates a message with length prefix
 */
function createMessage(messageId: number, payload?: Buffer): Buffer {
  const payloadLength = payload ? payload.length : 0;
  const length = 1 + payloadLength;
  const buffer = Buffer.allocUnsafe(4 + length);
  buffer.writeUInt32BE(length, 0);
  buffer.writeUInt8(messageId, 4);
  if (payload) {
    payload.copy(buffer, 5);
  }
  return buffer;
}

// =============================================================================
// Tests
// =============================================================================

describe('WireProtocol', () => {
  let mockConnection: MockConnection;
  let protocol: WireProtocol;

  beforeEach(() => {
    mockConnection = createMockConnection();
    protocol = new WireProtocol(mockConnection as unknown as Parameters<typeof WireProtocol['prototype']['constructor']>[0]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create instance and set up connection handlers', () => {
      expect(protocol).toBeInstanceOf(WireProtocol);
      expect(mockConnection.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockConnection.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockConnection.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockConnection.on).toHaveBeenCalledWith('timeout', expect.any(Function));
    });

    it('should start in waiting handshake state', () => {
      expect(protocol.isActive()).toBe(false);
      expect(protocol.isHandshakeComplete()).toBe(false);
    });
  });

  // ===========================================================================
  // sendHandshake Tests
  // ===========================================================================

  describe('sendHandshake', () => {
    it('should send valid handshake message', async () => {
      await protocol.sendHandshake(testInfoHash, testPeerId);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].length).toBe(HANDSHAKE_LENGTH);

      // Verify protocol string length
      expect(writtenData[0][0]).toBe(19);

      // Verify protocol string
      const pstr = writtenData[0].subarray(1, 20).toString('ascii');
      expect(pstr).toBe(PROTOCOL_STRING);

      // Verify info hash
      const infoHash = writtenData[0].subarray(28, 48);
      expect(infoHash.equals(testInfoHash)).toBe(true);

      // Verify peer id
      const peerId = writtenData[0].subarray(48, 68);
      expect(peerId.equals(testPeerId)).toBe(true);
    });

    it('should throw error for invalid info hash length (too short)', async () => {
      const invalidInfoHash = Buffer.alloc(19);

      await expect(protocol.sendHandshake(invalidInfoHash, testPeerId)).rejects.toThrow(
        'info_hash must be 20 bytes'
      );
    });

    it('should throw error for invalid info hash length (too long)', async () => {
      const invalidInfoHash = Buffer.alloc(21);

      await expect(protocol.sendHandshake(invalidInfoHash, testPeerId)).rejects.toThrow(
        'info_hash must be 20 bytes'
      );
    });

    it('should throw error for invalid peer id length (too short)', async () => {
      const invalidPeerId = Buffer.alloc(15);

      await expect(protocol.sendHandshake(testInfoHash, invalidPeerId)).rejects.toThrow(
        'peer_id must be 20 bytes'
      );
    });

    it('should throw error for invalid peer id length (too long)', async () => {
      const invalidPeerId = Buffer.alloc(25);

      await expect(protocol.sendHandshake(testInfoHash, invalidPeerId)).rejects.toThrow(
        'peer_id must be 20 bytes'
      );
    });

    it('should throw error when connection is closed', async () => {
      protocol.close();

      await expect(protocol.sendHandshake(testInfoHash, testPeerId)).rejects.toThrow(
        'Cannot send: connection is closed'
      );
    });
  });

  // ===========================================================================
  // Simple Message Send Tests
  // ===========================================================================

  describe('sendKeepAlive', () => {
    beforeEach(async () => {
      // First receive handshake to transition to active state
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send keep-alive message', async () => {
      await protocol.sendKeepAlive();

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].length).toBe(4);
      expect(writtenData[0].readUInt32BE(0)).toBe(0); // length = 0
    });

    it('should throw error when protocol is not active', async () => {
      const newProtocol = new WireProtocol(
        createMockConnection() as unknown as Parameters<typeof WireProtocol['prototype']['constructor']>[0]
      );

      await expect(newProtocol.sendKeepAlive()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
    });
  });

  describe('sendChoke', () => {
    beforeEach(async () => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send choke message', async () => {
      await protocol.sendChoke();

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].length).toBe(5);
      expect(writtenData[0].readUInt32BE(0)).toBe(1); // length = 1
      expect(writtenData[0][4]).toBe(MessageType.Choke);
    });

    it('should throw error when protocol is not active', async () => {
      const newProtocol = new WireProtocol(
        createMockConnection() as unknown as Parameters<typeof WireProtocol['prototype']['constructor']>[0]
      );

      await expect(newProtocol.sendChoke()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
    });
  });

  describe('sendUnchoke', () => {
    beforeEach(async () => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send unchoke message', async () => {
      await protocol.sendUnchoke();

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].readUInt32BE(0)).toBe(1);
      expect(writtenData[0][4]).toBe(MessageType.Unchoke);
    });

    it('should throw error when protocol is not active', async () => {
      const newProtocol = new WireProtocol(
        createMockConnection() as unknown as Parameters<typeof WireProtocol['prototype']['constructor']>[0]
      );

      await expect(newProtocol.sendUnchoke()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
    });
  });

  describe('sendInterested', () => {
    beforeEach(async () => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send interested message', async () => {
      await protocol.sendInterested();

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].readUInt32BE(0)).toBe(1);
      expect(writtenData[0][4]).toBe(MessageType.Interested);
    });

    it('should throw error when protocol is not active', async () => {
      const newProtocol = new WireProtocol(
        createMockConnection() as unknown as Parameters<typeof WireProtocol['prototype']['constructor']>[0]
      );

      await expect(newProtocol.sendInterested()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
    });
  });

  describe('sendNotInterested', () => {
    beforeEach(async () => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send not-interested message', async () => {
      await protocol.sendNotInterested();

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].readUInt32BE(0)).toBe(1);
      expect(writtenData[0][4]).toBe(MessageType.NotInterested);
    });

    it('should throw error when protocol is not active', async () => {
      const newProtocol = new WireProtocol(
        createMockConnection() as unknown as Parameters<typeof WireProtocol['prototype']['constructor']>[0]
      );

      await expect(newProtocol.sendNotInterested()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
    });
  });

  // ===========================================================================
  // sendHave Tests
  // ===========================================================================

  describe('sendHave', () => {
    beforeEach(async () => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send have message with valid piece index', async () => {
      await protocol.sendHave(42);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].length).toBe(9);
      expect(writtenData[0].readUInt32BE(0)).toBe(5); // length = 1 + 4
      expect(writtenData[0][4]).toBe(MessageType.Have);
      expect(writtenData[0].readUInt32BE(5)).toBe(42);
    });

    it('should send have message with piece index 0', async () => {
      await protocol.sendHave(0);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData[0].readUInt32BE(5)).toBe(0);
    });

    it('should send have message with large piece index', async () => {
      const largeIndex = 999999;
      await protocol.sendHave(largeIndex);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData[0].readUInt32BE(5)).toBe(largeIndex);
    });

    it('should throw error for negative piece index', async () => {
      await expect(protocol.sendHave(-1)).rejects.toThrow('Invalid piece index: -1');
    });

    it('should throw error for non-integer piece index', async () => {
      await expect(protocol.sendHave(3.5)).rejects.toThrow('Invalid piece index: 3.5');
    });

    it('should throw error for NaN piece index', async () => {
      await expect(protocol.sendHave(NaN)).rejects.toThrow('Invalid piece index: NaN');
    });
  });

  // ===========================================================================
  // sendBitfield Tests
  // ===========================================================================

  describe('sendBitfield', () => {
    beforeEach(async () => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send bitfield message', async () => {
      const bitfield = Buffer.from([0b11110000, 0b00001111]);
      await protocol.sendBitfield(bitfield);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].length).toBe(4 + 1 + bitfield.length);
      expect(writtenData[0].readUInt32BE(0)).toBe(1 + bitfield.length);
      expect(writtenData[0][4]).toBe(MessageType.Bitfield);
      expect(writtenData[0].subarray(5).equals(bitfield)).toBe(true);
    });

    it('should send empty bitfield', async () => {
      const bitfield = Buffer.alloc(0);
      await protocol.sendBitfield(bitfield);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData[0].readUInt32BE(0)).toBe(1);
    });

    it('should send large bitfield', async () => {
      const bitfield = Buffer.alloc(1000, 0xff);
      await protocol.sendBitfield(bitfield);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData[0].readUInt32BE(0)).toBe(1 + 1000);
    });
  });

  // ===========================================================================
  // sendRequest Tests
  // ===========================================================================

  describe('sendRequest', () => {
    beforeEach(async () => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send request message with valid parameters', async () => {
      await protocol.sendRequest(5, 16384, 16384);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].length).toBe(17);
      expect(writtenData[0].readUInt32BE(0)).toBe(13); // length = 1 + 4 + 4 + 4
      expect(writtenData[0][4]).toBe(MessageType.Request);
      expect(writtenData[0].readUInt32BE(5)).toBe(5); // piece index
      expect(writtenData[0].readUInt32BE(9)).toBe(16384); // begin
      expect(writtenData[0].readUInt32BE(13)).toBe(16384); // length
    });

    it('should send request with minimum block length', async () => {
      await protocol.sendRequest(0, 0, 1);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData[0].readUInt32BE(13)).toBe(1);
    });

    it('should send request with maximum block length', async () => {
      await protocol.sendRequest(0, 0, MAX_BLOCK_SIZE);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData[0].readUInt32BE(13)).toBe(MAX_BLOCK_SIZE);
    });

    it('should throw error for negative piece index', async () => {
      await expect(protocol.sendRequest(-1, 0, 16384)).rejects.toThrow(
        'Invalid piece index: -1'
      );
    });

    it('should throw error for negative offset', async () => {
      await expect(protocol.sendRequest(0, -1, 16384)).rejects.toThrow(
        'Invalid offset: -1'
      );
    });

    it('should throw error for zero length', async () => {
      await expect(protocol.sendRequest(0, 0, 0)).rejects.toThrow(
        'Invalid block length: 0'
      );
    });

    it('should throw error for negative length', async () => {
      await expect(protocol.sendRequest(0, 0, -1)).rejects.toThrow(
        'Invalid block length: -1'
      );
    });

    it('should throw error for length exceeding MAX_BLOCK_SIZE', async () => {
      await expect(protocol.sendRequest(0, 0, MAX_BLOCK_SIZE + 1)).rejects.toThrow(
        `Invalid block length: ${MAX_BLOCK_SIZE + 1}`
      );
    });
  });

  // ===========================================================================
  // sendPiece Tests
  // ===========================================================================

  describe('sendPiece', () => {
    beforeEach(async () => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send piece message with valid parameters', async () => {
      const block = Buffer.alloc(16384, 0xaa);
      await protocol.sendPiece(5, 0, block);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].length).toBe(4 + 1 + 4 + 4 + block.length);
      expect(writtenData[0].readUInt32BE(0)).toBe(1 + 4 + 4 + block.length);
      expect(writtenData[0][4]).toBe(MessageType.Piece);
      expect(writtenData[0].readUInt32BE(5)).toBe(5); // piece index
      expect(writtenData[0].readUInt32BE(9)).toBe(0); // begin
      expect(writtenData[0].subarray(13).equals(block)).toBe(true);
    });

    it('should send piece with small block', async () => {
      const block = Buffer.alloc(100, 0xbb);
      await protocol.sendPiece(0, 1000, block);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData[0].subarray(13).length).toBe(100);
    });

    it('should send piece with maximum block size', async () => {
      const block = Buffer.alloc(MAX_BLOCK_SIZE, 0xcc);
      await protocol.sendPiece(0, 0, block);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData[0].subarray(13).length).toBe(MAX_BLOCK_SIZE);
    });

    it('should throw error for block exceeding MAX_BLOCK_SIZE', async () => {
      const block = Buffer.alloc(MAX_BLOCK_SIZE + 1);

      await expect(protocol.sendPiece(0, 0, block)).rejects.toThrow(
        `Block size ${MAX_BLOCK_SIZE + 1} exceeds maximum ${MAX_BLOCK_SIZE}`
      );
    });

    it('should throw error for negative piece index', async () => {
      const block = Buffer.alloc(100);

      await expect(protocol.sendPiece(-1, 0, block)).rejects.toThrow(
        'Invalid piece index: -1'
      );
    });

    it('should throw error for negative offset', async () => {
      const block = Buffer.alloc(100);

      await expect(protocol.sendPiece(0, -1, block)).rejects.toThrow(
        'Invalid offset: -1'
      );
    });
  });

  // ===========================================================================
  // sendCancel Tests
  // ===========================================================================

  describe('sendCancel', () => {
    beforeEach(async () => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should send cancel message with valid parameters', async () => {
      await protocol.sendCancel(5, 16384, 16384);

      const writtenData = mockConnection.getWrittenData();
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].length).toBe(17);
      expect(writtenData[0].readUInt32BE(0)).toBe(13);
      expect(writtenData[0][4]).toBe(MessageType.Cancel);
      expect(writtenData[0].readUInt32BE(5)).toBe(5);
      expect(writtenData[0].readUInt32BE(9)).toBe(16384);
      expect(writtenData[0].readUInt32BE(13)).toBe(16384);
    });

    it('should throw error for negative piece index', async () => {
      await expect(protocol.sendCancel(-1, 0, 16384)).rejects.toThrow(
        'Invalid piece index: -1'
      );
    });

    it('should throw error for negative offset', async () => {
      await expect(protocol.sendCancel(0, -1, 16384)).rejects.toThrow(
        'Invalid offset: -1'
      );
    });

    it('should throw error for invalid length', async () => {
      await expect(protocol.sendCancel(0, 0, 0)).rejects.toThrow(
        'Invalid block length: 0'
      );
    });

    it('should throw error for length exceeding MAX_BLOCK_SIZE', async () => {
      await expect(protocol.sendCancel(0, 0, MAX_BLOCK_SIZE + 1)).rejects.toThrow(
        `Invalid block length: ${MAX_BLOCK_SIZE + 1}`
      );
    });
  });

  // ===========================================================================
  // receiveHandshake Tests
  // ===========================================================================

  describe('receiveHandshake', () => {
    it('should resolve with handshake data when handshake is received', async () => {
      const handshakePromise = protocol.receiveHandshake();

      // Simulate receiving handshake
      mockConnection.simulateData(createHandshakeBuffer());

      const result = await handshakePromise;
      expect(result.infoHash.equals(testInfoHash)).toBe(true);
      expect(result.peerId.equals(testPeerId)).toBe(true);
      expect(result.reserved.equals(testReserved)).toBe(true);
    });

    it('should reject if handshake already received', async () => {
      // First, receive a handshake
      mockConnection.simulateData(createHandshakeBuffer());

      // Wait for the handshake event to be processed
      await new Promise(resolve => setImmediate(resolve));

      // Now try to call receiveHandshake
      await expect(protocol.receiveHandshake()).rejects.toThrow(
        'Handshake already received'
      );
    });

    it('should reject if error occurs before handshake', async () => {
      const handshakePromise = protocol.receiveHandshake();

      // Simulate error
      mockConnection.simulateError(new Error('Connection failed'));

      await expect(handshakePromise).rejects.toThrow('Connection failed');
    });
  });

  // ===========================================================================
  // State Methods Tests
  // ===========================================================================

  describe('isActive', () => {
    it('should return false before handshake', () => {
      expect(protocol.isActive()).toBe(false);
    });

    it('should return true after handshake received', () => {
      mockConnection.simulateData(createHandshakeBuffer());
      expect(protocol.isActive()).toBe(true);
    });

    it('should return false after close', () => {
      mockConnection.simulateData(createHandshakeBuffer());
      protocol.close();
      expect(protocol.isActive()).toBe(false);
    });
  });

  describe('isHandshakeComplete', () => {
    it('should return false initially', () => {
      expect(protocol.isHandshakeComplete()).toBe(false);
    });

    it('should return false after only sending handshake', async () => {
      await protocol.sendHandshake(testInfoHash, testPeerId);
      expect(protocol.isHandshakeComplete()).toBe(false);
    });

    it('should return false after only receiving handshake', () => {
      mockConnection.simulateData(createHandshakeBuffer());
      expect(protocol.isHandshakeComplete()).toBe(false);
    });

    it('should return true after both sending and receiving handshake', async () => {
      await protocol.sendHandshake(testInfoHash, testPeerId);
      mockConnection.simulateData(createHandshakeBuffer());
      expect(protocol.isHandshakeComplete()).toBe(true);
    });
  });

  describe('close', () => {
    it('should emit close event', () => {
      const closeHandler = vi.fn();
      protocol.on('close', closeHandler);

      protocol.close();

      expect(closeHandler).toHaveBeenCalledTimes(1);
    });

    it('should not emit close event twice', () => {
      const closeHandler = vi.fn();
      protocol.on('close', closeHandler);

      protocol.close();
      protocol.close();

      expect(closeHandler).toHaveBeenCalledTimes(1);
    });

    it('should clear buffer on close', () => {
      mockConnection.simulateData(createHandshakeBuffer());
      protocol.close();

      // Further data should be ignored
      const dataHandler = vi.fn();
      protocol.on('piece', dataHandler);

      const pieceMessage = encodePiece(0, 0, Buffer.alloc(100));
      mockConnection.simulateData(pieceMessage);

      expect(dataHandler).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Stream Parsing Tests - Handshake
  // ===========================================================================

  describe('stream parsing - handshake', () => {
    it('should parse complete handshake in single data event', () => {
      const handshakeHandler = vi.fn();
      protocol.on('handshake', handshakeHandler);

      mockConnection.simulateData(createHandshakeBuffer());

      expect(handshakeHandler).toHaveBeenCalledTimes(1);
      expect(handshakeHandler).toHaveBeenCalledWith({
        infoHash: testInfoHash,
        peerId: testPeerId,
        reserved: testReserved,
      });
    });

    it('should parse handshake received in multiple chunks', () => {
      const handshakeHandler = vi.fn();
      protocol.on('handshake', handshakeHandler);

      const handshake = createHandshakeBuffer();

      // Send in 3 chunks
      mockConnection.simulateData(handshake.subarray(0, 20));
      expect(handshakeHandler).not.toHaveBeenCalled();

      mockConnection.simulateData(handshake.subarray(20, 50));
      expect(handshakeHandler).not.toHaveBeenCalled();

      mockConnection.simulateData(handshake.subarray(50));
      expect(handshakeHandler).toHaveBeenCalledTimes(1);
    });

    it('should parse handshake received byte by byte', () => {
      const handshakeHandler = vi.fn();
      protocol.on('handshake', handshakeHandler);

      const handshake = createHandshakeBuffer();

      // Send byte by byte
      for (let i = 0; i < handshake.length - 1; i++) {
        mockConnection.simulateData(handshake.subarray(i, i + 1));
        expect(handshakeHandler).not.toHaveBeenCalled();
      }

      // Send last byte
      mockConnection.simulateData(handshake.subarray(handshake.length - 1));
      expect(handshakeHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit error for invalid protocol string length', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Create handshake with wrong protocol string length
      const invalidHandshake = Buffer.alloc(68);
      invalidHandshake[0] = 18; // Wrong length (should be 19)

      mockConnection.simulateData(invalidHandshake);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid protocol string length');
    });

    it('should emit error for invalid protocol string', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Create handshake with wrong protocol string
      const invalidHandshake = Buffer.alloc(68);
      invalidHandshake[0] = 19;
      invalidHandshake.write('WrongTorrent proto!', 1, 'ascii'); // Wrong protocol string

      mockConnection.simulateData(invalidHandshake);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid protocol string');
    });

    it('should handle handshake followed by message in same data event', () => {
      const handshakeHandler = vi.fn();
      const keepAliveHandler = vi.fn();
      protocol.on('handshake', handshakeHandler);
      protocol.on('keepAlive', keepAliveHandler);

      const handshake = createHandshakeBuffer();
      const keepAlive = encodeKeepAlive();
      const combined = Buffer.concat([handshake, keepAlive]);

      mockConnection.simulateData(combined);

      expect(handshakeHandler).toHaveBeenCalledTimes(1);
      expect(keepAliveHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Stream Parsing Tests - Keep-Alive
  // ===========================================================================

  describe('stream parsing - keep-alive', () => {
    beforeEach(() => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should parse keep-alive message (length = 0)', () => {
      const keepAliveHandler = vi.fn();
      protocol.on('keepAlive', keepAliveHandler);

      mockConnection.simulateData(encodeKeepAlive());

      expect(keepAliveHandler).toHaveBeenCalledTimes(1);
    });

    it('should parse multiple keep-alive messages', () => {
      const keepAliveHandler = vi.fn();
      protocol.on('keepAlive', keepAliveHandler);

      const multipleKeepAlives = Buffer.concat([
        encodeKeepAlive(),
        encodeKeepAlive(),
        encodeKeepAlive(),
      ]);

      mockConnection.simulateData(multipleKeepAlives);

      expect(keepAliveHandler).toHaveBeenCalledTimes(3);
    });
  });

  // ===========================================================================
  // Stream Parsing Tests - Regular Messages
  // ===========================================================================

  describe('stream parsing - regular messages', () => {
    beforeEach(() => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should parse choke message', () => {
      const chokeHandler = vi.fn();
      protocol.on('choke', chokeHandler);

      mockConnection.simulateData(encodeChoke());

      expect(chokeHandler).toHaveBeenCalledTimes(1);
    });

    it('should parse unchoke message', () => {
      const unchokeHandler = vi.fn();
      protocol.on('unchoke', unchokeHandler);

      mockConnection.simulateData(encodeUnchoke());

      expect(unchokeHandler).toHaveBeenCalledTimes(1);
    });

    it('should parse interested message', () => {
      const interestedHandler = vi.fn();
      protocol.on('interested', interestedHandler);

      mockConnection.simulateData(encodeInterested());

      expect(interestedHandler).toHaveBeenCalledTimes(1);
    });

    it('should parse not-interested message', () => {
      const notInterestedHandler = vi.fn();
      protocol.on('notInterested', notInterestedHandler);

      mockConnection.simulateData(encodeNotInterested());

      expect(notInterestedHandler).toHaveBeenCalledTimes(1);
    });

    it('should parse have message', () => {
      const haveHandler = vi.fn();
      protocol.on('have', haveHandler);

      mockConnection.simulateData(encodeHave(42));

      expect(haveHandler).toHaveBeenCalledTimes(1);
      expect(haveHandler).toHaveBeenCalledWith(42);
    });

    it('should parse bitfield message', () => {
      const bitfieldHandler = vi.fn();
      protocol.on('bitfield', bitfieldHandler);

      const bitfield = Buffer.from([0xff, 0x00, 0xaa]);
      mockConnection.simulateData(encodeBitfield(bitfield));

      expect(bitfieldHandler).toHaveBeenCalledTimes(1);
      expect(bitfieldHandler.mock.calls[0][0].equals(bitfield)).toBe(true);
    });

    it('should parse request message', () => {
      const requestHandler = vi.fn();
      protocol.on('request', requestHandler);

      mockConnection.simulateData(encodeRequest(5, 16384, 16384));

      expect(requestHandler).toHaveBeenCalledTimes(1);
      expect(requestHandler).toHaveBeenCalledWith({
        pieceIndex: 5,
        begin: 16384,
        length: 16384,
      });
    });

    it('should parse piece message', () => {
      const pieceHandler = vi.fn();
      protocol.on('piece', pieceHandler);

      const block = Buffer.alloc(100, 0xab);
      mockConnection.simulateData(encodePiece(5, 16384, block));

      expect(pieceHandler).toHaveBeenCalledTimes(1);
      expect(pieceHandler.mock.calls[0][0].pieceIndex).toBe(5);
      expect(pieceHandler.mock.calls[0][0].begin).toBe(16384);
      expect(pieceHandler.mock.calls[0][0].block.equals(block)).toBe(true);
    });

    it('should parse cancel message', () => {
      const cancelHandler = vi.fn();
      protocol.on('cancel', cancelHandler);

      mockConnection.simulateData(encodeCancel(5, 16384, 16384));

      expect(cancelHandler).toHaveBeenCalledTimes(1);
      expect(cancelHandler).toHaveBeenCalledWith({
        pieceIndex: 5,
        begin: 16384,
        length: 16384,
      });
    });
  });

  // ===========================================================================
  // Stream Parsing Tests - Partial Messages
  // ===========================================================================

  describe('stream parsing - partial messages (buffer accumulation)', () => {
    beforeEach(() => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should accumulate partial message and parse when complete', () => {
      const pieceHandler = vi.fn();
      protocol.on('piece', pieceHandler);

      const block = Buffer.alloc(1000, 0xcc);
      const pieceMessage = encodePiece(10, 0, block);

      // Send in chunks
      mockConnection.simulateData(pieceMessage.subarray(0, 5));
      expect(pieceHandler).not.toHaveBeenCalled();

      mockConnection.simulateData(pieceMessage.subarray(5, 100));
      expect(pieceHandler).not.toHaveBeenCalled();

      mockConnection.simulateData(pieceMessage.subarray(100));
      expect(pieceHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle length prefix split across data events', () => {
      const haveHandler = vi.fn();
      protocol.on('have', haveHandler);

      const haveMessage = encodeHave(999);

      // Send length prefix byte by byte
      mockConnection.simulateData(haveMessage.subarray(0, 1));
      mockConnection.simulateData(haveMessage.subarray(1, 2));
      mockConnection.simulateData(haveMessage.subarray(2, 3));
      mockConnection.simulateData(haveMessage.subarray(3, 4));

      expect(haveHandler).not.toHaveBeenCalled();

      // Send rest of message
      mockConnection.simulateData(haveMessage.subarray(4));
      expect(haveHandler).toHaveBeenCalledTimes(1);
      expect(haveHandler).toHaveBeenCalledWith(999);
    });

    it('should handle message split at arbitrary points', () => {
      const requestHandler = vi.fn();
      protocol.on('request', requestHandler);

      const requestMessage = encodeRequest(100, 50000, 8192);

      // Split at each byte position
      for (let splitPoint = 1; splitPoint < requestMessage.length; splitPoint++) {
        const newMock = createMockConnection();
        const newProtocol = new WireProtocol(
          newMock as unknown as Parameters<typeof WireProtocol['prototype']['constructor']>[0]
        );
        const handler = vi.fn();
        newProtocol.on('request', handler);

        // Transition to active state
        newMock.simulateData(createHandshakeBuffer());

        // Send split message
        newMock.simulateData(requestMessage.subarray(0, splitPoint));
        newMock.simulateData(requestMessage.subarray(splitPoint));

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({
          pieceIndex: 100,
          begin: 50000,
          length: 8192,
        });
      }
    });
  });

  // ===========================================================================
  // Stream Parsing Tests - Multiple Messages
  // ===========================================================================

  describe('stream parsing - multiple messages in single data event', () => {
    beforeEach(() => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should parse multiple messages in single data event', () => {
      const chokeHandler = vi.fn();
      const unchokeHandler = vi.fn();
      const interestedHandler = vi.fn();
      const haveHandler = vi.fn();

      protocol.on('choke', chokeHandler);
      protocol.on('unchoke', unchokeHandler);
      protocol.on('interested', interestedHandler);
      protocol.on('have', haveHandler);

      const combined = Buffer.concat([
        encodeChoke(),
        encodeUnchoke(),
        encodeInterested(),
        encodeHave(42),
      ]);

      mockConnection.simulateData(combined);

      expect(chokeHandler).toHaveBeenCalledTimes(1);
      expect(unchokeHandler).toHaveBeenCalledTimes(1);
      expect(interestedHandler).toHaveBeenCalledTimes(1);
      expect(haveHandler).toHaveBeenCalledTimes(1);
      expect(haveHandler).toHaveBeenCalledWith(42);
    });

    it('should parse multiple messages with partial trailing message', () => {
      const chokeHandler = vi.fn();
      const pieceHandler = vi.fn();

      protocol.on('choke', chokeHandler);
      protocol.on('piece', pieceHandler);

      const block = Buffer.alloc(500, 0xdd);
      const pieceMessage = encodePiece(1, 0, block);

      // Send choke + partial piece
      const combined1 = Buffer.concat([
        encodeChoke(),
        pieceMessage.subarray(0, 100),
      ]);
      mockConnection.simulateData(combined1);

      expect(chokeHandler).toHaveBeenCalledTimes(1);
      expect(pieceHandler).not.toHaveBeenCalled();

      // Send rest of piece
      mockConnection.simulateData(pieceMessage.subarray(100));
      expect(pieceHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle sequence of keep-alives and regular messages', () => {
      const keepAliveHandler = vi.fn();
      const haveHandler = vi.fn();

      protocol.on('keepAlive', keepAliveHandler);
      protocol.on('have', haveHandler);

      const combined = Buffer.concat([
        encodeKeepAlive(),
        encodeHave(1),
        encodeKeepAlive(),
        encodeHave(2),
        encodeKeepAlive(),
      ]);

      mockConnection.simulateData(combined);

      expect(keepAliveHandler).toHaveBeenCalledTimes(3);
      expect(haveHandler).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // Stream Parsing Tests - Error Handling
  // ===========================================================================

  describe('stream parsing - error handling', () => {
    beforeEach(() => {
      mockConnection.simulateData(createHandshakeBuffer());
    });

    it('should emit error for oversized message', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Create a message with length exceeding MAX_MESSAGE_LENGTH
      const oversizedLength = MAX_MESSAGE_LENGTH + 1;
      const lengthPrefix = Buffer.allocUnsafe(4);
      lengthPrefix.writeUInt32BE(oversizedLength, 0);

      mockConnection.simulateData(lengthPrefix);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('exceeds maximum');
    });

    it('should emit error for unknown message type', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Create message with unknown type (99)
      const unknownMessage = createMessage(99);

      mockConnection.simulateData(unknownMessage);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Unknown message ID: 99');
    });

    it('should emit error for invalid choke payload length', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Create choke with extra payload
      const invalidChoke = createMessage(MessageType.Choke, Buffer.alloc(1));

      mockConnection.simulateData(invalidChoke);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid choke payload length');
    });

    it('should emit error for invalid unchoke payload length', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      const invalidUnchoke = createMessage(MessageType.Unchoke, Buffer.alloc(5));

      mockConnection.simulateData(invalidUnchoke);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid unchoke payload length');
    });

    it('should emit error for invalid interested payload length', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      const invalidInterested = createMessage(MessageType.Interested, Buffer.alloc(2));

      mockConnection.simulateData(invalidInterested);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid interested payload length');
    });

    it('should emit error for invalid not-interested payload length', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      const invalidNotInterested = createMessage(MessageType.NotInterested, Buffer.alloc(3));

      mockConnection.simulateData(invalidNotInterested);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid not-interested payload length');
    });

    it('should emit error for invalid have payload length', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Have should have exactly 4 bytes
      const invalidHave = createMessage(MessageType.Have, Buffer.alloc(3));

      mockConnection.simulateData(invalidHave);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid have payload length');
    });

    it('should emit error for invalid request payload length', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Request should have exactly 12 bytes
      const invalidRequest = createMessage(MessageType.Request, Buffer.alloc(11));

      mockConnection.simulateData(invalidRequest);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid request payload length');
    });

    it('should emit error for request with oversized block length', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Create request with length > MAX_BLOCK_SIZE
      const payload = Buffer.allocUnsafe(12);
      payload.writeUInt32BE(0, 0); // piece index
      payload.writeUInt32BE(0, 4); // begin
      payload.writeUInt32BE(MAX_BLOCK_SIZE + 1, 8); // oversized length

      const invalidRequest = createMessage(MessageType.Request, payload);

      mockConnection.simulateData(invalidRequest);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('exceeds maximum');
    });

    it('should emit error for piece message with payload less than 8 bytes', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Piece needs at least 8 bytes (4 for index + 4 for begin)
      const invalidPiece = createMessage(MessageType.Piece, Buffer.alloc(7));

      mockConnection.simulateData(invalidPiece);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid piece payload length');
    });

    it('should emit error for invalid cancel payload length', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      // Cancel should have exactly 12 bytes
      const invalidCancel = createMessage(MessageType.Cancel, Buffer.alloc(13));

      mockConnection.simulateData(invalidCancel);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toContain('Invalid cancel payload length');
    });

    it('should close connection on parsing error', () => {
      const closeHandler = vi.fn();
      const errorHandler = vi.fn();
      protocol.on('close', closeHandler);
      protocol.on('error', errorHandler);

      // Trigger a parsing error by sending oversized message
      const oversizedLength = MAX_MESSAGE_LENGTH + 1;
      const lengthPrefix = Buffer.allocUnsafe(4);
      lengthPrefix.writeUInt32BE(oversizedLength, 0);

      mockConnection.simulateData(lengthPrefix);

      // Error should be emitted and connection closed
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(closeHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Protocol State Machine Tests
  // ===========================================================================

  describe('protocol state machine', () => {
    it('should transition from WaitingHandshake to Active after handshake', () => {
      expect(protocol.isActive()).toBe(false);

      mockConnection.simulateData(createHandshakeBuffer());

      expect(protocol.isActive()).toBe(true);
    });

    it('should transition from Active to Closed on close()', () => {
      mockConnection.simulateData(createHandshakeBuffer());
      expect(protocol.isActive()).toBe(true);

      protocol.close();

      expect(protocol.isActive()).toBe(false);
    });

    it('should restrict sending regular messages before handshake', async () => {
      await expect(protocol.sendKeepAlive()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
      await expect(protocol.sendChoke()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
      await expect(protocol.sendUnchoke()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
      await expect(protocol.sendInterested()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
      await expect(protocol.sendNotInterested()).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
      await expect(protocol.sendHave(0)).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
      await expect(protocol.sendBitfield(Buffer.alloc(1))).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
      await expect(protocol.sendRequest(0, 0, 16384)).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
      await expect(protocol.sendPiece(0, 0, Buffer.alloc(100))).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
      await expect(protocol.sendCancel(0, 0, 16384)).rejects.toThrow(
        'Cannot send message: protocol state is waiting_handshake'
      );
    });

    it('should allow sending handshake in WaitingHandshake state', async () => {
      await expect(protocol.sendHandshake(testInfoHash, testPeerId)).resolves.toBeUndefined();
    });

    it('should restrict sending messages after close', async () => {
      mockConnection.simulateData(createHandshakeBuffer());
      protocol.close();

      await expect(protocol.sendKeepAlive()).rejects.toThrow(
        'Cannot send message: protocol state is closed'
      );
      await expect(protocol.sendChoke()).rejects.toThrow(
        'Cannot send message: protocol state is closed'
      );
      await expect(protocol.sendHandshake(testInfoHash, testPeerId)).rejects.toThrow(
        'Cannot send: connection is closed'
      );
    });

    it('should ignore data after close', () => {
      mockConnection.simulateData(createHandshakeBuffer());
      protocol.close();

      const haveHandler = vi.fn();
      protocol.on('have', haveHandler);

      mockConnection.simulateData(encodeHave(42));

      expect(haveHandler).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Connection Event Handling Tests
  // ===========================================================================

  describe('connection event handling', () => {
    it('should emit close event when connection closes', () => {
      const closeHandler = vi.fn();
      protocol.on('close', closeHandler);

      mockConnection.simulateClose();

      expect(closeHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit error event when connection has error', () => {
      const errorHandler = vi.fn();
      protocol.on('error', errorHandler);

      const testError = new Error('Connection error');
      mockConnection.simulateError(testError);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(testError);
    });

    it('should emit end event on timeout', () => {
      const endHandler = vi.fn();
      protocol.on('end', endHandler);

      mockConnection.simulateTimeout();

      expect(endHandler).toHaveBeenCalledTimes(1);
    });

    it('should close protocol on timeout', () => {
      const closeHandler = vi.fn();
      protocol.on('close', closeHandler);

      mockConnection.simulateTimeout();

      expect(closeHandler).toHaveBeenCalledTimes(1);
    });

    it('should close protocol on connection error', () => {
      // The protocol needs to catch and handle the error event properly
      // Set up handlers before triggering the error
      const closeHandler = vi.fn();
      const errorHandler = vi.fn();
      protocol.on('close', closeHandler);
      protocol.on('error', errorHandler);

      // Simulate connection error - this calls the error handler set up in constructor
      mockConnection.simulateError(new Error('Test error'));

      // The error handler emits error event and then closes
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toBe('Test error');
      expect(closeHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Edge Cases Tests
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty data event', () => {
      expect(() => {
        mockConnection.simulateData(Buffer.alloc(0));
      }).not.toThrow();
    });

    it('should handle very large piece messages', () => {
      mockConnection.simulateData(createHandshakeBuffer());

      const pieceHandler = vi.fn();
      protocol.on('piece', pieceHandler);

      const largeBlock = Buffer.alloc(MAX_BLOCK_SIZE, 0xee);
      mockConnection.simulateData(encodePiece(0, 0, largeBlock));

      expect(pieceHandler).toHaveBeenCalledTimes(1);
      expect(pieceHandler.mock.calls[0][0].block.length).toBe(MAX_BLOCK_SIZE);
    });

    it('should handle piece with zero-length block', () => {
      mockConnection.simulateData(createHandshakeBuffer());

      const pieceHandler = vi.fn();
      protocol.on('piece', pieceHandler);

      const emptyBlock = Buffer.alloc(0);
      mockConnection.simulateData(encodePiece(0, 0, emptyBlock));

      expect(pieceHandler).toHaveBeenCalledTimes(1);
      expect(pieceHandler.mock.calls[0][0].block.length).toBe(0);
    });

    it('should handle bitfield with all zeros', () => {
      mockConnection.simulateData(createHandshakeBuffer());

      const bitfieldHandler = vi.fn();
      protocol.on('bitfield', bitfieldHandler);

      const zeroBitfield = Buffer.alloc(100, 0x00);
      mockConnection.simulateData(encodeBitfield(zeroBitfield));

      expect(bitfieldHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle bitfield with all ones', () => {
      mockConnection.simulateData(createHandshakeBuffer());

      const bitfieldHandler = vi.fn();
      protocol.on('bitfield', bitfieldHandler);

      const fullBitfield = Buffer.alloc(100, 0xff);
      mockConnection.simulateData(encodeBitfield(fullBitfield));

      expect(bitfieldHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle have with maximum uint32 piece index', () => {
      mockConnection.simulateData(createHandshakeBuffer());

      const haveHandler = vi.fn();
      protocol.on('have', haveHandler);

      const maxIndex = 0xffffffff;
      mockConnection.simulateData(encodeHave(maxIndex));

      expect(haveHandler).toHaveBeenCalledTimes(1);
      expect(haveHandler).toHaveBeenCalledWith(maxIndex);
    });

    it('should handle rapid succession of messages', () => {
      mockConnection.simulateData(createHandshakeBuffer());

      const haveHandler = vi.fn();
      protocol.on('have', haveHandler);

      // Send 1000 have messages
      const messages: Buffer[] = [];
      for (let i = 0; i < 1000; i++) {
        messages.push(encodeHave(i));
      }

      mockConnection.simulateData(Buffer.concat(messages));

      expect(haveHandler).toHaveBeenCalledTimes(1000);
      expect(haveHandler.mock.calls[999][0]).toBe(999);
    });

    it('should preserve custom reserved bytes in handshake', () => {
      const customReserved = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x05]);

      const handshakeHandler = vi.fn();
      protocol.on('handshake', handshakeHandler);

      const handshake = encodeHandshake(testInfoHash, testPeerId, customReserved);
      mockConnection.simulateData(handshake);

      expect(handshakeHandler).toHaveBeenCalledTimes(1);
      expect(handshakeHandler.mock.calls[0][0].reserved.equals(customReserved)).toBe(true);
    });
  });
});
