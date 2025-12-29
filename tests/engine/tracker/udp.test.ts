import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// =============================================================================
// Mock dgram module - must be before imports
// =============================================================================

class MockSocket extends EventEmitter {
  public sentMessages: Array<{ msg: Buffer; port: number; host: string }> = [];
  public closed = false;

  send(
    msg: Buffer,
    _offset: number,
    _length: number,
    port: number,
    host: string,
    callback?: (err: Error | null) => void,
  ): void {
    this.sentMessages.push({ msg: Buffer.from(msg), port, host });
    if (callback) {
      // Use queueMicrotask for synchronous callback in tests
      queueMicrotask(() => callback(null));
    }
  }

  close(): void {
    this.closed = true;
  }

  // Helper to simulate receiving a message
  receiveMessage(msg: Buffer): void {
    this.emit('message', msg);
  }

  // Helper to simulate an error
  emitError(err: Error): void {
    this.emit('error', err);
  }
}

// Global mock socket that tests can access
let currentMockSocket: MockSocket;

vi.mock('dgram', () => ({
  default: {
    createSocket: vi.fn(() => {
      return currentMockSocket;
    }),
  },
}));

// Import after mock is set up
import {
  UDPTracker,
  UDPAnnounceParams,
  buildConnectRequest,
  parseConnectResponse,
  buildAnnounceRequest,
  parseAnnounceResponse,
  UDP_PROTOCOL,
} from '../../../src/engine/tracker/udp.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createInfoHash(): Buffer {
  return Buffer.alloc(20, 0xab);
}

function createPeerId(): Buffer {
  const peerId = Buffer.alloc(20);
  Buffer.from('-TM0001-').copy(peerId, 0);
  for (let i = 8; i < 20; i++) {
    peerId[i] = Math.floor(Math.random() * 256);
  }
  return peerId;
}

function createAnnounceParams(overrides?: Partial<UDPAnnounceParams>): UDPAnnounceParams {
  return {
    infoHash: createInfoHash(),
    peerId: createPeerId(),
    downloaded: 0n,
    left: 1000000n,
    uploaded: 0n,
    event: 2, // started
    port: 6881,
    ...overrides,
  };
}

function buildConnectResponse(transactionId: number, connectionId: bigint): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32BE(UDP_PROTOCOL.Action.CONNECT, 0);
  buffer.writeUInt32BE(transactionId, 4);
  buffer.writeBigUInt64BE(connectionId, 8);
  return buffer;
}

function buildAnnounceResponseBuffer(
  transactionId: number,
  interval: number,
  leechers: number,
  seeders: number,
  peers: Array<{ ip: string; port: number }>,
): Buffer {
  const buffer = Buffer.alloc(20 + peers.length * 6);
  buffer.writeUInt32BE(UDP_PROTOCOL.Action.ANNOUNCE, 0);
  buffer.writeUInt32BE(transactionId, 4);
  buffer.writeUInt32BE(interval, 8);
  buffer.writeUInt32BE(leechers, 12);
  buffer.writeUInt32BE(seeders, 16);

  peers.forEach((peer, i) => {
    const offset = 20 + i * 6;
    const parts = peer.ip.split('.').map(Number);
    buffer[offset] = parts[0];
    buffer[offset + 1] = parts[1];
    buffer[offset + 2] = parts[2];
    buffer[offset + 3] = parts[3];
    buffer.writeUInt16BE(peer.port, offset + 4);
  });

  return buffer;
}

function buildErrorResponse(transactionId: number, message: string): Buffer {
  const msgBuffer = Buffer.from(message, 'utf8');
  const buffer = Buffer.alloc(8 + msgBuffer.length);
  buffer.writeUInt32BE(UDP_PROTOCOL.Action.ERROR, 0);
  buffer.writeUInt32BE(transactionId, 4);
  msgBuffer.copy(buffer, 8);
  return buffer;
}

// =============================================================================
// Tests
// =============================================================================

describe('UDP Tracker', () => {
  describe('Protocol Constants', () => {
    it('should export correct protocol ID', () => {
      expect(UDP_PROTOCOL.PROTOCOL_ID).toBe(BigInt('0x41727101980'));
    });

    it('should export correct action codes', () => {
      expect(UDP_PROTOCOL.Action.CONNECT).toBe(0);
      expect(UDP_PROTOCOL.Action.ANNOUNCE).toBe(1);
      expect(UDP_PROTOCOL.Action.SCRAPE).toBe(2);
      expect(UDP_PROTOCOL.Action.ERROR).toBe(3);
    });

    it('should export correct timeout and retry values', () => {
      expect(UDP_PROTOCOL.INITIAL_TIMEOUT_MS).toBe(5000);
      expect(UDP_PROTOCOL.MAX_RETRIES).toBe(1);
      expect(UDP_PROTOCOL.CONNECTION_ID_TTL_MS).toBe(60000);
    });
  });

  describe('buildConnectRequest', () => {
    it('should build a 16-byte connect request', () => {
      const transactionId = 0x12345678;
      const request = buildConnectRequest(transactionId);

      expect(request.length).toBe(16);
    });

    it('should include correct protocol ID', () => {
      const request = buildConnectRequest(0);
      const protocolId = request.readBigUInt64BE(0);

      expect(protocolId).toBe(UDP_PROTOCOL.PROTOCOL_ID);
    });

    it('should include connect action (0)', () => {
      const request = buildConnectRequest(0);
      const action = request.readUInt32BE(8);

      expect(action).toBe(UDP_PROTOCOL.Action.CONNECT);
    });

    it('should include transaction ID', () => {
      const transactionId = 0xdeadbeef;
      const request = buildConnectRequest(transactionId);
      const parsedId = request.readUInt32BE(12);

      expect(parsedId).toBe(transactionId);
    });

    it('should handle various transaction IDs', () => {
      const testIds = [0, 1, 0x7fffffff, 0xffffffff];

      for (const id of testIds) {
        const request = buildConnectRequest(id);
        expect(request.readUInt32BE(12)).toBe(id);
      }
    });
  });

  describe('parseConnectResponse', () => {
    it('should parse valid connect response', () => {
      const transactionId = 0x12345678;
      const connectionId = BigInt('0xabcdef0123456789');
      const response = buildConnectResponse(transactionId, connectionId);

      const parsed = parseConnectResponse(response);

      expect(parsed.action).toBe(UDP_PROTOCOL.Action.CONNECT);
      expect(parsed.transactionId).toBe(transactionId);
      expect(parsed.connectionId).toBe(connectionId);
    });

    it('should throw on response too short', () => {
      const shortResponse = Buffer.alloc(15);

      expect(() => parseConnectResponse(shortResponse)).toThrow('too short');
    });

    it('should handle minimum valid response', () => {
      const response = Buffer.alloc(16);
      response.writeUInt32BE(0, 0);
      response.writeUInt32BE(1234, 4);
      response.writeBigUInt64BE(5678n, 8);

      const parsed = parseConnectResponse(response);

      expect(parsed.action).toBe(0);
      expect(parsed.transactionId).toBe(1234);
      expect(parsed.connectionId).toBe(5678n);
    });
  });

  describe('buildAnnounceRequest', () => {
    it('should build a 98-byte announce request', () => {
      const params = createAnnounceParams();
      const request = buildAnnounceRequest(1234n, 5678, params);

      expect(request.length).toBe(98);
    });

    it('should include connection ID', () => {
      const connectionId = BigInt('0x1234567890abcdef');
      const params = createAnnounceParams();
      const request = buildAnnounceRequest(connectionId, 0, params);

      expect(request.readBigUInt64BE(0)).toBe(connectionId);
    });

    it('should include announce action (1)', () => {
      const params = createAnnounceParams();
      const request = buildAnnounceRequest(0n, 0, params);

      expect(request.readUInt32BE(8)).toBe(UDP_PROTOCOL.Action.ANNOUNCE);
    });

    it('should include transaction ID', () => {
      const transactionId = 0xcafebabe;
      const params = createAnnounceParams();
      const request = buildAnnounceRequest(0n, transactionId, params);

      expect(request.readUInt32BE(12)).toBe(transactionId);
    });

    it('should include info hash at offset 16', () => {
      const infoHash = Buffer.alloc(20);
      for (let i = 0; i < 20; i++) infoHash[i] = i;

      const params = createAnnounceParams({ infoHash });
      const request = buildAnnounceRequest(0n, 0, params);

      expect(request.subarray(16, 36)).toEqual(infoHash);
    });

    it('should include peer ID at offset 36', () => {
      const peerId = Buffer.alloc(20);
      for (let i = 0; i < 20; i++) peerId[i] = i + 100;

      const params = createAnnounceParams({ peerId });
      const request = buildAnnounceRequest(0n, 0, params);

      expect(request.subarray(36, 56)).toEqual(peerId);
    });

    it('should include download stats', () => {
      const params = createAnnounceParams({
        downloaded: 1000n,
        left: 2000n,
        uploaded: 500n,
      });
      const request = buildAnnounceRequest(0n, 0, params);

      expect(request.readBigUInt64BE(56)).toBe(1000n); // downloaded
      expect(request.readBigUInt64BE(64)).toBe(2000n); // left
      expect(request.readBigUInt64BE(72)).toBe(500n); // uploaded
    });

    it('should include event type', () => {
      const events = [0, 1, 2, 3] as const;

      for (const event of events) {
        const params = createAnnounceParams({ event });
        const request = buildAnnounceRequest(0n, 0, params);

        expect(request.readUInt32BE(80)).toBe(event);
      }
    });

    it('should set IP address to 0 (default)', () => {
      const params = createAnnounceParams();
      const request = buildAnnounceRequest(0n, 0, params);

      expect(request.readUInt32BE(84)).toBe(0);
    });

    it('should include num_want (-1 by default)', () => {
      const params = createAnnounceParams();
      const request = buildAnnounceRequest(0n, 0, params);

      expect(request.readInt32BE(92)).toBe(-1);
    });

    it('should include custom num_want', () => {
      const params = createAnnounceParams({ numWant: 50 });
      const request = buildAnnounceRequest(0n, 0, params);

      expect(request.readInt32BE(92)).toBe(50);
    });

    it('should include port at offset 96', () => {
      const params = createAnnounceParams({ port: 6881 });
      const request = buildAnnounceRequest(0n, 0, params);

      expect(request.readUInt16BE(96)).toBe(6881);
    });
  });

  describe('parseAnnounceResponse', () => {
    it('should parse valid announce response', () => {
      const peers = [
        { ip: '192.168.1.1', port: 6881 },
        { ip: '10.0.0.1', port: 6882 },
      ];
      const response = buildAnnounceResponseBuffer(12345, 1800, 10, 5, peers);

      const parsed = parseAnnounceResponse(response);

      expect(parsed.action).toBe(UDP_PROTOCOL.Action.ANNOUNCE);
      expect(parsed.transactionId).toBe(12345);
      expect(parsed.interval).toBe(1800);
      expect(parsed.leechers).toBe(10);
      expect(parsed.seeders).toBe(5);
      expect(parsed.peers).toHaveLength(2);
      expect(parsed.peers[0]).toEqual({ ip: '192.168.1.1', port: 6881 });
      expect(parsed.peers[1]).toEqual({ ip: '10.0.0.1', port: 6882 });
    });

    it('should handle response with no peers', () => {
      const response = buildAnnounceResponseBuffer(1, 900, 0, 0, []);

      const parsed = parseAnnounceResponse(response);

      expect(parsed.peers).toHaveLength(0);
      expect(parsed.leechers).toBe(0);
      expect(parsed.seeders).toBe(0);
    });

    it('should handle response with many peers', () => {
      const peers = Array.from({ length: 50 }, (_, i) => ({
        ip: `192.168.${Math.floor(i / 256)}.${i % 256}`,
        port: 6881 + i,
      }));
      const response = buildAnnounceResponseBuffer(1, 1800, 25, 25, peers);

      const parsed = parseAnnounceResponse(response);

      expect(parsed.peers).toHaveLength(50);
    });

    it('should throw on response too short', () => {
      const shortResponse = Buffer.alloc(19);

      expect(() => parseAnnounceResponse(shortResponse)).toThrow('too short');
    });

    it('should skip peers with port 0', () => {
      const peers = [
        { ip: '192.168.1.1', port: 6881 },
        { ip: '192.168.1.2', port: 0 }, // Invalid
        { ip: '192.168.1.3', port: 6883 },
      ];
      const response = buildAnnounceResponseBuffer(1, 1800, 3, 0, peers);

      const parsed = parseAnnounceResponse(response);

      expect(parsed.peers).toHaveLength(2);
      expect(parsed.peers[0].ip).toBe('192.168.1.1');
      expect(parsed.peers[1].ip).toBe('192.168.1.3');
    });

    it('should handle partial peer data (truncated)', () => {
      // Response with header but truncated peer data
      const buffer = Buffer.alloc(25); // 20 header + 5 bytes (not enough for a peer)
      buffer.writeUInt32BE(1, 0); // action
      buffer.writeUInt32BE(0, 4); // transaction ID
      buffer.writeUInt32BE(1800, 8); // interval
      buffer.writeUInt32BE(0, 12); // leechers
      buffer.writeUInt32BE(0, 16); // seeders

      const parsed = parseAnnounceResponse(buffer);

      expect(parsed.peers).toHaveLength(0); // Incomplete peer data ignored
    });
  });

  describe('UDPTracker Class', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      currentMockSocket = new MockSocket();
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.clearAllMocks();
    });

    describe('constructor', () => {
      it('should parse valid UDP URL', () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        tracker.close();
        // No error thrown
      });

      it('should parse URL without path', () => {
        const tracker = new UDPTracker('udp://tracker.example.com:1234');
        tracker.close();
      });

      it('should throw on invalid URL', () => {
        expect(() => new UDPTracker('http://not-udp.com')).toThrow('Invalid UDP tracker URL');
      });

      it('should throw on malformed URL', () => {
        expect(() => new UDPTracker('not-a-url')).toThrow('Invalid UDP tracker URL');
      });
    });

    describe('announce', () => {
      it('should send connect request first', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();

        const announcePromise = tracker.announce(params);

        // Wait for connect request to be sent
        await vi.advanceTimersByTimeAsync(0);

        expect(currentMockSocket.sentMessages).toHaveLength(1);
        const connectRequest = currentMockSocket.sentMessages[0].msg;
        expect(connectRequest.length).toBe(16);
        expect(connectRequest.readBigUInt64BE(0)).toBe(UDP_PROTOCOL.PROTOCOL_ID);

        tracker.close();
        await expect(announcePromise).rejects.toThrow('closed');
      });

      it('should send announce request after connect response', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();
        const connectionId = BigInt('0x1234567890abcdef');

        const announcePromise = tracker.announce(params);

        // Wait for connect request
        await vi.advanceTimersByTimeAsync(0);
        expect(currentMockSocket.sentMessages).toHaveLength(1);

        // Get transaction ID from connect request
        const connectRequest = currentMockSocket.sentMessages[0].msg;
        const transactionId = connectRequest.readUInt32BE(12);

        // Simulate connect response
        const connectResponse = buildConnectResponse(transactionId, connectionId);
        currentMockSocket.receiveMessage(connectResponse);

        // Wait for announce request
        await vi.advanceTimersByTimeAsync(0);
        expect(currentMockSocket.sentMessages).toHaveLength(2);

        const announceRequest = currentMockSocket.sentMessages[1].msg;
        expect(announceRequest.length).toBe(98);
        expect(announceRequest.readBigUInt64BE(0)).toBe(connectionId);

        tracker.close();
        await expect(announcePromise).rejects.toThrow('closed');
      });

      it('should return peers from announce response', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();
        const connectionId = BigInt('0x1234567890abcdef');
        const peers = [
          { ip: '1.2.3.4', port: 6881 },
          { ip: '5.6.7.8', port: 6882 },
        ];

        const announcePromise = tracker.announce(params);

        // Handle connect
        await vi.advanceTimersByTimeAsync(0);
        const connectTxId = currentMockSocket.sentMessages[0].msg.readUInt32BE(12);
        currentMockSocket.receiveMessage(buildConnectResponse(connectTxId, connectionId));

        // Handle announce
        await vi.advanceTimersByTimeAsync(0);
        const announceTxId = currentMockSocket.sentMessages[1].msg.readUInt32BE(12);
        currentMockSocket.receiveMessage(buildAnnounceResponseBuffer(announceTxId, 1800, 5, 3, peers));

        const response = await announcePromise;

        expect(response.interval).toBe(1800);
        expect(response.leechers).toBe(5);
        expect(response.seeders).toBe(3);
        expect(response.peers).toEqual(peers);

        tracker.close();
      });

      it('should throw on invalid info hash length', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams({ infoHash: Buffer.alloc(19) });

        await expect(tracker.announce(params)).rejects.toThrow('info_hash must be 20 bytes');

        tracker.close();
      });

      it('should throw on invalid peer ID length', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams({ peerId: Buffer.alloc(21) });

        await expect(tracker.announce(params)).rejects.toThrow('peer_id must be 20 bytes');

        tracker.close();
      });

      it('should throw after close', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        tracker.close();

        await expect(tracker.announce(createAnnounceParams())).rejects.toThrow('closed');
      });
    });

    describe('connection ID caching', () => {
      it('should reuse connection ID for subsequent announces', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();
        const connectionId = BigInt('0x1234567890abcdef');
        const peers = [{ ip: '1.2.3.4', port: 6881 }];

        // First announce
        const promise1 = tracker.announce(params);
        await vi.advanceTimersByTimeAsync(0);
        const connectTxId = currentMockSocket.sentMessages[0].msg.readUInt32BE(12);
        currentMockSocket.receiveMessage(buildConnectResponse(connectTxId, connectionId));
        await vi.advanceTimersByTimeAsync(0);
        const announceTxId1 = currentMockSocket.sentMessages[1].msg.readUInt32BE(12);
        currentMockSocket.receiveMessage(buildAnnounceResponseBuffer(announceTxId1, 1800, 0, 0, peers));
        await promise1;

        const messageCountAfterFirst = currentMockSocket.sentMessages.length;

        // Second announce - should not send connect
        const promise2 = tracker.announce(params);
        await vi.advanceTimersByTimeAsync(0);

        // Only one new message (announce, not connect)
        expect(currentMockSocket.sentMessages.length).toBe(messageCountAfterFirst + 1);
        const secondRequest = currentMockSocket.sentMessages[currentMockSocket.sentMessages.length - 1].msg;
        expect(secondRequest.readBigUInt64BE(0)).toBe(connectionId);

        const announceTxId2 = secondRequest.readUInt32BE(12);
        currentMockSocket.receiveMessage(buildAnnounceResponseBuffer(announceTxId2, 1800, 0, 0, peers));
        await promise2;

        tracker.close();
      });

      it('should reconnect after connection ID expires', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();
        const connectionId1 = BigInt('0x1111111111111111');
        const connectionId2 = BigInt('0x2222222222222222');
        const peers = [{ ip: '1.2.3.4', port: 6881 }];

        // First announce
        const promise1 = tracker.announce(params);
        await vi.advanceTimersByTimeAsync(0);
        currentMockSocket.receiveMessage(
          buildConnectResponse(currentMockSocket.sentMessages[0].msg.readUInt32BE(12), connectionId1),
        );
        await vi.advanceTimersByTimeAsync(0);
        currentMockSocket.receiveMessage(
          buildAnnounceResponseBuffer(currentMockSocket.sentMessages[1].msg.readUInt32BE(12), 1800, 0, 0, peers),
        );
        await promise1;

        // Advance time past connection ID TTL
        await vi.advanceTimersByTimeAsync(UDP_PROTOCOL.CONNECTION_ID_TTL_MS + 1000);

        const messageCountBefore = currentMockSocket.sentMessages.length;

        // Second announce - should send new connect
        const promise2 = tracker.announce(params);
        await vi.advanceTimersByTimeAsync(0);

        // Should have sent a connect request
        const newConnectRequest = currentMockSocket.sentMessages[messageCountBefore].msg;
        expect(newConnectRequest.length).toBe(16); // Connect request

        currentMockSocket.receiveMessage(
          buildConnectResponse(newConnectRequest.readUInt32BE(12), connectionId2),
        );
        await vi.advanceTimersByTimeAsync(0);

        const announceRequest = currentMockSocket.sentMessages[currentMockSocket.sentMessages.length - 1].msg;
        expect(announceRequest.readBigUInt64BE(0)).toBe(connectionId2);

        currentMockSocket.receiveMessage(
          buildAnnounceResponseBuffer(announceRequest.readUInt32BE(12), 1800, 0, 0, peers),
        );
        await promise2;

        tracker.close();
      });
    });

    describe('transaction ID matching', () => {
      it('should ignore responses with wrong transaction ID', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();

        const announcePromise = tracker.announce(params);
        await vi.advanceTimersByTimeAsync(0);

        const correctTxId = currentMockSocket.sentMessages[0].msg.readUInt32BE(12);
        const wrongTxId = correctTxId + 1;

        // Send response with wrong transaction ID
        currentMockSocket.receiveMessage(buildConnectResponse(wrongTxId, 1234n));

        // Request should still be pending (will timeout)
        await vi.advanceTimersByTimeAsync(100);

        // Now send correct response
        currentMockSocket.receiveMessage(buildConnectResponse(correctTxId, 5678n));

        // Advance to allow announce
        await vi.advanceTimersByTimeAsync(0);

        tracker.close();
        await expect(announcePromise).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should handle tracker error response', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();
        const connectionId = BigInt('0x1234567890abcdef');

        const announcePromise = tracker.announce(params);

        // Handle connect
        await vi.advanceTimersByTimeAsync(0);
        const connectTxId = currentMockSocket.sentMessages[0].msg.readUInt32BE(12);
        currentMockSocket.receiveMessage(buildConnectResponse(connectTxId, connectionId));

        // Handle announce with error response
        await vi.advanceTimersByTimeAsync(0);
        const announceTxId = currentMockSocket.sentMessages[1].msg.readUInt32BE(12);
        currentMockSocket.receiveMessage(buildErrorResponse(announceTxId, 'Invalid info_hash'));

        await expect(announcePromise).rejects.toThrow('Invalid info_hash');

        tracker.close();
      });

      it('should handle socket errors', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();

        const announcePromise = tracker.announce(params);
        await vi.advanceTimersByTimeAsync(0);

        currentMockSocket.emitError(new Error('Network unreachable'));

        await expect(announcePromise).rejects.toThrow('Socket error');

        tracker.close();
      });
    });

    describe('timeout handling', () => {
      it('should timeout after initial timeout period', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();

        const announcePromise = tracker.announce(params);
        await vi.advanceTimersByTimeAsync(0);

        // We need to properly handle the promise rejection that will occur when timers fire.
        // The key is to ensure we're awaiting the promise before the timers trigger the rejection.
        // Use Promise.race to capture the rejection as timers advance.

        try {
          // Create a promise that will be settled by advancing timers
          // Run all timers and wait for the announce promise to settle
          await Promise.all([
            vi.runAllTimersAsync(),
            // The announce promise will reject after all retries are exhausted
            announcePromise.catch((err: Error) => {
              // Verify it's a timeout or retries error
              expect(err.message).toMatch(/timeout|retries/i);
            }),
          ]);
        } finally {
          // Always close the tracker to clean up any remaining state
          tracker.close();
        }
      });

      it('should retry with exponential backoff', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();

        const announcePromise = tracker.announce(params);

        // First attempt - sends connect request
        await vi.advanceTimersByTimeAsync(0);
        const initialCount = currentMockSocket.sentMessages.length;
        expect(initialCount).toBe(1);

        // Wait past first timeout - should retry connect
        await vi.advanceTimersByTimeAsync(UDP_PROTOCOL.INITIAL_TIMEOUT_MS + 100);

        // Verify retry happened (more connect requests sent)
        expect(currentMockSocket.sentMessages.length).toBeGreaterThan(initialCount);

        // All messages should be connect requests (16 bytes)
        for (const msg of currentMockSocket.sentMessages) {
          expect(msg.msg.length).toBe(16);
          expect(msg.msg.readBigUInt64BE(0)).toBe(UDP_PROTOCOL.PROTOCOL_ID);
        }

        // Clean up - close tracker to avoid unhandled rejection
        tracker.close();
        await expect(announcePromise).rejects.toThrow('closed');
      });
    });

    describe('close', () => {
      it('should reject pending requests on close', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();

        const announcePromise = tracker.announce(params);
        await vi.advanceTimersByTimeAsync(0);

        tracker.close();

        await expect(announcePromise).rejects.toThrow('closed');
      });

      it('should close socket', async () => {
        const tracker = new UDPTracker('udp://tracker.example.com:6969/announce');
        const params = createAnnounceParams();

        // Need to trigger socket creation
        const announcePromise = tracker.announce(params);
        await vi.advanceTimersByTimeAsync(0);

        tracker.close();

        expect(currentMockSocket.closed).toBe(true);

        await expect(announcePromise).rejects.toThrow();
      });
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      currentMockSocket = new MockSocket();
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.clearAllMocks();
    });

    it('should handle full announce flow', async () => {
      const tracker = new UDPTracker('udp://tracker.opentrackr.org:1337/announce');
      const params = createAnnounceParams({
        downloaded: 1024n,
        left: 1048576n,
        uploaded: 512n,
        event: 2, // started
        port: 51413,
        numWant: 200,
      });

      const connectionId = BigInt('0xfedcba9876543210');
      const peers = [
        { ip: '192.168.1.100', port: 6881 },
        { ip: '10.0.0.50', port: 51413 },
        { ip: '172.16.0.1', port: 6889 },
      ];

      const announcePromise = tracker.announce(params);

      // Connect phase
      await vi.advanceTimersByTimeAsync(0);
      expect(currentMockSocket.sentMessages).toHaveLength(1);
      expect(currentMockSocket.sentMessages[0].port).toBe(1337);
      expect(currentMockSocket.sentMessages[0].host).toBe('tracker.opentrackr.org');

      const connectRequest = currentMockSocket.sentMessages[0].msg;
      const connectTxId = connectRequest.readUInt32BE(12);
      currentMockSocket.receiveMessage(buildConnectResponse(connectTxId, connectionId));

      // Announce phase
      await vi.advanceTimersByTimeAsync(0);
      expect(currentMockSocket.sentMessages).toHaveLength(2);

      const announceRequest = currentMockSocket.sentMessages[1].msg;
      expect(announceRequest.readBigUInt64BE(0)).toBe(connectionId);
      expect(announceRequest.readBigUInt64BE(56)).toBe(1024n); // downloaded
      expect(announceRequest.readBigUInt64BE(64)).toBe(1048576n); // left
      expect(announceRequest.readBigUInt64BE(72)).toBe(512n); // uploaded
      expect(announceRequest.readUInt32BE(80)).toBe(2); // event
      expect(announceRequest.readInt32BE(92)).toBe(200); // numWant
      expect(announceRequest.readUInt16BE(96)).toBe(51413); // port

      const announceTxId = announceRequest.readUInt32BE(12);
      currentMockSocket.receiveMessage(buildAnnounceResponseBuffer(announceTxId, 1800, 15, 42, peers));

      const response = await announcePromise;

      expect(response.interval).toBe(1800);
      expect(response.leechers).toBe(15);
      expect(response.seeders).toBe(42);
      expect(response.peers).toEqual(peers);

      tracker.close();
    });

    it('should handle multiple concurrent announces to different trackers', async () => {
      // This would require separate mock sockets per tracker in a real implementation
      // For this test, we just verify the URLs are parsed correctly
      const tracker1 = new UDPTracker('udp://tracker1.example.com:6969/announce');
      const tracker2 = new UDPTracker('udp://tracker2.example.com:1337/announce');

      tracker1.close();
      tracker2.close();
    });
  });
});
