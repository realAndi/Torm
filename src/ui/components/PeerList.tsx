import React from 'react';
import { Box, Text } from 'ink';
import type { Peer } from '../../engine/types.js';
import { colors, borders } from '../theme/index.js';
import { formatSpeedCompact, formatProgress, formatAddress, countryCodeToFlag } from '../utils/format.js';

export interface PeerListProps {
  /** Array of connected peers to display */
  peers: Peer[];
}

/**
 * Column widths for peer list display
 */
const COLUMN_WIDTHS = {
  flag: 3,
  address: 22,
  client: 16,
  progress: 6,
  download: 9,
  upload: 9,
  flags: 6,
} as const;

/**
 * Format peer flags into a readable string
 *
 * Flags:
 * - D: Downloading from peer
 * - U: Uploading to peer
 * - d: Peer wants to download from us
 * - u: Peer wants to upload to us
 * - K: We are choking peer
 * - k: Peer is choking us
 */
function formatPeerFlags(flags: Peer['flags']): string {
  const result: string[] = [];

  // Choking states
  if (flags.amChoking) result.push('K');
  if (flags.peerChoking) result.push('k');

  // Interest states
  if (flags.amInterested) result.push('d');
  if (flags.peerInterested) result.push('u');

  return result.join('') || '-';
}

/**
 * Truncate client name to fit column
 */
function truncateClient(client: string, maxLength: number): string {
  if (client.length <= maxLength) {
    return client.padEnd(maxLength);
  }
  return client.slice(0, maxLength - 1) + '\u2026';
}

/**
 * Header row for peer list
 */
const PeerListHeader: React.FC = () => {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" paddingX={1}>
        <Box width={COLUMN_WIDTHS.flag}>
          <Text color={colors.primary} bold> </Text>
        </Box>
        <Box width={COLUMN_WIDTHS.address}>
          <Text color={colors.primary} bold>Address</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.client}>
          <Text color={colors.primary} bold>Client</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.progress} justifyContent="flex-end">
          <Text color={colors.primary} bold>Prog</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.download} justifyContent="flex-end">
          <Text color={colors.primary} bold>{'\u2193'} Down</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.upload} justifyContent="flex-end">
          <Text color={colors.primary} bold>{'\u2191'} Up</Text>
        </Box>
        <Box width={COLUMN_WIDTHS.flags} justifyContent="center">
          <Text color={colors.primary} bold>Flags</Text>
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text color={colors.muted}>
          {borders.horizontal.repeat(
            COLUMN_WIDTHS.flag +
            COLUMN_WIDTHS.address +
            COLUMN_WIDTHS.client +
            COLUMN_WIDTHS.progress +
            COLUMN_WIDTHS.download +
            COLUMN_WIDTHS.upload +
            COLUMN_WIDTHS.flags
          )}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Single peer row component
 */
const PeerRow: React.FC<{ peer: Peer }> = ({ peer }) => {
  const flag = countryCodeToFlag(peer.country);
  const address = formatAddress(peer.ip, peer.port);
  const client = truncateClient(peer.client || 'Unknown', COLUMN_WIDTHS.client);
  const progress = formatProgress(peer.progress);
  const downloadSpeed = formatSpeedCompact(peer.downloadSpeed);
  const uploadSpeed = formatSpeedCompact(peer.uploadSpeed);
  const flags = formatPeerFlags(peer.flags);

  // Color speeds based on activity
  const downloadColor = peer.downloadSpeed > 0 ? colors.success : colors.muted;
  const uploadColor = peer.uploadSpeed > 0 ? colors.primary : colors.muted;

  return (
    <Box flexDirection="row" paddingX={1}>
      <Box width={COLUMN_WIDTHS.flag}>
        <Text>{flag}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.address}>
        <Text>{address.padEnd(COLUMN_WIDTHS.address)}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.client}>
        <Text color={colors.muted}>{client}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.progress} justifyContent="flex-end">
        <Text>{progress.padStart(COLUMN_WIDTHS.progress)}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.download} justifyContent="flex-end">
        <Text color={downloadColor}>{downloadSpeed.padStart(COLUMN_WIDTHS.download)}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.upload} justifyContent="flex-end">
        <Text color={uploadColor}>{uploadSpeed.padStart(COLUMN_WIDTHS.upload)}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.flags} justifyContent="center">
        <Text color={colors.muted}>{flags}</Text>
      </Box>
    </Box>
  );
};

/**
 * Empty state when no peers are connected
 */
const EmptyState: React.FC = () => {
  return (
    <Box paddingX={1} paddingY={1}>
      <Text color={colors.muted}>No peers connected</Text>
    </Box>
  );
};

/**
 * PeerList component for displaying connected peers
 *
 * Shows a table of connected peers with their IP:Port, client name,
 * download progress, transfer speeds, and connection flags.
 *
 * @example
 * <PeerList peers={torrent.peers} />
 *
 * // Output:
 * // Address              Client            Prog   Down      Up    Flags
 * // ─────────────────────────────────────────────────────────────────────
 * // 192.168.1.100:6881   qBittorrent 4.5   100%   0B/s   256K/s    Ku
 * // 10.0.0.50:51413      Transmission 3    45%  1.2M/s    0B/s    kd
 */
export const PeerList: React.FC<PeerListProps> = ({ peers }) => {
  if (peers.length === 0) {
    return <EmptyState />;
  }

  return (
    <Box flexDirection="column">
      <PeerListHeader />
      {peers.map((peer) => (
        <PeerRow key={peer.id} peer={peer} />
      ))}
    </Box>
  );
};

export default PeerList;
