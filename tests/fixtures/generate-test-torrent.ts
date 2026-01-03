/**
 * Generates a minimal test torrent file for smoke testing.
 * Run with: bun run tests/fixtures/generate-test-torrent.ts
 */

import { encode as bencode } from '../../src/engine/bencode';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

// Create a minimal valid torrent structure
const pieceLength = 16384; // 16 KB pieces
const fileContent = Buffer.from('This is test content for the smoke test torrent.\n');
const totalLength = fileContent.length;

// Calculate piece hash (SHA1 of the content, padded if needed)
const pieceHash = createHash('sha1').update(fileContent).digest();

// Note: bencode requires Buffer for all string values
const info = {
  name: Buffer.from('smoke-test-file.txt'),
  'piece length': pieceLength,
  pieces: pieceHash,
  length: totalLength,
};

const torrent = {
  announce: Buffer.from('udp://tracker.example.com:6969/announce'),
  'announce-list': [
    [Buffer.from('udp://tracker.example.com:6969/announce')],
    [Buffer.from('udp://tracker.opentrackr.org:1337/announce')],
  ],
  'created by': Buffer.from('Torm Smoke Test Generator'),
  'creation date': Math.floor(Date.now() / 1000),
  info,
  comment: Buffer.from('Test torrent for CI smoke tests'),
};

const encoded = bencode(torrent);
const outputPath = join(dirname(import.meta.path), 'test.torrent');

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, encoded);

// Calculate and display info hash for verification
const infoEncoded = bencode(info);
const infoHash = createHash('sha1').update(infoEncoded).digest('hex');

console.log(`Generated test torrent: ${outputPath}`);
console.log(`Info hash: ${infoHash}`);
console.log(`File size: ${encoded.length} bytes`);
