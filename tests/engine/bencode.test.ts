import { describe, it, expect } from 'vitest';
import { decode, encode, BencodeValue } from '../../src/engine/bencode.js';

describe('Bencode', () => {
  describe('decode', () => {
    describe('integers', () => {
      it('should decode positive integers', () => {
        expect(decode(Buffer.from('i42e'))).toBe(42);
        expect(decode(Buffer.from('i0e'))).toBe(0);
        expect(decode(Buffer.from('i123456789e'))).toBe(123456789);
      });

      it('should decode negative integers', () => {
        expect(decode(Buffer.from('i-42e'))).toBe(-42);
        expect(decode(Buffer.from('i-1e'))).toBe(-1);
        expect(decode(Buffer.from('i-999999e'))).toBe(-999999);
      });

      it('should decode zero', () => {
        expect(decode(Buffer.from('i0e'))).toBe(0);
      });

      it('should decode very large integers as BigInt', () => {
        const largeNum = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2
        const result = decode(Buffer.from(`i${largeNum}e`));
        expect(typeof result).toBe('bigint');
        expect(result).toBe(BigInt(largeNum));
      });

      it('should reject leading zeros', () => {
        expect(() => decode(Buffer.from('i03e'))).toThrow('leading zeros');
        expect(() => decode(Buffer.from('i007e'))).toThrow('leading zeros');
      });

      it('should reject negative zero', () => {
        expect(() => decode(Buffer.from('i-0e'))).toThrow('negative zero');
      });

      it('should reject empty integer', () => {
        expect(() => decode(Buffer.from('ie'))).toThrow();
      });

      it('should reject integer without terminator', () => {
        expect(() => decode(Buffer.from('i42'))).toThrow();
      });
    });

    describe('byte strings', () => {
      it('should decode ASCII strings', () => {
        const result = decode(Buffer.from('4:spam'));
        expect(Buffer.isBuffer(result)).toBe(true);
        expect((result as Buffer).toString()).toBe('spam');
      });

      it('should decode empty strings', () => {
        const result = decode(Buffer.from('0:'));
        expect(Buffer.isBuffer(result)).toBe(true);
        expect((result as Buffer).length).toBe(0);
      });

      it('should decode strings with various lengths', () => {
        const result = decode(Buffer.from('11:hello world'));
        expect((result as Buffer).toString()).toBe('hello world');
      });

      it('should preserve binary data', () => {
        // Create binary data with non-printable characters
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
        const encoded = Buffer.concat([Buffer.from('6:'), binaryData]);
        const result = decode(encoded);
        expect(Buffer.isBuffer(result)).toBe(true);
        expect((result as Buffer).equals(binaryData)).toBe(true);
      });

      it('should handle UTF-8 strings', () => {
        const utf8String = 'hello\u00e9'; // 7 bytes in UTF-8
        const utf8Buffer = Buffer.from(utf8String, 'utf8');
        const encoded = Buffer.concat([
          Buffer.from(`${utf8Buffer.length}:`),
          utf8Buffer,
        ]);
        const result = decode(encoded);
        expect((result as Buffer).toString('utf8')).toBe(utf8String);
      });

      it('should reject string with insufficient data', () => {
        expect(() => decode(Buffer.from('10:short'))).toThrow('not enough data');
      });

      it('should reject string without colon', () => {
        expect(() => decode(Buffer.from('4spam'))).toThrow();
      });
    });

    describe('lists', () => {
      it('should decode empty lists', () => {
        expect(decode(Buffer.from('le'))).toEqual([]);
      });

      it('should decode lists with integers', () => {
        const result = decode(Buffer.from('li1ei2ei3ee'));
        expect(result).toEqual([1, 2, 3]);
      });

      it('should decode lists with strings', () => {
        const result = decode(Buffer.from('l4:spam4:eggse')) as BencodeValue[];
        expect(Array.isArray(result)).toBe(true);
        expect((result[0] as Buffer).toString()).toBe('spam');
        expect((result[1] as Buffer).toString()).toBe('eggs');
      });

      it('should decode mixed lists', () => {
        const result = decode(Buffer.from('l4:spami42ee')) as BencodeValue[];
        expect((result[0] as Buffer).toString()).toBe('spam');
        expect(result[1]).toBe(42);
      });

      it('should decode nested lists', () => {
        const result = decode(Buffer.from('lli1ei2eeli3ei4eee'));
        expect(result).toEqual([[1, 2], [3, 4]]);
      });

      it('should decode deeply nested lists', () => {
        const result = decode(Buffer.from('llleee'));
        expect(result).toEqual([[[]]]);
      });

      it('should reject unterminated lists', () => {
        expect(() => decode(Buffer.from('li1ei2e'))).toThrow();
      });
    });

    describe('dictionaries', () => {
      it('should decode empty dictionaries', () => {
        expect(decode(Buffer.from('de'))).toEqual({});
      });

      it('should decode dictionaries with string values', () => {
        const result = decode(Buffer.from('d3:bar4:spam3:foo4:eggse')) as {
          [key: string]: BencodeValue;
        };
        expect((result['bar'] as Buffer).toString()).toBe('spam');
        expect((result['foo'] as Buffer).toString()).toBe('eggs');
      });

      it('should decode dictionaries with integer values', () => {
        const result = decode(Buffer.from('d3:fooi42ee'));
        expect(result).toEqual({ foo: 42 });
      });

      it('should decode dictionaries with mixed values', () => {
        const result = decode(Buffer.from('d3:bari42e3:foo4:spame')) as {
          [key: string]: BencodeValue;
        };
        expect(result['bar']).toBe(42);
        expect((result['foo'] as Buffer).toString()).toBe('spam');
      });

      it('should decode dictionaries with list values', () => {
        const result = decode(Buffer.from('d4:listli1ei2ei3eee'));
        expect(result).toEqual({ list: [1, 2, 3] });
      });

      it('should decode nested dictionaries', () => {
        const result = decode(Buffer.from('d5:innerd3:fooi42eee'));
        expect(result).toEqual({ inner: { foo: 42 } });
      });

      it('should reject unsorted keys', () => {
        expect(() => decode(Buffer.from('d3:foo4:spam3:bar4:eggse'))).toThrow(
          'keys must be sorted',
        );
      });

      it('should reject non-string keys', () => {
        // This would be 'd' followed by 'i42e' which is an integer, not a string
        expect(() => decode(Buffer.from('di42e4:spame'))).toThrow();
      });

      it('should reject unterminated dictionaries', () => {
        expect(() => decode(Buffer.from('d3:fooi42e'))).toThrow();
      });
    });

    describe('error handling', () => {
      it('should reject non-Buffer input', () => {
        expect(() => decode('not a buffer' as unknown as Buffer)).toThrow(
          'Input must be a Buffer',
        );
      });

      it('should reject empty input', () => {
        expect(() => decode(Buffer.from(''))).toThrow('empty');
      });

      it('should reject invalid first character', () => {
        expect(() => decode(Buffer.from('x'))).toThrow('unexpected character');
      });

      it('should reject trailing data', () => {
        expect(() => decode(Buffer.from('i42ei0e'))).toThrow('Unexpected data');
      });
    });
  });

  describe('encode', () => {
    describe('integers', () => {
      it('should encode positive integers', () => {
        expect(encode(42).toString()).toBe('i42e');
        expect(encode(0).toString()).toBe('i0e');
        expect(encode(123456789).toString()).toBe('i123456789e');
      });

      it('should encode negative integers', () => {
        expect(encode(-42).toString()).toBe('i-42e');
        expect(encode(-1).toString()).toBe('i-1e');
      });

      it('should encode BigInt', () => {
        const bigNum = BigInt('9007199254740993');
        expect(encode(bigNum).toString()).toBe('i9007199254740993e');
      });

      it('should reject non-integer numbers', () => {
        expect(() => encode(3.14)).toThrow('non-integer');
      });
    });

    describe('byte strings', () => {
      it('should encode ASCII strings', () => {
        const result = encode(Buffer.from('spam'));
        expect(result.toString()).toBe('4:spam');
      });

      it('should encode empty strings', () => {
        const result = encode(Buffer.from(''));
        expect(result.toString()).toBe('0:');
      });

      it('should preserve binary data', () => {
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff]);
        const result = encode(binaryData);
        expect(result.subarray(0, 2).toString()).toBe('4:');
        expect(result.subarray(2).equals(binaryData)).toBe(true);
      });
    });

    describe('lists', () => {
      it('should encode empty lists', () => {
        expect(encode([]).toString()).toBe('le');
      });

      it('should encode lists with integers', () => {
        expect(encode([1, 2, 3]).toString()).toBe('li1ei2ei3ee');
      });

      it('should encode lists with buffers', () => {
        const result = encode([Buffer.from('spam'), Buffer.from('eggs')]);
        expect(result.toString()).toBe('l4:spam4:eggse');
      });

      it('should encode nested lists', () => {
        expect(encode([[1, 2], [3, 4]]).toString()).toBe('lli1ei2eeli3ei4eee');
      });
    });

    describe('dictionaries', () => {
      it('should encode empty dictionaries', () => {
        expect(encode({}).toString()).toBe('de');
      });

      it('should encode dictionaries with integer values', () => {
        expect(encode({ foo: 42 }).toString()).toBe('d3:fooi42ee');
      });

      it('should encode dictionaries with buffer values', () => {
        const result = encode({ foo: Buffer.from('bar') });
        expect(result.toString()).toBe('d3:foo3:bare');
      });

      it('should sort keys lexicographically', () => {
        const result = encode({ foo: 1, bar: 2, baz: 3 });
        expect(result.toString()).toBe('d3:bari2e3:bazi3e3:fooi1ee');
      });

      it('should encode nested dictionaries', () => {
        const result = encode({ outer: { inner: 42 } });
        expect(result.toString()).toBe('d5:outerd5:inneri42eee');
      });
    });

    describe('error handling', () => {
      it('should reject null', () => {
        expect(() => encode(null as unknown as BencodeValue)).toThrow();
      });

      it('should reject undefined', () => {
        expect(() => encode(undefined as unknown as BencodeValue)).toThrow();
      });
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip integers', () => {
      expect(decode(encode(42))).toBe(42);
      expect(decode(encode(-42))).toBe(-42);
      expect(decode(encode(0))).toBe(0);
    });

    it('should roundtrip BigInt', () => {
      const bigNum = BigInt('9007199254740993');
      expect(decode(encode(bigNum))).toBe(bigNum);
    });

    it('should roundtrip byte strings', () => {
      const original = Buffer.from('hello world');
      const result = decode(encode(original)) as Buffer;
      expect(result.equals(original)).toBe(true);
    });

    it('should roundtrip binary data', () => {
      const original = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const result = decode(encode(original)) as Buffer;
      expect(result.equals(original)).toBe(true);
    });

    it('should roundtrip empty list', () => {
      expect(decode(encode([]))).toEqual([]);
    });

    it('should roundtrip list of integers', () => {
      expect(decode(encode([1, 2, 3]))).toEqual([1, 2, 3]);
    });

    it('should roundtrip nested structures', () => {
      const original = {
        list: [1, 2, 3],
        nested: { a: 1, b: 2 },
        value: 42,
      };
      expect(decode(encode(original))).toEqual(original);
    });

    it('should roundtrip empty dictionary', () => {
      expect(decode(encode({}))).toEqual({});
    });

    it('should roundtrip complex dictionary', () => {
      const original = {
        a: 1,
        b: [1, 2, 3],
        c: { x: 10, y: 20 },
      };
      expect(decode(encode(original))).toEqual(original);
    });
  });

  describe('real-world .torrent structure', () => {
    it('should handle a typical torrent file structure', () => {
      // Simulating a simplified .torrent file structure
      const pieceHash = Buffer.alloc(20, 0xab); // 20-byte SHA1 hash

      const torrent: BencodeValue = {
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          length: 1048576, // 1 MB
          name: Buffer.from('example.txt'),
          'piece length': 262144, // 256 KB
          pieces: pieceHash,
        },
      };

      const encoded = encode(torrent);
      const decoded = decode(encoded) as { [key: string]: BencodeValue };

      expect(
        (decoded['announce'] as Buffer).toString(),
      ).toBe('http://tracker.example.com/announce');

      const info = decoded['info'] as { [key: string]: BencodeValue };
      expect(info['length']).toBe(1048576);
      expect((info['name'] as Buffer).toString()).toBe('example.txt');
      expect(info['piece length']).toBe(262144);
      expect((info['pieces'] as Buffer).equals(pieceHash)).toBe(true);
    });

    it('should handle multi-file torrent structure', () => {
      const torrent: BencodeValue = {
        announce: Buffer.from('http://tracker.example.com/announce'),
        info: {
          files: [
            { length: 100, path: [Buffer.from('dir'), Buffer.from('file1.txt')] },
            { length: 200, path: [Buffer.from('file2.txt')] },
          ],
          name: Buffer.from('my-torrent'),
          'piece length': 16384,
          pieces: Buffer.alloc(40, 0xcd), // 2 pieces
        },
      };

      const encoded = encode(torrent);
      const decoded = decode(encoded) as { [key: string]: BencodeValue };

      const info = decoded['info'] as { [key: string]: BencodeValue };
      const files = info['files'] as BencodeValue[];

      expect(files.length).toBe(2);

      const file1 = files[0] as { [key: string]: BencodeValue };
      expect(file1['length']).toBe(100);
      const path1 = file1['path'] as Buffer[];
      expect(path1[0].toString()).toBe('dir');
      expect(path1[1].toString()).toBe('file1.txt');
    });

    it('should handle announce-list (multiple trackers)', () => {
      const torrent: BencodeValue = {
        announce: Buffer.from('http://tracker1.example.com/announce'),
        'announce-list': [
          [Buffer.from('http://tracker1.example.com/announce')],
          [Buffer.from('http://tracker2.example.com/announce')],
          [
            Buffer.from('udp://tracker3.example.com:6969'),
            Buffer.from('udp://tracker4.example.com:6969'),
          ],
        ],
        info: {
          length: 1000,
          name: Buffer.from('test'),
          'piece length': 1000,
          pieces: Buffer.alloc(20),
        },
      };

      const encoded = encode(torrent);
      const decoded = decode(encoded) as { [key: string]: BencodeValue };

      const announceList = decoded['announce-list'] as BencodeValue[][];
      expect(announceList.length).toBe(3);
      expect(announceList[2].length).toBe(2);
    });

    it('should preserve binary piece hashes exactly', () => {
      // Create piece hashes (each piece hash is 20 bytes)
      const numPieces = 5;
      const pieces = Buffer.alloc(numPieces * 20);
      for (let i = 0; i < numPieces; i++) {
        // Fill each 20-byte segment with a different pattern
        for (let j = 0; j < 20; j++) {
          pieces[i * 20 + j] = (i * 20 + j) % 256;
        }
      }

      const torrent: BencodeValue = {
        info: {
          length: 1000,
          name: Buffer.from('test'),
          'piece length': 200,
          pieces: pieces,
        },
      };

      const encoded = encode(torrent);
      const decoded = decode(encoded) as { [key: string]: BencodeValue };

      const info = decoded['info'] as { [key: string]: BencodeValue };
      const decodedPieces = info['pieces'] as Buffer;

      expect(decodedPieces.length).toBe(numPieces * 20);
      expect(decodedPieces.equals(pieces)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle maximum safe integer', () => {
      const maxSafe = Number.MAX_SAFE_INTEGER;
      expect(decode(encode(maxSafe))).toBe(maxSafe);
    });

    it('should handle minimum safe integer', () => {
      const minSafe = Number.MIN_SAFE_INTEGER;
      expect(decode(encode(minSafe))).toBe(minSafe);
    });

    it('should handle deeply nested structures', () => {
      const deep: BencodeValue = {
        a: { b: { c: { d: { e: [1, 2, [3, 4, { f: 5 }]] } } } },
      };
      expect(decode(encode(deep))).toEqual(deep);
    });

    it('should handle keys with special characters', () => {
      const obj: BencodeValue = {
        'key with spaces': 1,
        'key:with:colons': 2,
        'key\nwith\nnewlines': 3,
      };
      expect(decode(encode(obj))).toEqual(obj);
    });

    it('should handle empty values in structures', () => {
      const obj: BencodeValue = {
        emptyBuffer: Buffer.from(''),
        emptyList: [],
        emptyDict: {},
      };

      const decoded = decode(encode(obj)) as { [key: string]: BencodeValue };
      expect((decoded['emptyBuffer'] as Buffer).length).toBe(0);
      expect(decoded['emptyList']).toEqual([]);
      expect(decoded['emptyDict']).toEqual({});
    });
  });
});
