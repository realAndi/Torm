/**
 * Torrent File Parser for Torm BitTorrent Client
 *
 * Parses .torrent files (metainfo files) into structured metadata.
 * Supports both single-file and multi-file torrents according to BEP 3.
 *
 * @module engine/torrent/parser
 * @see http://bittorrent.org/beps/bep_0003.html
 */

import { createHash } from 'crypto';
import { decode, encode, BencodeValue } from '../bencode.js';
import { MetadataError } from '../types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a file within a torrent
 */
export interface TorrentFileInfo {
  /** Relative path of the file (includes directory structure for multi-file) */
  path: string;

  /** Size of the file in bytes */
  length: number;

  /** Absolute byte offset within the concatenated torrent data */
  offset: number;
}

/**
 * Complete parsed torrent metadata
 */
export interface TorrentMetadata {
  /** 20-byte SHA-1 hash of the bencoded info dictionary */
  infoHash: Buffer;

  /** Hex string representation of infoHash */
  infoHashHex: string;

  /** Name of the torrent (file or directory name) */
  name: string;

  /** Size of each piece in bytes */
  pieceLength: number;

  /** Number of pieces */
  pieceCount: number;

  /** Concatenated SHA-1 hashes for all pieces (pieceCount * 20 bytes) */
  pieces: Buffer;

  /** Array of files in the torrent */
  files: TorrentFileInfo[];

  /** Total size of all files in bytes */
  totalLength: number;

  /** Whether this is a private torrent (disables DHT/PEX) */
  isPrivate: boolean;

  /** Primary tracker URL */
  announce: string;

  /** Multi-tracker announce list (BEP 12) */
  announceList?: string[][];

  /** Optional creation date (Unix timestamp) */
  creationDate?: number;

  /** Optional creator string */
  createdBy?: string;

  /** Optional comment */
  comment?: string;

  /** Raw info dictionary (for advanced use) */
  rawInfo: { [key: string]: BencodeValue };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Type guard to check if a value is a Buffer
 */
function isBuffer(value: BencodeValue): value is Buffer {
  return Buffer.isBuffer(value);
}

/**
 * Type guard to check if a value is a dictionary
 */
function isDict(value: BencodeValue): value is { [key: string]: BencodeValue } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Buffer.isBuffer(value) &&
    !Array.isArray(value)
  );
}

/**
 * Type guard to check if a value is a list
 */
function isList(value: BencodeValue): value is BencodeValue[] {
  return Array.isArray(value);
}

/**
 * Type guard to check if a value is a number
 */
function isNumber(value: BencodeValue): value is number {
  return typeof value === 'number';
}

/**
 * Safely convert a Buffer to UTF-8 string
 */
function bufferToString(buffer: Buffer): string {
  return buffer.toString('utf8');
}

/**
 * Extract a required Buffer field from a dictionary
 */
function getRequiredBuffer(
  dict: { [key: string]: BencodeValue },
  key: string,
  context: string
): Buffer {
  const value = dict[key];
  if (value === undefined) {
    throw new MetadataError(`Missing required field '${key}' in ${context}`);
  }
  if (!isBuffer(value)) {
    throw new MetadataError(
      `Field '${key}' in ${context} must be a byte string`
    );
  }
  return value;
}

/**
 * Extract a required number field from a dictionary
 */
function getRequiredNumber(
  dict: { [key: string]: BencodeValue },
  key: string,
  context: string
): number {
  const value = dict[key];
  if (value === undefined) {
    throw new MetadataError(`Missing required field '${key}' in ${context}`);
  }
  if (!isNumber(value) && typeof value !== 'bigint') {
    throw new MetadataError(`Field '${key}' in ${context} must be an integer`);
  }
  return Number(value);
}

/**
 * Extract an optional Buffer field from a dictionary
 */
function getOptionalBuffer(
  dict: { [key: string]: BencodeValue },
  key: string
): Buffer | undefined {
  const value = dict[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isBuffer(value)) {
    return undefined;
  }
  return value;
}

/**
 * Extract an optional number field from a dictionary
 */
function getOptionalNumber(
  dict: { [key: string]: BencodeValue },
  key: string
): number | undefined {
  const value = dict[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isNumber(value) && typeof value !== 'bigint') {
    return undefined;
  }
  return Number(value);
}

// =============================================================================
// Parser Functions
// =============================================================================

/**
 * Parse announce-list (BEP 12)
 *
 * The announce-list is a list of lists of tracker URLs.
 * Each inner list is a "tier" of trackers that should be tried in order.
 */
function parseAnnounceList(value: BencodeValue): string[][] | undefined {
  if (!isList(value)) {
    return undefined;
  }

  const result: string[][] = [];

  for (const tier of value) {
    if (!isList(tier)) {
      continue;
    }

    const trackers: string[] = [];
    for (const tracker of tier) {
      if (isBuffer(tracker)) {
        trackers.push(bufferToString(tracker));
      }
    }

    if (trackers.length > 0) {
      result.push(trackers);
    }
  }

  return result.length > 0 ? result : undefined;
}

/**
 * Parse the files list from a multi-file info dictionary
 */
function parseMultiFileInfo(
  info: { [key: string]: BencodeValue },
  name: string
): { files: TorrentFileInfo[]; totalLength: number } {
  const filesValue = info['files'];
  if (!isList(filesValue)) {
    throw new MetadataError("Multi-file torrent missing 'files' list");
  }

  const files: TorrentFileInfo[] = [];
  let totalLength = 0;

  for (let i = 0; i < filesValue.length; i++) {
    const fileEntry = filesValue[i];
    if (!isDict(fileEntry)) {
      throw new MetadataError(`Invalid file entry at index ${i}`);
    }

    // Get file length
    const length = getRequiredNumber(fileEntry, 'length', `files[${i}]`);
    if (length < 0) {
      throw new MetadataError(`Invalid file length at index ${i}: ${length}`);
    }

    // Get path components
    const pathValue = fileEntry['path'];
    if (!isList(pathValue)) {
      throw new MetadataError(`Missing or invalid 'path' in files[${i}]`);
    }

    const pathParts: string[] = [];
    for (const part of pathValue) {
      if (!isBuffer(part)) {
        throw new MetadataError(`Invalid path component in files[${i}]`);
      }
      const partStr = bufferToString(part);
      // Validate path component doesn't contain path separators or is empty
      if (partStr === '' || partStr === '.' || partStr === '..') {
        throw new MetadataError(
          `Invalid path component '${partStr}' in files[${i}]`
        );
      }
      pathParts.push(partStr);
    }

    if (pathParts.length === 0) {
      throw new MetadataError(`Empty path in files[${i}]`);
    }

    // Construct full path with torrent name as root directory
    const fullPath = [name, ...pathParts].join('/');

    files.push({
      path: fullPath,
      length,
      offset: totalLength,
    });

    totalLength += length;
  }

  if (files.length === 0) {
    throw new MetadataError('Multi-file torrent has no files');
  }

  return { files, totalLength };
}

/**
 * Parse a single-file info dictionary
 */
function parseSingleFileInfo(
  info: { [key: string]: BencodeValue },
  name: string
): { files: TorrentFileInfo[]; totalLength: number } {
  const length = getRequiredNumber(info, 'length', 'info');
  if (length < 0) {
    throw new MetadataError(`Invalid file length: ${length}`);
  }

  const files: TorrentFileInfo[] = [
    {
      path: name,
      length,
      offset: 0,
    },
  ];

  return { files, totalLength: length };
}

/**
 * Calculate the SHA-1 info hash from the bencoded info dictionary
 */
function calculateInfoHash(info: { [key: string]: BencodeValue }): Buffer {
  const encoded = encode(info);
  return createHash('sha1').update(encoded).digest();
}

/**
 * Parse a .torrent file buffer into structured metadata
 *
 * @param data - Raw .torrent file contents as a Buffer
 * @returns Parsed torrent metadata
 * @throws MetadataError if the torrent file is invalid
 *
 * @example
 * ```typescript
 * import { readFile } from 'fs/promises';
 * import { parseTorrent } from './parser.js';
 *
 * const torrentData = await readFile('example.torrent');
 * const metadata = parseTorrent(torrentData);
 *
 * console.log('Name:', metadata.name);
 * console.log('Info Hash:', metadata.infoHashHex);
 * console.log('Total Size:', metadata.totalLength);
 * console.log('Pieces:', metadata.pieceCount);
 * ```
 */
export function parseTorrent(data: Buffer): TorrentMetadata {
  // Decode the bencoded data
  let decoded: BencodeValue;
  try {
    decoded = decode(data);
  } catch (err) {
    throw new MetadataError(
      `Failed to decode torrent file: ${(err as Error).message}`
    );
  }

  // Validate top-level structure is a dictionary
  if (!isDict(decoded)) {
    throw new MetadataError('Torrent file must be a dictionary');
  }

  // Extract info dictionary (required)
  const info = decoded['info'];
  if (!isDict(info)) {
    throw new MetadataError("Missing or invalid 'info' dictionary");
  }

  // Calculate info hash
  const infoHash = calculateInfoHash(info);
  const infoHashHex = infoHash.toString('hex');

  // Extract name (required)
  const nameBuffer = getRequiredBuffer(info, 'name', 'info');
  const name = bufferToString(nameBuffer);
  if (name === '' || name === '.' || name === '..') {
    throw new MetadataError(`Invalid torrent name: '${name}'`);
  }

  // Extract piece length (required)
  const pieceLength = getRequiredNumber(info, 'piece length', 'info');
  if (pieceLength <= 0) {
    throw new MetadataError(`Invalid piece length: ${pieceLength}`);
  }

  // Extract pieces (required) - concatenated SHA-1 hashes
  const pieces = getRequiredBuffer(info, 'pieces', 'info');
  if (pieces.length === 0) {
    throw new MetadataError("Empty 'pieces' field");
  }
  if (pieces.length % 20 !== 0) {
    throw new MetadataError(
      `Invalid 'pieces' length: ${pieces.length} (must be a multiple of 20)`
    );
  }
  const pieceCount = pieces.length / 20;

  // Determine if single-file or multi-file torrent
  const isMultiFile = info['files'] !== undefined;
  const { files, totalLength } = isMultiFile
    ? parseMultiFileInfo(info, name)
    : parseSingleFileInfo(info, name);

  // Validate piece count matches total length
  const expectedPieceCount = Math.ceil(totalLength / pieceLength);
  if (pieceCount !== expectedPieceCount) {
    throw new MetadataError(
      `Piece count mismatch: got ${pieceCount}, expected ${expectedPieceCount} for total length ${totalLength}`
    );
  }

  // Extract private flag
  const privateFlag = getOptionalNumber(info, 'private');
  const isPrivate = privateFlag === 1;

  // Extract announce URL (required unless announce-list is present)
  const announceBuffer = getOptionalBuffer(decoded, 'announce');
  const announceListRaw = decoded['announce-list'];
  const announceList = announceListRaw
    ? parseAnnounceList(announceListRaw)
    : undefined;

  let announce: string;
  if (announceBuffer) {
    announce = bufferToString(announceBuffer);
  } else if (
    announceList &&
    announceList.length > 0 &&
    announceList[0].length > 0
  ) {
    // Use first tracker from announce-list if no announce field
    announce = announceList[0][0];
  } else {
    throw new MetadataError(
      "Missing 'announce' URL and no valid 'announce-list'"
    );
  }

  // Extract optional fields
  const creationDateRaw = getOptionalNumber(decoded, 'creation date');
  const creationDate = creationDateRaw ? creationDateRaw : undefined;

  const createdByBuffer = getOptionalBuffer(decoded, 'created by');
  const createdBy = createdByBuffer
    ? bufferToString(createdByBuffer)
    : undefined;

  const commentBuffer = getOptionalBuffer(decoded, 'comment');
  const comment = commentBuffer ? bufferToString(commentBuffer) : undefined;

  return {
    infoHash,
    infoHashHex,
    name,
    pieceLength,
    pieceCount,
    pieces,
    files,
    totalLength,
    isPrivate,
    announce,
    announceList,
    creationDate,
    createdBy,
    comment,
    rawInfo: info,
  };
}

/**
 * Extract the piece hash for a specific piece index
 *
 * @param metadata - Parsed torrent metadata
 * @param pieceIndex - Zero-based index of the piece
 * @returns 20-byte SHA-1 hash for the piece
 * @throws Error if pieceIndex is out of range
 */
export function getPieceHash(
  metadata: TorrentMetadata,
  pieceIndex: number
): Buffer {
  if (pieceIndex < 0 || pieceIndex >= metadata.pieceCount) {
    throw new Error(
      `Invalid piece index: ${pieceIndex} (valid range: 0-${metadata.pieceCount - 1})`
    );
  }

  const offset = pieceIndex * 20;
  return metadata.pieces.subarray(offset, offset + 20);
}

/**
 * Get the actual length of a specific piece
 *
 * All pieces have the standard piece length except the last piece,
 * which may be smaller.
 *
 * @param metadata - Parsed torrent metadata
 * @param pieceIndex - Zero-based index of the piece
 * @returns Piece length in bytes
 * @throws Error if pieceIndex is out of range
 */
export function getActualPieceLength(
  metadata: TorrentMetadata,
  pieceIndex: number
): number {
  if (pieceIndex < 0 || pieceIndex >= metadata.pieceCount) {
    throw new Error(
      `Invalid piece index: ${pieceIndex} (valid range: 0-${metadata.pieceCount - 1})`
    );
  }

  const isLastPiece = pieceIndex === metadata.pieceCount - 1;
  if (isLastPiece) {
    const remainder = metadata.totalLength % metadata.pieceLength;
    return remainder === 0 ? metadata.pieceLength : remainder;
  }

  return metadata.pieceLength;
}

/**
 * Find files that a piece spans
 *
 * Returns the files and byte ranges within each file that correspond
 * to the given piece. Useful for disk I/O operations.
 *
 * @param metadata - Parsed torrent metadata
 * @param pieceIndex - Zero-based index of the piece
 * @returns Array of file info and byte ranges
 */
export function getFilesForPiece(
  metadata: TorrentMetadata,
  pieceIndex: number
): Array<{ file: TorrentFileInfo; fileOffset: number; length: number }> {
  if (pieceIndex < 0 || pieceIndex >= metadata.pieceCount) {
    throw new Error(
      `Invalid piece index: ${pieceIndex} (valid range: 0-${metadata.pieceCount - 1})`
    );
  }

  const pieceStart = pieceIndex * metadata.pieceLength;
  const pieceLength = getActualPieceLength(metadata, pieceIndex);
  const pieceEnd = pieceStart + pieceLength;

  const result: Array<{
    file: TorrentFileInfo;
    fileOffset: number;
    length: number;
  }> = [];

  for (const file of metadata.files) {
    const fileStart = file.offset;
    const fileEnd = file.offset + file.length;

    // Check if piece overlaps with file
    if (pieceStart < fileEnd && pieceEnd > fileStart) {
      // Calculate the overlap
      const overlapStart = Math.max(pieceStart, fileStart);
      const overlapEnd = Math.min(pieceEnd, fileEnd);
      const overlapLength = overlapEnd - overlapStart;

      // Calculate offset within the file
      const fileOffset = overlapStart - fileStart;

      result.push({
        file,
        fileOffset,
        length: overlapLength,
      });
    }
  }

  return result;
}

/**
 * Partial metadata from a magnet URI (before full metadata is fetched)
 */
export interface MagnetMetadata {
  /** 20-byte SHA-1 hash of the bencoded info dictionary */
  infoHash: Buffer;

  /** Hex string representation of infoHash */
  infoHashHex: string;

  /** Display name from magnet URI (may not match actual torrent name) */
  name: string;

  /** Tracker URLs from magnet URI */
  trackers: string[];

  /** Web seed URLs from magnet URI */
  webSeeds: string[];

  /** Exact source URL (for fetching .torrent file) */
  exactSource?: string;
}

/**
 * Parse a magnet URI into metadata
 *
 * @param magnetUri - The magnet URI string
 * @returns Parsed magnet metadata
 * @throws Error if the magnet URI is invalid
 *
 * @example
 * ```typescript
 * const magnet = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny';
 * const metadata = parseMagnetUri(magnet);
 * console.log(metadata.infoHashHex); // 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c'
 * ```
 */
export function parseMagnetUri(magnetUri: string): MagnetMetadata {
  if (!magnetUri.startsWith('magnet:?')) {
    throw new Error('Invalid magnet URI: must start with "magnet:?"');
  }

  const params = new URLSearchParams(magnetUri.slice(8));

  // Parse xt (exact topic) to get info hash
  const xt = params.get('xt');
  if (!xt) {
    throw new Error('Invalid magnet URI: missing xt parameter');
  }

  // Support both btih (BitTorrent info hash) formats
  let infoHashHex: string;
  if (xt.startsWith('urn:btih:')) {
    infoHashHex = xt.slice(9).toLowerCase();
  } else {
    throw new Error('Invalid magnet URI: xt must be urn:btih:...');
  }

  // Handle both hex (40 chars) and base32 (32 chars) info hashes
  let infoHash: Buffer;
  if (infoHashHex.length === 40) {
    // Hex encoded
    infoHash = Buffer.from(infoHashHex, 'hex');
  } else if (infoHashHex.length === 32) {
    // Base32 encoded - decode to binary
    infoHash = base32Decode(infoHashHex.toUpperCase());
    infoHashHex = infoHash.toString('hex');
  } else {
    throw new Error(
      `Invalid magnet URI: info hash must be 40 hex chars or 32 base32 chars, got ${infoHashHex.length}`
    );
  }

  if (infoHash.length !== 20) {
    throw new Error('Invalid magnet URI: info hash must be 20 bytes');
  }

  // Parse display name
  const dn = params.get('dn');
  const name = dn ? decodeURIComponent(dn) : infoHashHex;

  // Parse trackers (can have multiple tr params)
  const trackers: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'tr') {
      trackers.push(decodeURIComponent(value));
    }
  }

  // Parse web seeds
  const webSeeds: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'ws') {
      webSeeds.push(decodeURIComponent(value));
    }
  }

  // Parse exact source (for fetching .torrent file directly)
  const xs = params.get('xs');
  const exactSource = xs ? decodeURIComponent(xs) : undefined;

  return {
    infoHash,
    infoHashHex,
    name,
    trackers,
    webSeeds,
    exactSource,
  };
}

/**
 * Simple base32 decoder for magnet URIs
 */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const output: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of input) {
    const val = alphabet.indexOf(char);
    if (val === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    buffer = (buffer << 5) | val;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      output.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return Buffer.from(output);
}

/**
 * Create a magnet URI from torrent metadata
 *
 * @param metadata - Parsed torrent metadata
 * @returns Magnet URI string
 */
export function createMagnetUri(metadata: TorrentMetadata): string {
  const parts = [
    `magnet:?xt=urn:btih:${metadata.infoHashHex}`,
    `dn=${encodeURIComponent(metadata.name)}`,
  ];

  // Add trackers
  if (metadata.announceList) {
    for (const tier of metadata.announceList) {
      for (const tracker of tier) {
        parts.push(`tr=${encodeURIComponent(tracker)}`);
      }
    }
  } else {
    parts.push(`tr=${encodeURIComponent(metadata.announce)}`);
  }

  return parts.join('&');
}
