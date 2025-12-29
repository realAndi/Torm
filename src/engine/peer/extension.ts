/**
 * BEP 10 Extension Protocol Implementation
 *
 * Implements the Extension Protocol (BEP 10) which provides a framework
 * for adding extensions to the BitTorrent protocol. This module handles:
 * - Extension handshake negotiation
 * - Extension message routing
 * - Built-in extensions: ut_pex (Peer Exchange)
 *
 * @see https://www.bittorrent.org/beps/bep_0010.html
 * @module engine/peer/extension
 */

import { TypedEventEmitter } from '../events.js';
import { encode as bencode, decode as bdecode } from '../bencode.js';
import {
  encodeExtended,
  decodeExtended,
  MessageType,
  type ExtendedMessage,
} from './messages.js';

// =============================================================================
// Constants
// =============================================================================

/** Extended message ID for extension handshake */
const EXTENSION_HANDSHAKE_ID = 0;

/** Client identifier for extension handshake */
const CLIENT_NAME = 'Torm 0.1.0';

/** Maximum peers to include in a single PEX message (BEP 11 limit) */
const MAX_PEX_PEERS = 50;

/** Minimum interval between PEX messages in milliseconds (1 minute per BEP 11) */
const PEX_INTERVAL_MS = 60_000;

// =============================================================================
// Types
// =============================================================================

/**
 * Known extension names and their common message IDs
 */
export const KnownExtensions = {
  /** Peer Exchange (BEP 11) */
  UT_PEX: 'ut_pex',
  /** Metadata Exchange (BEP 9) */
  UT_METADATA: 'ut_metadata',
  /** μTP hole punching */
  UT_HOLEPUNCH: 'ut_holepunch',
} as const;

/**
 * Extension handshake message structure (bencoded dictionary)
 */
export interface ExtensionHandshake {
  /** Map of extension name to local message ID */
  m: Record<string, number>;
  /** Client name/version (optional) */
  v?: string;
  /** TCP listen port (optional) */
  p?: number;
  /** Your external IP as seen by the peer (optional) */
  yourip?: Buffer;
  /** IPv6 address (optional) */
  ipv6?: Buffer;
  /** IPv4 address (optional) */
  ipv4?: Buffer;
  /** Request queue length (optional) */
  reqq?: number;
  /** Metadata size in bytes (optional, for ut_metadata) */
  metadata_size?: number;
}

/**
 * Peer info for PEX
 */
export interface PexPeer {
  /** IP address */
  ip: string;
  /** Port */
  port: number;
  /** Peer flags */
  flags?: number;
}

/**
 * PEX message structure (BEP 11)
 */
export interface PexMessage {
  /** Added IPv4 peers (6 bytes each: 4 IP + 2 port) */
  added: Buffer;
  /** Flags for added IPv4 peers */
  'added.f'?: Buffer;
  /** Added IPv6 peers (18 bytes each: 16 IP + 2 port) */
  added6?: Buffer;
  /** Flags for added IPv6 peers */
  'added6.f'?: Buffer;
  /** Dropped IPv4 peers */
  dropped: Buffer;
  /** Dropped IPv6 peers */
  dropped6?: Buffer;
}

/**
 * PEX flags (BEP 11)
 */
export const PexFlags = {
  /** Peer prefers encrypted connections */
  PREFERS_ENCRYPTION: 0x01,
  /** Peer is a seed (has all pieces) */
  IS_SEED: 0x02,
  /** Peer supports uTP */
  SUPPORTS_UTP: 0x04,
  /** Peer supports ut_holepunch */
  SUPPORTS_HOLEPUNCH: 0x08,
  /** Peer is reachable (not behind NAT) */
  IS_REACHABLE: 0x10,
} as const;

/**
 * Events emitted by ExtensionManager
 */
export interface ExtensionEvents {
  /** Extension handshake received from peer */
  handshake: {
    peerId: string;
    extensions: Record<string, number>;
    clientName?: string;
    metadata_size?: number;
  };

  /** PEX message received */
  pex: {
    peerId: string;
    added: PexPeer[];
    dropped: PexPeer[];
  };

  /** Metadata received (for ut_metadata) */
  metadata: {
    peerId: string;
    piece: number;
    data: Buffer;
  };
}

// =============================================================================
// ExtensionManager Class
// =============================================================================

/**
 * Manages BEP 10 extensions for a peer connection
 */
export class ExtensionManager extends TypedEventEmitter<ExtensionEvents> {
  /** Our extension message ID assignments */
  private readonly localExtensions: Map<string, number> = new Map();

  /** Remote peer's extension message ID assignments */
  private readonly remoteExtensions: Map<string, number> = new Map();

  /** Reverse lookup: message ID -> extension name */
  private readonly remoteIdToName: Map<number, string> = new Map();

  /** Whether we've sent our handshake */
  private handshakeSent: boolean = false;

  /** Whether we've received remote handshake */
  private handshakeReceived: boolean = false;

  /** Remote peer's client name */
  private remoteClientName?: string;

  /** Remote peer's metadata size (for ut_metadata) */
  private remoteMetadataSize?: number;

  /** Last PEX message time */
  private lastPexTime: number = 0;

  /** Known peers for PEX tracking */
  private readonly knownPeers: Set<string> = new Set();

  /** Recently added peers (for PEX delta) */
  private readonly recentlyAdded: Set<string> = new Set();

  /** Recently dropped peers (for PEX delta) */
  private readonly recentlyDropped: Set<string> = new Set();

  constructor() {
    super();

    // Register our supported extensions with local message IDs
    // IDs 1-255 are available (0 is reserved for handshake)
    this.localExtensions.set(KnownExtensions.UT_PEX, 1);
    this.localExtensions.set(KnownExtensions.UT_METADATA, 2);
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Create the extension handshake message to send to peer
   */
  createHandshake(options: {
    listenPort?: number;
    metadataSize?: number;
  } = {}): Buffer {
    const handshake: ExtensionHandshake = {
      m: Object.fromEntries(this.localExtensions),
      v: CLIENT_NAME,
    };

    if (options.listenPort) {
      handshake.p = options.listenPort;
    }

    if (options.metadataSize) {
      handshake.metadata_size = options.metadataSize;
    }

    const payload = Buffer.from(bencode(handshake));
    this.handshakeSent = true;

    return encodeExtended(EXTENSION_HANDSHAKE_ID, payload);
  }

  /**
   * Handle an incoming extended message
   */
  handleMessage(peerId: string, message: ExtendedMessage): void {
    if (message.extendedId === EXTENSION_HANDSHAKE_ID) {
      this.handleHandshake(peerId, message.payload);
      return;
    }

    // Look up extension by remote's message ID
    const extensionName = this.remoteIdToName.get(message.extendedId);
    if (!extensionName) {
      // Unknown extension ID, ignore
      return;
    }

    switch (extensionName) {
      case KnownExtensions.UT_PEX:
        this.handlePexMessage(peerId, message.payload);
        break;
      case KnownExtensions.UT_METADATA:
        this.handleMetadataMessage(peerId, message.payload);
        break;
      default:
        // Unknown extension, ignore
        break;
    }
  }

  /**
   * Check if the remote peer supports an extension
   */
  supportsExtension(name: string): boolean {
    return this.remoteExtensions.has(name);
  }

  /**
   * Get the remote message ID for an extension
   */
  getRemoteExtensionId(name: string): number | undefined {
    return this.remoteExtensions.get(name);
  }

  /**
   * Create a PEX message with added/dropped peers
   */
  createPexMessage(added: PexPeer[], dropped: PexPeer[]): Buffer | null {
    const remoteId = this.remoteExtensions.get(KnownExtensions.UT_PEX);
    if (remoteId === undefined) {
      return null; // Peer doesn't support PEX
    }

    // Limit to MAX_PEX_PEERS per message
    const limitedAdded = added.slice(0, MAX_PEX_PEERS);
    const limitedDropped = dropped.slice(0, MAX_PEX_PEERS);

    // Encode IPv4 peers (6 bytes each: 4 IP + 2 port)
    const addedBuf = this.encodePeers(limitedAdded.filter(p => !p.ip.includes(':')));
    const addedFlags = Buffer.alloc(limitedAdded.filter(p => !p.ip.includes(':')).length);
    limitedAdded.filter(p => !p.ip.includes(':')).forEach((p, i) => {
      addedFlags[i] = p.flags ?? 0;
    });

    const droppedBuf = this.encodePeers(limitedDropped.filter(p => !p.ip.includes(':')));

    const pexMessage: PexMessage = {
      added: addedBuf,
      'added.f': addedFlags,
      dropped: droppedBuf,
    };

    const payload = Buffer.from(bencode(pexMessage));
    return encodeExtended(remoteId, payload);
  }

  /**
   * Track a peer as added (for PEX delta tracking)
   */
  trackPeerAdded(ip: string, port: number): void {
    const key = `${ip}:${port}`;
    this.recentlyDropped.delete(key);
    if (!this.knownPeers.has(key)) {
      this.knownPeers.add(key);
      this.recentlyAdded.add(key);
    }
  }

  /**
   * Track a peer as dropped (for PEX delta tracking)
   */
  trackPeerDropped(ip: string, port: number): void {
    const key = `${ip}:${port}`;
    this.recentlyAdded.delete(key);
    if (this.knownPeers.has(key)) {
      this.knownPeers.delete(key);
      this.recentlyDropped.add(key);
    }
  }

  /**
   * Get pending PEX updates and clear the tracking
   */
  getPendingPexUpdates(): { added: PexPeer[]; dropped: PexPeer[] } {
    const now = Date.now();
    if (now - this.lastPexTime < PEX_INTERVAL_MS) {
      return { added: [], dropped: [] };
    }

    this.lastPexTime = now;

    const added = Array.from(this.recentlyAdded).map(key => {
      const [ip, port] = key.split(':');
      return { ip, port: parseInt(port, 10) };
    });

    const dropped = Array.from(this.recentlyDropped).map(key => {
      const [ip, port] = key.split(':');
      return { ip, port: parseInt(port, 10) };
    });

    this.recentlyAdded.clear();
    this.recentlyDropped.clear();

    return { added, dropped };
  }

  /**
   * Check if extension handshake has been completed
   */
  isHandshakeComplete(): boolean {
    return this.handshakeSent && this.handshakeReceived;
  }

  /**
   * Get remote client name
   */
  getRemoteClientName(): string | undefined {
    return this.remoteClientName;
  }

  /**
   * Get remote metadata size
   */
  getRemoteMetadataSize(): number | undefined {
    return this.remoteMetadataSize;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Handle extension handshake from peer
   */
  private handleHandshake(peerId: string, payload: Buffer): void {
    try {
      const handshake = bdecode(payload) as ExtensionHandshake;

      // Store remote extension mappings
      if (handshake.m) {
        for (const [name, id] of Object.entries(handshake.m)) {
          if (typeof id === 'number' && id > 0) {
            this.remoteExtensions.set(name, id);
            this.remoteIdToName.set(id, name);
          }
        }
      }

      // Store client name
      if (handshake.v) {
        this.remoteClientName = typeof handshake.v === 'string'
          ? handshake.v
          : handshake.v.toString();
      }

      // Store metadata size
      if (typeof handshake.metadata_size === 'number') {
        this.remoteMetadataSize = handshake.metadata_size;
      }

      this.handshakeReceived = true;

      // Emit handshake event
      this.emit('handshake', {
        peerId,
        extensions: Object.fromEntries(this.remoteExtensions),
        clientName: this.remoteClientName,
        metadata_size: this.remoteMetadataSize,
      });
    } catch (err) {
      // Invalid handshake, ignore
    }
  }

  /**
   * Handle PEX message (BEP 11)
   */
  private handlePexMessage(peerId: string, payload: Buffer): void {
    try {
      const pex = bdecode(payload) as PexMessage;
      const added: PexPeer[] = [];
      const dropped: PexPeer[] = [];

      // Decode added IPv4 peers
      if (pex.added && pex.added.length >= 6) {
        const flags = pex['added.f'] || Buffer.alloc(pex.added.length / 6);
        for (let i = 0; i < pex.added.length; i += 6) {
          const ip = `${pex.added[i]}.${pex.added[i + 1]}.${pex.added[i + 2]}.${pex.added[i + 3]}`;
          const port = pex.added.readUInt16BE(i + 4);
          const peerFlags = flags[i / 6] || 0;

          if (port > 0 && port < 65536) {
            added.push({ ip, port, flags: peerFlags });
          }
        }
      }

      // Decode dropped IPv4 peers
      if (pex.dropped && pex.dropped.length >= 6) {
        for (let i = 0; i < pex.dropped.length; i += 6) {
          const ip = `${pex.dropped[i]}.${pex.dropped[i + 1]}.${pex.dropped[i + 2]}.${pex.dropped[i + 3]}`;
          const port = pex.dropped.readUInt16BE(i + 4);

          if (port > 0 && port < 65536) {
            dropped.push({ ip, port });
          }
        }
      }

      if (added.length > 0 || dropped.length > 0) {
        this.emit('pex', { peerId, added, dropped });
      }
    } catch (err) {
      // Invalid PEX message, ignore
    }
  }

  /**
   * Handle metadata message (BEP 9) - placeholder
   */
  private handleMetadataMessage(peerId: string, payload: Buffer): void {
    // TODO: Implement ut_metadata
  }

  /**
   * Encode peers to compact format (6 bytes per IPv4 peer)
   */
  private encodePeers(peers: PexPeer[]): Buffer {
    const buffer = Buffer.alloc(peers.length * 6);

    peers.forEach((peer, i) => {
      const offset = i * 6;
      const parts = peer.ip.split('.').map(Number);

      buffer[offset] = parts[0];
      buffer[offset + 1] = parts[1];
      buffer[offset + 2] = parts[2];
      buffer[offset + 3] = parts[3];
      buffer.writeUInt16BE(peer.port, offset + 4);
    });

    return buffer;
  }
}

// =============================================================================
// Exports
// =============================================================================

export default ExtensionManager;
