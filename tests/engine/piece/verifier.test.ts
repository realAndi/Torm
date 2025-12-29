import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import {
  PieceVerifier,
  PieceVerifierEvents,
  VerificationResult,
  computeSha1,
  verifyPieceAsync,
  verifyPieces,
  SHA1_HASH_SIZE,
} from '../../../src/engine/piece/verifier.js';

// =============================================================================
// Test Data Helpers
// =============================================================================

/**
 * Computes SHA-1 hash for test data
 */
function sha1(data: Buffer | string): Buffer {
  return createHash('sha1')
    .update(typeof data === 'string' ? Buffer.from(data) : data)
    .digest();
}

/**
 * Creates test piece hashes for multiple pieces
 */
function createPieceHashes(...pieces: Array<Buffer | string>): Buffer {
  const hashes = pieces.map((piece) =>
    typeof piece === 'string' ? sha1(piece) : sha1(piece)
  );
  return Buffer.concat(hashes);
}

// Known SHA-1 values for testing
const KNOWN_HASHES = {
  empty: sha1(''),
  hello: sha1('hello'),
  world: sha1('world'),
  test: sha1('test'),
};

// =============================================================================
// Hash Computation Tests
// =============================================================================

describe('computeSha1', () => {
  describe('known SHA-1 values', () => {
    it('should compute correct hash for empty string', () => {
      const hash = computeSha1(Buffer.from(''));
      // SHA-1 of empty string: da39a3ee5e6b4b0d3255bfef95601890afd80709
      expect(hash.toString('hex')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    });

    it('should compute correct hash for "hello"', () => {
      const hash = computeSha1(Buffer.from('hello'));
      // SHA-1 of "hello": aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
      expect(hash.toString('hex')).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
    });

    it('should compute correct hash for "The quick brown fox jumps over the lazy dog"', () => {
      const hash = computeSha1(Buffer.from('The quick brown fox jumps over the lazy dog'));
      // SHA-1: 2fd4e1c67a2d28fced849ee1bb76e7391b93eb12
      expect(hash.toString('hex')).toBe('2fd4e1c67a2d28fced849ee1bb76e7391b93eb12');
    });

    it('should compute correct hash for single byte', () => {
      const hash = computeSha1(Buffer.from([0x00]));
      // SHA-1 of single null byte
      expect(hash.toString('hex')).toBe('5ba93c9db0cff93f52b521d7420e43f6eda2784f');
    });
  });

  describe('buffer inputs of various sizes', () => {
    it('should handle empty buffer', () => {
      const hash = computeSha1(Buffer.alloc(0));
      expect(hash.length).toBe(20);
      expect(hash.equals(KNOWN_HASHES.empty)).toBe(true);
    });

    it('should handle small buffer (1 byte)', () => {
      const hash = computeSha1(Buffer.from([0x42]));
      expect(hash.length).toBe(20);
    });

    it('should handle medium buffer (1 KB)', () => {
      const data = Buffer.alloc(1024, 0xab);
      const hash = computeSha1(data);
      expect(hash.length).toBe(20);
    });

    it('should handle large buffer (1 MB)', () => {
      const data = Buffer.alloc(1024 * 1024, 0xcd);
      const hash = computeSha1(data);
      expect(hash.length).toBe(20);
    });

    it('should handle very large buffer (16 MB - typical piece size)', () => {
      const data = Buffer.alloc(16 * 1024 * 1024, 0xef);
      const hash = computeSha1(data);
      expect(hash.length).toBe(20);
    });

    it('should produce consistent results for same input', () => {
      const data = Buffer.from('consistency test');
      const hash1 = computeSha1(data);
      const hash2 = computeSha1(data);
      expect(hash1.equals(hash2)).toBe(true);
    });

    it('should produce different results for different inputs', () => {
      const hash1 = computeSha1(Buffer.from('input1'));
      const hash2 = computeSha1(Buffer.from('input2'));
      expect(hash1.equals(hash2)).toBe(false);
    });
  });
});

// =============================================================================
// PieceVerifier Construction Tests
// =============================================================================

describe('PieceVerifier', () => {
  describe('constructor', () => {
    it('should create instance with valid piece hashes (single piece)', () => {
      const pieceHashes = sha1('piece data');
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier).toBeInstanceOf(PieceVerifier);
      expect(verifier.pieceCount).toBe(1);
    });

    it('should create instance with valid piece hashes (multiple pieces)', () => {
      const pieceHashes = createPieceHashes('piece1', 'piece2', 'piece3');
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.pieceCount).toBe(3);
    });

    it('should create instance with many pieces', () => {
      const pieces: string[] = [];
      for (let i = 0; i < 1000; i++) {
        pieces.push(`piece${i}`);
      }
      const pieceHashes = createPieceHashes(...pieces);
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.pieceCount).toBe(1000);
    });

    it('should throw error for empty piece hashes', () => {
      expect(() => new PieceVerifier(Buffer.alloc(0))).not.toThrow();
      const verifier = new PieceVerifier(Buffer.alloc(0));
      expect(verifier.pieceCount).toBe(0);
    });

    it('should throw error for invalid length (1 byte)', () => {
      expect(() => new PieceVerifier(Buffer.alloc(1))).toThrow(
        'Invalid pieceHashes length: 1 is not a multiple of 20'
      );
    });

    it('should throw error for invalid length (19 bytes)', () => {
      expect(() => new PieceVerifier(Buffer.alloc(19))).toThrow(
        'Invalid pieceHashes length: 19 is not a multiple of 20'
      );
    });

    it('should throw error for invalid length (21 bytes)', () => {
      expect(() => new PieceVerifier(Buffer.alloc(21))).toThrow(
        'Invalid pieceHashes length: 21 is not a multiple of 20'
      );
    });

    it('should throw error for invalid length (41 bytes)', () => {
      expect(() => new PieceVerifier(Buffer.alloc(41))).toThrow(
        'Invalid pieceHashes length: 41 is not a multiple of 20'
      );
    });

    it('should calculate correct piece count', () => {
      expect(new PieceVerifier(Buffer.alloc(20)).pieceCount).toBe(1);
      expect(new PieceVerifier(Buffer.alloc(40)).pieceCount).toBe(2);
      expect(new PieceVerifier(Buffer.alloc(60)).pieceCount).toBe(3);
      expect(new PieceVerifier(Buffer.alloc(200)).pieceCount).toBe(10);
      expect(new PieceVerifier(Buffer.alloc(2000)).pieceCount).toBe(100);
    });

    it('should make a copy of the pieceHashes buffer', () => {
      const originalHashes = createPieceHashes('piece1');
      const verifier = new PieceVerifier(originalHashes);

      // Modify original buffer
      originalHashes.fill(0xff);

      // Verifier should still have original hash
      const validData = Buffer.from('piece1');
      expect(verifier.verify(0, validData)).toBe(true);
    });
  });

  // ===========================================================================
  // Single Piece Verification Tests
  // ===========================================================================

  describe('verify', () => {
    it('should return true for valid piece', () => {
      const pieceData = Buffer.from('valid piece data');
      const pieceHashes = sha1(pieceData);
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, pieceData)).toBe(true);
    });

    it('should return false for invalid piece', () => {
      const pieceHashes = sha1('expected data');
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, Buffer.from('wrong data'))).toBe(false);
    });

    it('should verify correct piece among multiple', () => {
      const pieceHashes = createPieceHashes('piece0', 'piece1', 'piece2');
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, Buffer.from('piece0'))).toBe(true);
      expect(verifier.verify(1, Buffer.from('piece1'))).toBe(true);
      expect(verifier.verify(2, Buffer.from('piece2'))).toBe(true);
    });

    it('should fail verification when pieces are swapped', () => {
      const pieceHashes = createPieceHashes('piece0', 'piece1');
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, Buffer.from('piece1'))).toBe(false);
      expect(verifier.verify(1, Buffer.from('piece0'))).toBe(false);
    });

    it('should handle empty piece data', () => {
      const emptyData = Buffer.alloc(0);
      const pieceHashes = sha1(emptyData);
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, emptyData)).toBe(true);
    });

    it('should handle large piece data', () => {
      const largeData = Buffer.alloc(16 * 1024 * 1024, 0xab); // 16 MB
      const pieceHashes = sha1(largeData);
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, largeData)).toBe(true);
    });

    it('should detect single bit difference', () => {
      const data = Buffer.from('test data');
      const pieceHashes = sha1(data);
      const verifier = new PieceVerifier(pieceHashes);

      // Flip one bit
      const corruptedData = Buffer.from(data);
      corruptedData[0] ^= 0x01;

      expect(verifier.verify(0, corruptedData)).toBe(false);
    });
  });

  // ===========================================================================
  // Index Bounds Checking Tests
  // ===========================================================================

  describe('verify - index bounds checking', () => {
    let verifier: PieceVerifier;

    beforeEach(() => {
      const pieceHashes = createPieceHashes('p0', 'p1', 'p2', 'p3', 'p4');
      verifier = new PieceVerifier(pieceHashes);
    });

    it('should allow piece index 0', () => {
      expect(() => verifier.verify(0, Buffer.from('p0'))).not.toThrow();
    });

    it('should allow last piece index (pieceCount - 1)', () => {
      expect(() => verifier.verify(4, Buffer.from('p4'))).not.toThrow();
    });

    it('should throw for negative piece index', () => {
      expect(() => verifier.verify(-1, Buffer.from('data'))).toThrow(
        'Piece index -1 out of bounds (0-4)'
      );
    });

    it('should throw for piece index equal to pieceCount', () => {
      expect(() => verifier.verify(5, Buffer.from('data'))).toThrow(
        'Piece index 5 out of bounds (0-4)'
      );
    });

    it('should throw for piece index greater than pieceCount', () => {
      expect(() => verifier.verify(100, Buffer.from('data'))).toThrow(
        'Piece index 100 out of bounds (0-4)'
      );
    });

    it('should throw for non-integer piece index (float)', () => {
      expect(() => verifier.verify(1.5, Buffer.from('data'))).toThrow(
        'Piece index must be an integer: 1.5'
      );
    });

    it('should throw for NaN piece index', () => {
      expect(() => verifier.verify(NaN, Buffer.from('data'))).toThrow(
        'Piece index must be an integer: NaN'
      );
    });

    it('should throw for Infinity piece index', () => {
      expect(() => verifier.verify(Infinity, Buffer.from('data'))).toThrow(
        'Piece index must be an integer: Infinity'
      );
    });
  });

  // ===========================================================================
  // getExpectedHash Tests
  // ===========================================================================

  describe('getExpectedHash', () => {
    it('should return correct hash for piece index', () => {
      const piece0Data = Buffer.from('piece0');
      const piece1Data = Buffer.from('piece1');
      const pieceHashes = createPieceHashes(piece0Data, piece1Data);
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.getExpectedHash(0).equals(sha1(piece0Data))).toBe(true);
      expect(verifier.getExpectedHash(1).equals(sha1(piece1Data))).toBe(true);
    });

    it('should return a copy of the hash buffer', () => {
      const pieceHashes = sha1('test');
      const verifier = new PieceVerifier(pieceHashes);

      const hash1 = verifier.getExpectedHash(0);
      const hash2 = verifier.getExpectedHash(0);

      // Should be equal values
      expect(hash1.equals(hash2)).toBe(true);

      // But modifying one should not affect the other
      hash1.fill(0xff);
      expect(hash2.equals(verifier.getExpectedHash(0))).toBe(true);
    });

    it('should throw for out of bounds index', () => {
      const pieceHashes = createPieceHashes('p0', 'p1');
      const verifier = new PieceVerifier(pieceHashes);

      expect(() => verifier.getExpectedHash(-1)).toThrow('out of bounds');
      expect(() => verifier.getExpectedHash(2)).toThrow('out of bounds');
      expect(() => verifier.getExpectedHash(100)).toThrow('out of bounds');
    });

    it('should return 20-byte hash', () => {
      const pieceHashes = sha1('test');
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.getExpectedHash(0).length).toBe(20);
    });
  });

  // ===========================================================================
  // Event Emission Tests
  // ===========================================================================

  describe('verifyAndEmit', () => {
    it('should emit "verified" event on successful verification', () => {
      const pieceData = Buffer.from('valid piece');
      const pieceHashes = sha1(pieceData);
      const verifier = new PieceVerifier(pieceHashes);

      const verifiedHandler = vi.fn();
      verifier.on('verified', verifiedHandler);

      const result = verifier.verifyAndEmit(0, pieceData);

      expect(result).toBe(true);
      expect(verifiedHandler).toHaveBeenCalledTimes(1);
      expect(verifiedHandler).toHaveBeenCalledWith({ pieceIndex: 0 });
    });

    it('should emit "failed" event on failed verification', () => {
      const pieceHashes = sha1('expected');
      const verifier = new PieceVerifier(pieceHashes);

      const failedHandler = vi.fn();
      verifier.on('failed', failedHandler);

      const wrongData = Buffer.from('wrong');
      const result = verifier.verifyAndEmit(0, wrongData);

      expect(result).toBe(false);
      expect(failedHandler).toHaveBeenCalledTimes(1);
      expect(failedHandler).toHaveBeenCalledWith({
        pieceIndex: 0,
        expectedHash: sha1('expected'),
        actualHash: sha1('wrong'),
      });
    });

    it('should include correct hashes in failed event', () => {
      const expectedData = Buffer.from('expected');
      const actualData = Buffer.from('actual');
      const pieceHashes = sha1(expectedData);
      const verifier = new PieceVerifier(pieceHashes);

      const failedHandler = vi.fn();
      verifier.on('failed', failedHandler);

      verifier.verifyAndEmit(0, actualData);

      const call = failedHandler.mock.calls[0][0];
      expect(call.expectedHash.equals(sha1(expectedData))).toBe(true);
      expect(call.actualHash.equals(sha1(actualData))).toBe(true);
    });

    it('should not emit "failed" event on success', () => {
      const pieceData = Buffer.from('valid');
      const pieceHashes = sha1(pieceData);
      const verifier = new PieceVerifier(pieceHashes);

      const failedHandler = vi.fn();
      verifier.on('failed', failedHandler);

      verifier.verifyAndEmit(0, pieceData);

      expect(failedHandler).not.toHaveBeenCalled();
    });

    it('should not emit "verified" event on failure', () => {
      const pieceHashes = sha1('expected');
      const verifier = new PieceVerifier(pieceHashes);

      const verifiedHandler = vi.fn();
      verifier.on('verified', verifiedHandler);

      verifier.verifyAndEmit(0, Buffer.from('wrong'));

      expect(verifiedHandler).not.toHaveBeenCalled();
    });

    it('should work with multiple pieces', () => {
      const pieceHashes = createPieceHashes('p0', 'p1', 'p2');
      const verifier = new PieceVerifier(pieceHashes);

      const verifiedHandler = vi.fn();
      const failedHandler = vi.fn();
      verifier.on('verified', verifiedHandler);
      verifier.on('failed', failedHandler);

      verifier.verifyAndEmit(0, Buffer.from('p0')); // success
      verifier.verifyAndEmit(1, Buffer.from('wrong')); // fail
      verifier.verifyAndEmit(2, Buffer.from('p2')); // success

      expect(verifiedHandler).toHaveBeenCalledTimes(2);
      expect(failedHandler).toHaveBeenCalledTimes(1);

      expect(verifiedHandler.mock.calls[0][0]).toEqual({ pieceIndex: 0 });
      expect(verifiedHandler.mock.calls[1][0]).toEqual({ pieceIndex: 2 });
      expect(failedHandler.mock.calls[0][0].pieceIndex).toBe(1);
    });

    it('should throw for out of bounds index', () => {
      const pieceHashes = sha1('test');
      const verifier = new PieceVerifier(pieceHashes);

      expect(() => verifier.verifyAndEmit(-1, Buffer.from('data'))).toThrow('out of bounds');
      expect(() => verifier.verifyAndEmit(1, Buffer.from('data'))).toThrow('out of bounds');
    });
  });

  // ===========================================================================
  // Edge Cases Tests
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle piece at boundary index 0', () => {
      const pieceHashes = createPieceHashes('first', 'second', 'third');
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, Buffer.from('first'))).toBe(true);
      expect(verifier.getExpectedHash(0).equals(sha1('first'))).toBe(true);
    });

    it('should handle piece at boundary index (pieceCount - 1)', () => {
      const pieceHashes = createPieceHashes('first', 'second', 'third');
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(2, Buffer.from('third'))).toBe(true);
      expect(verifier.getExpectedHash(2).equals(sha1('third'))).toBe(true);
    });

    it('should handle single piece torrent', () => {
      const pieceHashes = sha1('only piece');
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.pieceCount).toBe(1);
      expect(verifier.verify(0, Buffer.from('only piece'))).toBe(true);
      expect(() => verifier.verify(1, Buffer.from('data'))).toThrow('out of bounds');
    });

    it('should handle zero-length piece data', () => {
      const emptyData = Buffer.alloc(0);
      const pieceHashes = sha1(emptyData);
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, emptyData)).toBe(true);
    });

    it('should handle binary data with null bytes', () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x00, 0x02, 0x00]);
      const pieceHashes = sha1(binaryData);
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, binaryData)).toBe(true);
    });

    it('should handle all-zero data', () => {
      const zeroData = Buffer.alloc(1000, 0x00);
      const pieceHashes = sha1(zeroData);
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, zeroData)).toBe(true);
    });

    it('should handle all-ones data', () => {
      const onesData = Buffer.alloc(1000, 0xff);
      const pieceHashes = sha1(onesData);
      const verifier = new PieceVerifier(pieceHashes);

      expect(verifier.verify(0, onesData)).toBe(true);
    });
  });
});

// =============================================================================
// Async Verification Tests
// =============================================================================

describe('verifyPieceAsync', () => {
  it('should verify valid piece asynchronously', async () => {
    const data = Buffer.from('test data');
    const expectedHash = sha1(data);

    const result = await verifyPieceAsync(0, data, expectedHash);

    expect(result.valid).toBe(true);
    expect(result.pieceIndex).toBe(0);
    expect(result.expectedHash.equals(expectedHash)).toBe(true);
    expect(result.actualHash.equals(expectedHash)).toBe(true);
  });

  it('should fail invalid piece asynchronously', async () => {
    const data = Buffer.from('wrong data');
    const expectedHash = sha1('expected data');

    const result = await verifyPieceAsync(0, data, expectedHash);

    expect(result.valid).toBe(false);
    expect(result.pieceIndex).toBe(0);
    expect(result.expectedHash.equals(expectedHash)).toBe(true);
    expect(result.actualHash.equals(sha1('wrong data'))).toBe(true);
  });

  it('should work with various piece indices', async () => {
    const data = Buffer.from('test');
    const hash = sha1(data);

    const result0 = await verifyPieceAsync(0, data, hash);
    const result5 = await verifyPieceAsync(5, data, hash);
    const result100 = await verifyPieceAsync(100, data, hash);

    expect(result0.pieceIndex).toBe(0);
    expect(result5.pieceIndex).toBe(5);
    expect(result100.pieceIndex).toBe(100);
  });

  it('should return copies of hashes', async () => {
    const data = Buffer.from('test');
    const expectedHash = sha1(data);

    const result = await verifyPieceAsync(0, data, expectedHash);

    // Modify input
    expectedHash.fill(0xff);

    // Result should still have original hash
    expect(result.expectedHash.equals(sha1(data))).toBe(true);
  });

  it('should yield to event loop', async () => {
    const data = Buffer.from('test');
    const hash = sha1(data);

    let yieldOccurred = false;
    setImmediate(() => {
      yieldOccurred = true;
    });

    await verifyPieceAsync(0, data, hash);

    expect(yieldOccurred).toBe(true);
  });

  it('should handle large pieces', async () => {
    const data = Buffer.alloc(16 * 1024 * 1024, 0xab); // 16 MB
    const hash = sha1(data);

    const result = await verifyPieceAsync(0, data, hash);

    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// Batch Verification Tests
// =============================================================================

describe('verifyPieces', () => {
  it('should verify all valid pieces', async () => {
    const pieces = [
      { pieceIndex: 0, data: Buffer.from('piece0') },
      { pieceIndex: 1, data: Buffer.from('piece1') },
      { pieceIndex: 2, data: Buffer.from('piece2') },
    ];
    const pieceHashes = createPieceHashes('piece0', 'piece1', 'piece2');

    const results = await verifyPieces(pieces, pieceHashes);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.valid)).toBe(true);
    expect(results[0].pieceIndex).toBe(0);
    expect(results[1].pieceIndex).toBe(1);
    expect(results[2].pieceIndex).toBe(2);
  });

  it('should detect invalid pieces in batch', async () => {
    const pieces = [
      { pieceIndex: 0, data: Buffer.from('piece0') },
      { pieceIndex: 1, data: Buffer.from('wrong') },
      { pieceIndex: 2, data: Buffer.from('piece2') },
    ];
    const pieceHashes = createPieceHashes('piece0', 'piece1', 'piece2');

    const results = await verifyPieces(pieces, pieceHashes);

    expect(results).toHaveLength(3);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[2].valid).toBe(true);
  });

  it('should handle empty pieces array', async () => {
    const pieceHashes = createPieceHashes('piece0');

    const results = await verifyPieces([], pieceHashes);

    expect(results).toHaveLength(0);
  });

  it('should handle single piece', async () => {
    const pieces = [{ pieceIndex: 0, data: Buffer.from('single') }];
    const pieceHashes = sha1('single');

    const results = await verifyPieces(pieces, pieceHashes);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
  });

  it('should handle out-of-order piece indices', async () => {
    const pieces = [
      { pieceIndex: 2, data: Buffer.from('piece2') },
      { pieceIndex: 0, data: Buffer.from('piece0') },
      { pieceIndex: 1, data: Buffer.from('piece1') },
    ];
    const pieceHashes = createPieceHashes('piece0', 'piece1', 'piece2');

    const results = await verifyPieces(pieces, pieceHashes);

    expect(results).toHaveLength(3);
    expect(results[0].pieceIndex).toBe(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].pieceIndex).toBe(0);
    expect(results[1].valid).toBe(true);
    expect(results[2].pieceIndex).toBe(1);
    expect(results[2].valid).toBe(true);
  });

  it('should throw for out of bounds piece index', async () => {
    const pieces = [{ pieceIndex: 5, data: Buffer.from('data') }];
    const pieceHashes = createPieceHashes('p0', 'p1');

    await expect(verifyPieces(pieces, pieceHashes)).rejects.toThrow(
      'Piece index 5 out of bounds (0-1)'
    );
  });

  it('should throw for negative piece index', async () => {
    const pieces = [{ pieceIndex: -1, data: Buffer.from('data') }];
    const pieceHashes = createPieceHashes('p0');

    await expect(verifyPieces(pieces, pieceHashes)).rejects.toThrow(
      'Piece index -1 out of bounds'
    );
  });

  it('should throw for invalid pieceHashes length', async () => {
    const pieces = [{ pieceIndex: 0, data: Buffer.from('data') }];
    const invalidHashes = Buffer.alloc(19); // Not a multiple of 20

    await expect(verifyPieces(pieces, invalidHashes)).rejects.toThrow(
      'Invalid pieceHashes length: 19 is not a multiple of 20'
    );
  });

  it('should handle duplicate piece indices', async () => {
    const pieces = [
      { pieceIndex: 0, data: Buffer.from('piece0') },
      { pieceIndex: 0, data: Buffer.from('piece0') },
    ];
    const pieceHashes = sha1('piece0');

    const results = await verifyPieces(pieces, pieceHashes);

    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(true);
  });

  it('should verify many pieces efficiently', async () => {
    const pieces: Array<{ pieceIndex: number; data: Buffer }> = [];
    const pieceStrings: string[] = [];

    for (let i = 0; i < 100; i++) {
      const data = `piece${i}`;
      pieces.push({ pieceIndex: i, data: Buffer.from(data) });
      pieceStrings.push(data);
    }

    const pieceHashes = createPieceHashes(...pieceStrings);

    const results = await verifyPieces(pieces, pieceHashes);

    expect(results).toHaveLength(100);
    expect(results.every((r) => r.valid)).toBe(true);
  });
});

// =============================================================================
// SHA1_HASH_SIZE Export Tests
// =============================================================================

describe('SHA1_HASH_SIZE constant', () => {
  it('should be 20', () => {
    expect(SHA1_HASH_SIZE).toBe(20);
  });

  it('should match actual SHA-1 hash length', () => {
    const hash = computeSha1(Buffer.from('test'));
    expect(hash.length).toBe(SHA1_HASH_SIZE);
  });
});
