/**
 * BitTorrent Choking Algorithm Implementation (BEP 3)
 *
 * Implements the choking algorithm as specified in BEP 3, which manages
 * which peers to upload to in order to maximize download speed through
 * reciprocation (tit-for-tat strategy).
 *
 * Key behaviors per BEP 3:
 * - Unchoke top 4 peers by download rate (leeching) or upload rate (seeding)
 * - Rotate optimistic unchoke slot every 30 seconds
 * - Re-evaluate choke decisions every 10 seconds
 * - Snub detection: if peer hasn't sent data in 60 seconds while we're unchoked
 *
 * @module engine/session/choking
 */

import { TypedEventEmitter } from '../events.js';

// =============================================================================
// Constants (BEP 3 specified values with qBittorrent-style optimizations)
// =============================================================================

/** Base number of regular unchoke slots */
const BASE_UNCHOKE_SLOTS = 4;

/** Interval between regular choking recalculations (5 seconds for faster response) */
const RECALCULATE_INTERVAL_MS = 5_000;

/**
 * Calculate dynamic unchoke slots based on peer count (qBittorrent style)
 * Formula: 4 + ceil(sqrt(interestedPeers))
 * This scales upload slots with swarm size for better bandwidth utilization
 */
function calculateUnchokeSlots(interestedPeerCount: number): number {
  return BASE_UNCHOKE_SLOTS + Math.ceil(Math.sqrt(interestedPeerCount));
}

/** Interval between optimistic unchoke rotations (30 seconds) */
const OPTIMISTIC_UNCHOKE_INTERVAL_MS = 30_000;

/** Time without receiving data before considering a peer snubbed (60 seconds) */
const SNUB_THRESHOLD_MS = 60_000;

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Statistics for a peer used in choking decisions
 */
export interface PeerStats {
  /** Unique peer identifier */
  peerId: string;

  /** Current download speed from this peer (bytes/second) */
  downloadRate: number;

  /** Current upload speed to this peer (bytes/second) */
  uploadRate: number;

  /** Whether we are currently choking this peer */
  amChoking: boolean;

  /** Whether the peer is interested in our pieces */
  peerInterested: boolean;

  /** Whether we are interested in the peer's pieces */
  amInterested: boolean;

  /** Whether the peer is choking us */
  peerChoking: boolean;
}

/**
 * Interface for accessing peer information
 */
export interface PeerList {
  /** Get current stats for all peers */
  getPeerStats(): PeerStats[];

  /** Get stats for a specific peer */
  getPeerStat(peerId: string): PeerStats | undefined;
}

/**
 * Represents a choking decision for a peer
 */
export interface ChokingDecision {
  /** Peer identifier */
  peerId: string;

  /** Action to take */
  action: 'choke' | 'unchoke';

  /** Reason for the decision */
  reason: 'regular' | 'optimistic' | 'snubbed' | 'not-interested';
}

/**
 * Events emitted by the ChokingAlgorithm
 */
export interface ChokingEvents {
  /** Emitted when a peer should be choked */
  choke: { peerId: string };

  /** Emitted when a peer should be unchoked */
  unchoke: { peerId: string };

  /** Emitted when a peer is detected as snubbing us */
  snubbed: { peerId: string };
}

/**
 * Internal state for tracking peer activity
 */
interface PeerActivity {
  /** Timestamp of last data received from this peer */
  lastDataReceived: number;

  /** Whether the peer is currently snubbed */
  isSnubbed: boolean;
}

// =============================================================================
// ChokingAlgorithm Class
// =============================================================================

/**
 * BitTorrent Choking Algorithm
 *
 * Manages which peers to choke/unchoke based on BEP 3 specifications.
 * Uses a tit-for-tat strategy with optimistic unchoking to discover
 * better trading partners.
 *
 * @example
 * ```typescript
 * const choking = new ChokingAlgorithm(peerList);
 *
 * choking.on('choke', ({ peerId }) => {
 *   peerManager.sendChoke(infoHash, peerId);
 * });
 *
 * choking.on('unchoke', ({ peerId }) => {
 *   peerManager.sendUnchoke(infoHash, peerId);
 * });
 *
 * choking.on('snubbed', ({ peerId }) => {
 *   console.log(`Peer ${peerId} is snubbing us`);
 * });
 *
 * choking.start();
 * ```
 */
export class ChokingAlgorithm extends TypedEventEmitter<ChokingEvents> {
  // ===========================================================================
  // Private Properties
  // ===========================================================================

  /** Interface for accessing peer statistics */
  private readonly peerList: PeerList;

  /** Whether we are in seeding mode (complete) or leeching mode (downloading) */
  private isSeeding: boolean = false;

  /** Timer for regular recalculation */
  private recalculateTimer: ReturnType<typeof setInterval> | null = null;

  /** Timer for optimistic unchoke rotation */
  private optimisticTimer: ReturnType<typeof setInterval> | null = null;

  /** Currently optimistically unchoked peer ID */
  private optimisticUnchokedPeer: string | null = null;

  /** Set of currently unchoked peer IDs */
  private readonly unchokedPeers: Set<string> = new Set();

  /** Map of peer activity tracking (peerId -> activity) */
  private readonly peerActivity: Map<string, PeerActivity> = new Map();

  /** Set of known peer IDs */
  private readonly knownPeers: Set<string> = new Set();

  /** Whether the algorithm is running */
  private running: boolean = false;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Create a new ChokingAlgorithm
   *
   * @param peerList - Interface for accessing peer statistics
   */
  constructor(peerList: PeerList) {
    super();
    this.peerList = peerList;
  }

  // ===========================================================================
  // Public Methods - Lifecycle
  // ===========================================================================

  /**
   * Start the choking algorithm
   *
   * Begins periodic recalculation of choke decisions and
   * optimistic unchoke rotation.
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Perform initial calculation
    this.recalculate();

    // Start periodic recalculation (every 10 seconds)
    this.recalculateTimer = setInterval(() => {
      this.recalculate();
    }, RECALCULATE_INTERVAL_MS);

    // Start optimistic unchoke rotation (every 30 seconds)
    this.optimisticTimer = setInterval(() => {
      this.rotateOptimisticUnchoke();
    }, OPTIMISTIC_UNCHOKE_INTERVAL_MS);
  }

  /**
   * Stop the choking algorithm
   *
   * Stops all periodic timers and clears internal state.
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.recalculateTimer) {
      clearInterval(this.recalculateTimer);
      this.recalculateTimer = null;
    }

    if (this.optimisticTimer) {
      clearInterval(this.optimisticTimer);
      this.optimisticTimer = null;
    }

    // Clear state
    this.unchokedPeers.clear();
    this.peerActivity.clear();
    this.knownPeers.clear();
    this.optimisticUnchokedPeer = null;
  }

  // ===========================================================================
  // Public Methods - Peer Management
  // ===========================================================================

  /**
   * Update activity timestamp for a peer
   *
   * Called when data is received from a peer to track activity
   * for anti-snubbing detection.
   *
   * @param peerId - The peer that sent data
   */
  updatePeerActivity(peerId: string): void {
    const activity = this.peerActivity.get(peerId);
    const now = Date.now();

    if (activity) {
      // If peer was snubbed but is now active again, clear snubbed status
      if (activity.isSnubbed) {
        activity.isSnubbed = false;
      }
      activity.lastDataReceived = now;
    } else {
      this.peerActivity.set(peerId, {
        lastDataReceived: now,
        isSnubbed: false,
      });
    }
  }

  /**
   * Add a new peer to track
   *
   * @param peerId - The peer identifier
   */
  addPeer(peerId: string): void {
    if (this.knownPeers.has(peerId)) {
      return;
    }

    this.knownPeers.add(peerId);
    this.peerActivity.set(peerId, {
      lastDataReceived: Date.now(),
      isSnubbed: false,
    });

    // Trigger recalculation if running
    if (this.running) {
      this.recalculate();
    }
  }

  /**
   * Remove a peer from tracking
   *
   * @param peerId - The peer identifier
   */
  removePeer(peerId: string): void {
    if (!this.knownPeers.has(peerId)) {
      return;
    }

    this.knownPeers.delete(peerId);
    this.peerActivity.delete(peerId);
    this.unchokedPeers.delete(peerId);

    // Clear optimistic unchoke if this was the optimistic peer
    if (this.optimisticUnchokedPeer === peerId) {
      this.optimisticUnchokedPeer = null;
    }

    // Trigger recalculation if running
    if (this.running) {
      this.recalculate();
    }
  }

  /**
   * Set seeding mode
   *
   * When seeding, the algorithm optimizes for upload rate (reciprocation)
   * rather than download rate.
   *
   * @param isSeeding - Whether we are in seeding mode
   */
  setSeeding(isSeeding: boolean): void {
    const wasSeeding = this.isSeeding;
    this.isSeeding = isSeeding;

    // Recalculate if mode changed and running
    if (wasSeeding !== isSeeding && this.running) {
      this.recalculate();
    }
  }

  /**
   * Get the list of currently unchoked peer IDs
   *
   * @returns Array of unchoked peer IDs
   */
  getUnchoked(): string[] {
    return Array.from(this.unchokedPeers);
  }

  // ===========================================================================
  // Public Methods - Recalculation
  // ===========================================================================

  /**
   * Recalculate choking decisions
   *
   * Evaluates all peers and determines which should be choked/unchoked
   * based on their performance and interest state.
   *
   * @returns Array of choking decisions made
   */
  recalculate(): ChokingDecision[] {
    const decisions: ChokingDecision[] = [];
    const now = Date.now();

    // Get current peer stats
    const allStats = this.peerList.getPeerStats();

    // Check for snubbing
    this.detectSnubbing(now, allStats);

    // Filter to peers that are interested in us (we might upload to them)
    const interestedPeers = allStats.filter((p) => p.peerInterested);

    // Sort by the appropriate rate based on mode
    // When leeching: prefer peers that give us good download rates (reciprocate)
    // When seeding: prefer peers that we can upload to fastest
    const sortedPeers = [...interestedPeers].sort((a, b) => {
      if (this.isSeeding) {
        // When seeding, prioritize peers with highest upload rate (who we upload to most)
        return b.uploadRate - a.uploadRate;
      } else {
        // When leeching, prioritize peers with highest download rate (who give us most)
        return b.downloadRate - a.downloadRate;
      }
    });

    // Calculate dynamic unchoke slots based on interested peer count (qBittorrent style)
    const unchokeSlots = calculateUnchokeSlots(interestedPeers.length);

    // Select top N peers for regular unchoking
    const regularUnchokeSet = new Set<string>();
    const snubbedPeers = this.getSnubbedPeers();

    for (const peer of sortedPeers) {
      if (regularUnchokeSet.size >= unchokeSlots) {
        break;
      }

      // Skip snubbed peers for regular slots when leeching
      if (!this.isSeeding && snubbedPeers.has(peer.peerId)) {
        continue;
      }

      regularUnchokeSet.add(peer.peerId);
    }

    // Determine all peers that should be unchoked
    const shouldBeUnchoked = new Set(regularUnchokeSet);

    // Add optimistic unchoke peer if set and interested
    if (this.optimisticUnchokedPeer) {
      const optStats = this.peerList.getPeerStat(this.optimisticUnchokedPeer);
      if (optStats && optStats.peerInterested) {
        shouldBeUnchoked.add(this.optimisticUnchokedPeer);
      }
    }

    // Calculate changes needed
    // Unchoke peers that should be unchoked but aren't
    for (const peerId of shouldBeUnchoked) {
      if (!this.unchokedPeers.has(peerId)) {
        const reason =
          peerId === this.optimisticUnchokedPeer ? 'optimistic' : 'regular';
        decisions.push({ peerId, action: 'unchoke', reason });
        this.unchokedPeers.add(peerId);
        this.emit('unchoke', { peerId });
      }
    }

    // Choke peers that shouldn't be unchoked anymore
    for (const peerId of this.unchokedPeers) {
      if (!shouldBeUnchoked.has(peerId)) {
        // Determine reason for choking
        const peerStats = this.peerList.getPeerStat(peerId);
        let reason: ChokingDecision['reason'] = 'regular';

        if (!peerStats || !peerStats.peerInterested) {
          reason = 'not-interested';
        } else if (snubbedPeers.has(peerId)) {
          reason = 'snubbed';
        }

        decisions.push({ peerId, action: 'choke', reason });
        this.unchokedPeers.delete(peerId);
        this.emit('choke', { peerId });
      }
    }

    return decisions;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Rotate the optimistic unchoke slot
   *
   * Selects a new random peer for optimistic unchoking, preferring
   * peers that we haven't unchoked before.
   */
  private rotateOptimisticUnchoke(): void {
    const allStats = this.peerList.getPeerStats();

    // Get interested peers that are not in regular unchoke slots
    const regularUnchokeSet = new Set(
      Array.from(this.unchokedPeers).filter(
        (p) => p !== this.optimisticUnchokedPeer
      )
    );

    // Candidates: interested peers not already unchoked in regular slots
    const candidates = allStats.filter(
      (p) =>
        p.peerInterested &&
        !regularUnchokeSet.has(p.peerId) &&
        p.peerId !== this.optimisticUnchokedPeer
    );

    if (candidates.length === 0) {
      // No new candidates, keep current or clear
      if (
        this.optimisticUnchokedPeer &&
        !this.peerList.getPeerStat(this.optimisticUnchokedPeer)
      ) {
        this.optimisticUnchokedPeer = null;
      }
      return;
    }

    // Prefer newly connected peers (those we haven't unchoked before)
    // For simplicity, just pick a random candidate
    const randomIndex = Math.floor(Math.random() * candidates.length);
    const newOptimistic = candidates[randomIndex].peerId;

    // If changing optimistic peer, handle the transition
    if (this.optimisticUnchokedPeer !== newOptimistic) {
      this.optimisticUnchokedPeer = newOptimistic;

      // The next recalculate() call will handle the actual choke/unchoke
      // But we trigger it immediately to apply the change
      this.recalculate();
    }
  }

  /**
   * Detect peers that are snubbing us
   *
   * A peer is considered snubbing us if they haven't sent us any data
   * for SNUB_THRESHOLD_MS while we are unchoked by them and interested.
   *
   * @param now - Current timestamp
   * @param allStats - Current stats for all peers
   */
  private detectSnubbing(now: number, allStats: PeerStats[]): void {
    for (const stats of allStats) {
      const activity = this.peerActivity.get(stats.peerId);
      if (!activity) {
        continue;
      }

      // Check snubbing conditions:
      // - We are interested in the peer
      // - The peer is not choking us (we're unchoked)
      // - No data received for SNUB_THRESHOLD_MS
      const timeSinceData = now - activity.lastDataReceived;
      const isSnubbing =
        stats.amInterested &&
        !stats.peerChoking &&
        timeSinceData >= SNUB_THRESHOLD_MS;

      if (isSnubbing && !activity.isSnubbed) {
        // Newly snubbed
        activity.isSnubbed = true;
        this.emit('snubbed', { peerId: stats.peerId });
      } else if (!isSnubbing && activity.isSnubbed) {
        // No longer snubbed (peer started sending again or we're now choked)
        activity.isSnubbed = false;
      }
    }
  }

  /**
   * Get the set of currently snubbed peer IDs
   *
   * @returns Set of snubbed peer IDs
   */
  private getSnubbedPeers(): Set<string> {
    const snubbed = new Set<string>();

    for (const [peerId, activity] of this.peerActivity) {
      if (activity.isSnubbed) {
        snubbed.add(peerId);
      }
    }

    return snubbed;
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default ChokingAlgorithm;
