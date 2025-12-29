import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HTTPTracker,
  AnnounceParams,
  urlEncodeBinary,
} from '../../../src/engine/tracker/http.js';
import { encode } from '../../../src/engine/bencode.js';
import { TrackerError } from '../../../src/engine/types.js';

// Mock the global fetch function
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch as typeof fetch;

/**
 * Helper function to convert a Buffer to an ArrayBuffer.
 * This is needed because Node.js Buffers use a shared ArrayBuffer
 * which can cause issues with slicing.
 */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < buffer.length; i++) {
    view[i] = buffer[i];
  }
  return arrayBuffer;
}

describe('HTTPTracker', () => {
  // Test data
  const announceUrl = 'http://tracker.example.com/announce';
  const infoHash = Buffer.alloc(20, 0xab);
  const peerId = Buffer.from('-TR3000-123456789012');

  const baseParams: AnnounceParams = {
    infoHash,
    peerId,
    port: 6881,
    uploaded: 0,
    downloaded: 0,
    left: 1000000,
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with default options', () => {
      const tracker = new HTTPTracker(announceUrl);
      expect(tracker).toBeInstanceOf(HTTPTracker);
    });

    it('should create an instance with custom options', () => {
      const tracker = new HTTPTracker(announceUrl, {
        timeout: 60000,
        userAgent: 'TestClient/1.0',
      });
      expect(tracker).toBeInstanceOf(HTTPTracker);
    });
  });

  describe('announce', () => {
    describe('URL building', () => {
      it('should build URL with correct parameters', async () => {
        const response = encode({
          interval: 1800,
          complete: 10,
          incomplete: 5,
          peers: Buffer.alloc(0),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        await tracker.announce(baseParams);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const calledUrl = mockFetch.mock.calls[0][0];

        expect(calledUrl).toContain('info_hash=');
        expect(calledUrl).toContain('peer_id=');
        expect(calledUrl).toContain('port=6881');
        expect(calledUrl).toContain('uploaded=0');
        expect(calledUrl).toContain('downloaded=0');
        expect(calledUrl).toContain('left=1000000');
        expect(calledUrl).toContain('compact=1');
        expect(calledUrl).toContain('numwant=50');
      });

      it('should include event parameter when specified', async () => {
        const response = encode({
          interval: 1800,
          complete: 10,
          incomplete: 5,
          peers: Buffer.alloc(0),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        await tracker.announce({ ...baseParams, event: 'started' });

        const calledUrl = mockFetch.mock.calls[0][0];
        expect(calledUrl).toContain('event=started');
      });

      it('should handle compact=0 when specified', async () => {
        const response = encode({
          interval: 1800,
          complete: 10,
          incomplete: 5,
          peers: [],
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        await tracker.announce({ ...baseParams, compact: false });

        const calledUrl = mockFetch.mock.calls[0][0];
        expect(calledUrl).toContain('compact=0');
      });

      it('should handle custom numwant', async () => {
        const response = encode({
          interval: 1800,
          complete: 10,
          incomplete: 5,
          peers: Buffer.alloc(0),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        await tracker.announce({ ...baseParams, numwant: 100 });

        const calledUrl = mockFetch.mock.calls[0][0];
        expect(calledUrl).toContain('numwant=100');
      });

      it('should set User-Agent header', async () => {
        const response = encode({
          interval: 1800,
          complete: 10,
          incomplete: 5,
          peers: Buffer.alloc(0),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl, { userAgent: 'TestClient/2.0' });
        await tracker.announce(baseParams);

        const options = mockFetch.mock.calls[0][1];
        expect(options.headers['User-Agent']).toBe('TestClient/2.0');
      });
    });

    describe('parsing compact peer responses', () => {
      it('should parse compact peer format correctly', async () => {
        // Create compact peer data: 2 peers
        // Peer 1: 192.168.1.1:6881
        // Peer 2: 10.0.0.5:51413
        const peers = Buffer.alloc(12);
        // Peer 1: IP
        peers[0] = 192;
        peers[1] = 168;
        peers[2] = 1;
        peers[3] = 1;
        // Peer 1: Port (6881 = 0x1AE1)
        peers.writeUInt16BE(6881, 4);
        // Peer 2: IP
        peers[6] = 10;
        peers[7] = 0;
        peers[8] = 0;
        peers[9] = 5;
        // Peer 2: Port (51413 = 0xC8D5)
        peers.writeUInt16BE(51413, 10);

        const response = encode({
          interval: 1800,
          'min interval': 900,
          complete: 10,
          incomplete: 5,
          peers,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        const result = await tracker.announce(baseParams);

        expect(result.interval).toBe(1800);
        expect(result.minInterval).toBe(900);
        expect(result.complete).toBe(10);
        expect(result.incomplete).toBe(5);
        expect(result.peers).toHaveLength(2);
        expect(result.peers[0]).toEqual({ ip: '192.168.1.1', port: 6881 });
        expect(result.peers[1]).toEqual({ ip: '10.0.0.5', port: 51413 });
      });

      it('should handle empty compact peer list', async () => {
        const response = encode({
          interval: 1800,
          complete: 0,
          incomplete: 0,
          peers: Buffer.alloc(0),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        const result = await tracker.announce(baseParams);

        expect(result.peers).toHaveLength(0);
      });
    });

    describe('parsing dictionary peer responses', () => {
      it('should parse dictionary peer format correctly', async () => {
        const response = encode({
          interval: 1800,
          complete: 10,
          incomplete: 5,
          peers: [
            {
              ip: Buffer.from('192.168.1.1'),
              port: 6881,
              'peer id': Buffer.from('-TR3000-abcdefghijkl'),
            },
            {
              ip: Buffer.from('10.0.0.5'),
              port: 51413,
              'peer id': Buffer.from('-qB4500-123456789012'),
            },
          ],
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        const result = await tracker.announce({ ...baseParams, compact: false });

        expect(result.peers).toHaveLength(2);
        expect(result.peers[0].ip).toBe('192.168.1.1');
        expect(result.peers[0].port).toBe(6881);
        expect(result.peers[0].peerId).toBeDefined();
        expect(result.peers[1].ip).toBe('10.0.0.5');
        expect(result.peers[1].port).toBe(51413);
      });

      it('should handle peers without peer id', async () => {
        const response = encode({
          interval: 1800,
          complete: 10,
          incomplete: 5,
          peers: [
            {
              ip: Buffer.from('192.168.1.1'),
              port: 6881,
            },
          ],
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        const result = await tracker.announce({ ...baseParams, compact: false });

        expect(result.peers).toHaveLength(1);
        expect(result.peers[0].ip).toBe('192.168.1.1');
        expect(result.peers[0].port).toBe(6881);
        expect(result.peers[0].peerId).toBeUndefined();
      });

      it('should skip malformed peer entries', async () => {
        const response = encode({
          interval: 1800,
          complete: 10,
          incomplete: 5,
          peers: [
            { ip: Buffer.from('192.168.1.1'), port: 6881 },
            { ip: Buffer.from('10.0.0.5') }, // Missing port
            { port: 6882 }, // Missing IP
            { ip: Buffer.from('172.16.0.1'), port: 8080 },
          ],
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        const result = await tracker.announce({ ...baseParams, compact: false });

        expect(result.peers).toHaveLength(2);
        expect(result.peers[0].ip).toBe('192.168.1.1');
        expect(result.peers[1].ip).toBe('172.16.0.1');
      });
    });

    describe('parsing tracker ID', () => {
      it('should parse tracker ID when present', async () => {
        const response = encode({
          interval: 1800,
          'tracker id': Buffer.from('unique-tracker-session-id'),
          complete: 10,
          incomplete: 5,
          peers: Buffer.alloc(0),
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        const result = await tracker.announce(baseParams);

        expect(result.trackerId).toBe('unique-tracker-session-id');
      });
    });

    describe('error handling', () => {
      it('should throw TrackerError for invalid info_hash length', async () => {
        const tracker = new HTTPTracker(announceUrl);
        const invalidParams = { ...baseParams, infoHash: Buffer.alloc(19) };

        await expect(tracker.announce(invalidParams)).rejects.toThrow(TrackerError);
        await expect(tracker.announce(invalidParams)).rejects.toThrow(
          'info_hash must be exactly 20 bytes',
        );
      });

      it('should throw TrackerError for invalid peer_id length', async () => {
        const tracker = new HTTPTracker(announceUrl);
        const invalidParams = { ...baseParams, peerId: Buffer.alloc(15) };

        await expect(tracker.announce(invalidParams)).rejects.toThrow(TrackerError);
        await expect(tracker.announce(invalidParams)).rejects.toThrow(
          'peer_id must be exactly 20 bytes',
        );
      });

      it('should throw TrackerError for HTTP errors', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const tracker = new HTTPTracker(announceUrl);

        await expect(tracker.announce(baseParams)).rejects.toThrow(TrackerError);
        await expect(tracker.announce(baseParams)).rejects.toThrow('HTTP error 500');
      });

      it('should throw TrackerError for tracker failure response', async () => {
        const response = encode({
          'failure reason': Buffer.from('Torrent not registered'),
        });

        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);

        await expect(tracker.announce(baseParams)).rejects.toThrow(TrackerError);
        await expect(tracker.announce(baseParams)).rejects.toThrow(
          'Torrent not registered',
        );
      });

      it('should throw TrackerError for timeout', async () => {
        mockFetch.mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              setTimeout(() => reject(error), 100);
            }),
        );

        const tracker = new HTTPTracker(announceUrl, { timeout: 50 });

        await expect(tracker.announce(baseParams)).rejects.toThrow(TrackerError);
      });

      it('should throw TrackerError for network errors', async () => {
        mockFetch.mockRejectedValue(new Error('Network unreachable'));

        const tracker = new HTTPTracker(announceUrl);

        await expect(tracker.announce(baseParams)).rejects.toThrow(TrackerError);
        await expect(tracker.announce(baseParams)).rejects.toThrow('Network error');
      });

      it('should throw TrackerError for malformed bencode', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(Buffer.from('invalid bencode'))),
        });

        const tracker = new HTTPTracker(announceUrl);

        await expect(tracker.announce(baseParams)).rejects.toThrow(TrackerError);
        await expect(tracker.announce(baseParams)).rejects.toThrow('Invalid bencode');
      });

      it('should throw TrackerError for missing interval', async () => {
        const response = encode({
          complete: 10,
          incomplete: 5,
          peers: Buffer.alloc(0),
        });

        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);

        await expect(tracker.announce(baseParams)).rejects.toThrow(TrackerError);
        await expect(tracker.announce(baseParams)).rejects.toThrow('missing or invalid interval');
      });

      it('should throw TrackerError for invalid compact peers length', async () => {
        // 7 bytes is not a multiple of 6
        const response = encode({
          interval: 1800,
          complete: 10,
          incomplete: 5,
          peers: Buffer.alloc(7),
        });

        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);

        await expect(tracker.announce(baseParams)).rejects.toThrow(TrackerError);
        await expect(tracker.announce(baseParams)).rejects.toThrow('Invalid compact peers length');
      });
    });
  });

  describe('scrape', () => {
    describe('scrape URL derivation', () => {
      it('should derive scrape URL from announce URL', () => {
        const tracker = new HTTPTracker('http://tracker.example.com/announce');
        expect(tracker.getScrapeUrl()).toBe('http://tracker.example.com/scrape');
      });

      it('should handle announce URL with path prefix', () => {
        const tracker = new HTTPTracker('http://tracker.example.com/path/to/announce');
        expect(tracker.getScrapeUrl()).toBe('http://tracker.example.com/path/to/scrape');
      });

      it('should handle announce URL with path suffix', () => {
        const tracker = new HTTPTracker('http://tracker.example.com/announce.php');
        expect(tracker.getScrapeUrl()).toBe('http://tracker.example.com/scrape.php');
      });

      it('should return null for URL without announce', () => {
        const tracker = new HTTPTracker('http://tracker.example.com/tracker');
        expect(tracker.getScrapeUrl()).toBeNull();
      });

      it('should handle HTTPS URLs', () => {
        const tracker = new HTTPTracker('https://tracker.example.com/announce');
        expect(tracker.getScrapeUrl()).toBe('https://tracker.example.com/scrape');
      });

      it('should handle URLs with port', () => {
        const tracker = new HTTPTracker('http://tracker.example.com:8080/announce');
        expect(tracker.getScrapeUrl()).toBe('http://tracker.example.com:8080/scrape');
      });
    });

    describe('scrape requests', () => {
      it('should throw TrackerError if scrape is not supported', async () => {
        const tracker = new HTTPTracker('http://tracker.example.com/tracker');

        await expect(tracker.scrape([infoHash])).rejects.toThrow(TrackerError);
        await expect(tracker.scrape([infoHash])).rejects.toThrow(
          'does not support scrape',
        );
      });

      it('should parse scrape response correctly', async () => {
        const infoHash1 = Buffer.alloc(20, 0xaa);
        const infoHash2 = Buffer.alloc(20, 0xbb);

        const response = encode({
          files: {
            [infoHash1.toString('binary')]: {
              complete: 100,
              downloaded: 5000,
              incomplete: 50,
            },
            [infoHash2.toString('binary')]: {
              complete: 200,
              downloaded: 10000,
              incomplete: 75,
            },
          },
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        const result = await tracker.scrape([infoHash1, infoHash2]);

        expect(result.files.size).toBe(2);

        const stats1 = result.files.get(infoHash1.toString('hex'));
        expect(stats1).toBeDefined();
        expect(stats1!.complete).toBe(100);
        expect(stats1!.incomplete).toBe(50);
        expect(stats1!.downloaded).toBe(5000);

        const stats2 = result.files.get(infoHash2.toString('hex'));
        expect(stats2).toBeDefined();
        expect(stats2!.complete).toBe(200);
        expect(stats2!.incomplete).toBe(75);
        expect(stats2!.downloaded).toBe(10000);
      });

      it('should throw TrackerError for invalid info_hash length in scrape', async () => {
        const tracker = new HTTPTracker(announceUrl);

        await expect(tracker.scrape([Buffer.alloc(19)])).rejects.toThrow(TrackerError);
        await expect(tracker.scrape([Buffer.alloc(19)])).rejects.toThrow(
          'info_hash must be exactly 20 bytes',
        );
      });

      it('should throw TrackerError for scrape failure response', async () => {
        const response = encode({
          'failure reason': Buffer.from('Scrape not allowed'),
        });

        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);

        await expect(tracker.scrape([infoHash])).rejects.toThrow(TrackerError);
        await expect(tracker.scrape([infoHash])).rejects.toThrow('Scrape not allowed');
      });

      it('should build scrape URL with multiple info hashes', async () => {
        const infoHash1 = Buffer.alloc(20, 0xaa);
        const infoHash2 = Buffer.alloc(20, 0xbb);

        const response = encode({
          files: {},
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(response)),
        });

        const tracker = new HTTPTracker(announceUrl);
        await tracker.scrape([infoHash1, infoHash2]);

        const calledUrl = mockFetch.mock.calls[0][0];
        // Should have two info_hash parameters
        const matches = calledUrl.match(/info_hash=/g);
        expect(matches).toHaveLength(2);
      });
    });
  });

  describe('urlEncodeBinary', () => {
    it('should not encode unreserved characters', () => {
      const data = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~');
      expect(urlEncodeBinary(data)).toBe(
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~',
      );
    });

    it('should percent-encode reserved characters', () => {
      const data = Buffer.from(' !"#$%&\'()*+,/:;=?@[]');
      const encoded = urlEncodeBinary(data);
      expect(encoded).toContain('%20'); // space
      expect(encoded).toContain('%21'); // !
      expect(encoded).toContain('%3F'); // ?
      expect(encoded).toContain('%40'); // @
    });

    it('should encode binary data correctly', () => {
      const data = Buffer.from([0x00, 0x01, 0x0a, 0xff, 0xfe]);
      const encoded = urlEncodeBinary(data);
      expect(encoded).toBe('%00%01%0A%FF%FE');
    });

    it('should encode typical info hash correctly', () => {
      const infoHash = Buffer.from('0123456789abcdef0123', 'hex');
      const encoded = urlEncodeBinary(infoHash);
      // All bytes are non-ASCII, so all should be encoded
      expect(encoded.includes('%')).toBe(true);
    });

    it('should handle empty buffer', () => {
      expect(urlEncodeBinary(Buffer.alloc(0))).toBe('');
    });

    it('should handle mixed ASCII and binary', () => {
      const data = Buffer.from([0x41, 0x00, 0x42]); // A, null, B
      expect(urlEncodeBinary(data)).toBe('A%00B');
    });
  });
});
