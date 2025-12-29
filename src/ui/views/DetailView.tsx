/**
 * DetailView - Detailed view for a single torrent.
 *
 * Provides tabbed navigation for viewing:
 * - Files: List of files in the torrent
 * - Peers: Connected peers
 * - Trackers: Tracker status
 * - Log: Activity log
 *
 * @module ui/views/DetailView
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import type { Torrent, Peer } from '../../engine/types.js';
import { colors, borders } from '../theme/index.js';
import { useKeyboard } from '../hooks/useKeyboard.js';
import { Tabs, Tab, getAdjacentTab, getTabByNumber } from '../components/Tabs.js';
import { PeerList } from '../components/PeerList.js';
import { FileList } from '../components/FileList.js';
import { TrackerList } from '../components/TrackerList.js';
import { LogView, LogEntry } from '../components/LogView.js';
import { formatBytes, formatEta, formatSpeed, formatProgress } from '../utils/format.js';
import { ProgressBar } from '../components/ProgressBar.js';

/**
 * Tab identifiers for detail view sections
 */
type TabId = 'files' | 'peers' | 'trackers' | 'log';

/**
 * Tab configuration for the detail view
 */
const DETAIL_TABS: Tab[] = [
  { id: 'files', label: 'Files' },
  { id: 'peers', label: 'Peers' },
  { id: 'trackers', label: 'Trackers' },
  { id: 'log', label: 'Log' },
];

export interface DetailViewProps {
  /** The torrent to display details for */
  torrent: Torrent;
  /** Connected peers for this torrent */
  peers?: Peer[];
  /** Activity log entries */
  logs?: LogEntry[];
  /** Callback to return to main view */
  onBack: () => void;
  /** Whether keyboard input is enabled (disable when help overlay is open) */
  keyboardEnabled?: boolean;
}

/**
 * Header component showing torrent name and back button
 */
const DetailHeader: React.FC<{ name: string }> = ({ name }) => {
  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1} paddingY={0}>
      <Text color={colors.muted}>
        {'\u2190'} Back (Esc)
      </Text>
      <Text bold color={colors.primary}>
        {name.length > 50 ? name.slice(0, 47) + '\u2026' : name}
      </Text>
    </Box>
  );
};

/**
 * Footer component showing torrent progress and stats
 */
const DetailFooter: React.FC<{ torrent: Torrent }> = ({ torrent }) => {
  const percentage = formatProgress(torrent.progress);
  const downloaded = formatBytes(torrent.downloaded);
  const total = formatBytes(torrent.size);
  const eta = formatEta(torrent.eta);
  const downloadSpeed = formatSpeed(torrent.downloadSpeed);
  const uploadSpeed = formatSpeed(torrent.uploadSpeed);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Separator line */}
      <Box>
        <Text color={colors.muted}>
          {borders.horizontal.repeat(70)}
        </Text>
      </Box>

      {/* Progress line */}
      <Box flexDirection="row" gap={1}>
        <Text>Progress:</Text>
        <ProgressBar progress={torrent.progress} width={20} showPercentage={false} />
        <Text color={colors.primary}>{percentage}</Text>
        <Text color={colors.muted}>{'\u2022'}</Text>
        <Text>{downloaded} / {total}</Text>
        <Text color={colors.muted}>{'\u2022'}</Text>
        <Text>ETA: {eta}</Text>
      </Box>

      {/* Stats line */}
      <Box flexDirection="row">
        <Text>
          <Text color={colors.muted}>Seeds: </Text>
          <Text color={colors.success}>{torrent.seeds}</Text>
          <Text color={colors.muted}> {'\u2022'} Peers: </Text>
          <Text color={colors.primary}>{torrent.peers}</Text>
          <Text color={colors.muted}> {'\u2022'} </Text>
          <Text color={colors.success}>{'\u2193'} {downloadSpeed}</Text>
          <Text color={colors.muted}> {'\u2022'} </Text>
          <Text color={colors.primary}>{'\u2191'} {uploadSpeed}</Text>
        </Text>
      </Box>
    </Box>
  );
};

/**
 * DetailView component for displaying torrent details
 *
 * Shows comprehensive information about a single torrent with
 * tabbed navigation between Files, Peers, Trackers, and Log views.
 *
 * Layout:
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │ ← Back                                     ubuntu-24.04.iso │
 * ├─────────────────────────────────────────────────────────────┤
 * │ [1:Files]  2:Peers   3:Trackers   4:Log                     │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                             │
 * │  Tab content area (varies by active tab)                    │
 * │                                                             │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Progress: ████████░░ 80% • 3.8 GB / 4.7 GB • ETA: 5m        │
 * │ Seeds: 12 • Peers: 45 • ↓ 2.1 MB/s • ↑ 256 KB/s             │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * Keyboard shortcuts:
 * - `Esc` or `Backspace`: Return to main view
 * - `←/→` or `h/l`: Switch tabs
 * - `1-4`: Jump to tab by number
 *
 * @example
 * <DetailView
 *   torrent={selectedTorrent}
 *   onBack={() => setView('main')}
 * />
 */
export const DetailView: React.FC<DetailViewProps> = ({
  torrent,
  peers = [],
  logs = [],
  onBack,
  keyboardEnabled = true,
}) => {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('files');

  // Tab navigation handlers
  const handlePrevTab = useCallback(() => {
    setActiveTab((current) => getAdjacentTab(DETAIL_TABS, current, -1) as TabId);
  }, []);

  const handleNextTab = useCallback(() => {
    setActiveTab((current) => getAdjacentTab(DETAIL_TABS, current, 1) as TabId);
  }, []);

  const handleTabNumber = useCallback((num: number) => {
    const tabId = getTabByNumber(DETAIL_TABS, num);
    if (tabId) {
      setActiveTab(tabId as TabId);
    }
  }, []);

  // Keyboard handling
  useKeyboard({
    handlers: {
      // Back navigation
      escape: onBack,
      backspace: onBack,
      // Tab navigation
      left: handlePrevTab,
      right: handleNextTab,
      h: handlePrevTab,
      l: handleNextTab,
      // Direct tab selection
      '1': () => handleTabNumber(1),
      '2': () => handleTabNumber(2),
      '3': () => handleTabNumber(3),
      '4': () => handleTabNumber(4),
    },
    enabled: keyboardEnabled,
  });

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'files':
        return <FileList files={torrent.files} />;
      case 'peers':
        return <PeerList peers={peers} />;
      case 'trackers':
        return <TrackerList trackers={torrent.trackers} />;
      case 'log':
        return <LogView logs={logs} />;
      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Header with back button and torrent name */}
      <DetailHeader name={torrent.name} />

      {/* Separator */}
      <Box paddingX={1}>
        <Text color={colors.muted}>
          {borders.horizontal.repeat(70)}
        </Text>
      </Box>

      {/* Tab bar */}
      <Tabs
        tabs={DETAIL_TABS}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
      />

      {/* Tab content */}
      <Box flexDirection="column" flexGrow={1} paddingY={1}>
        {renderTabContent()}
      </Box>

      {/* Footer with progress and stats */}
      <DetailFooter torrent={torrent} />
    </Box>
  );
};

export default DetailView;
