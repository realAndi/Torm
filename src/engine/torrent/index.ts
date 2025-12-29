/**
 * Torrent Module for Torm BitTorrent Client
 *
 * Provides torrent file parsing and metadata handling.
 *
 * @module engine/torrent
 */

// Parser exports
export {
  parseTorrent,
  parseMagnetUri,
  getPieceHash,
  getActualPieceLength,
  getFilesForPiece,
  createMagnetUri,
  TorrentFileInfo,
  TorrentMetadata,
  MagnetMetadata,
} from './parser.js';
