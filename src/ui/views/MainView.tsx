import React, { useMemo } from 'react';
import { Box } from 'ink';
import { Header } from '../components/Header.js';
import { TorrentList, filterTorrents } from '../components/TorrentList.js';
import { StatusBar } from '../components/StatusBar.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import type { Torrent } from '../../engine/types.js';
import type { StatusFilter } from '../components/SearchBar.js';
import type { MascotExpression } from '../components/Mascot.js';

export interface MainViewProps {
  /** Array of torrents to display */
  torrents: Torrent[];
  /** Index of the currently selected torrent (0-based) */
  selectedIndex: number;
  /** Total download speed across all torrents in bytes/second */
  totalDownloadSpeed: number;
  /** Total upload speed across all torrents in bytes/second */
  totalUploadSpeed: number;
  /** Callback when selection changes */
  onSelectChange: (index: number) => void;
  /** Current search query */
  searchQuery: string;
  /** Callback when search query changes */
  onSearchChange: (query: string) => void;
  /** Current status filter */
  statusFilter: StatusFilter;
  /** Callback when status filter changes */
  onStatusFilterChange: (filter: StatusFilter) => void;
  /** Whether the search input is focused */
  isSearchFocused: boolean;
  /** Callback to set search focus state */
  onSearchFocusChange: (focused: boolean) => void;
  /** Whether daemon is connected */
  daemonConnected?: boolean;
  /** Daemon uptime in seconds */
  daemonUptime?: number;
  /** Connection status message */
  connectionStatus?: string;
  /** Minimum number of torrents to display in scroll list */
  minVisibleTorrents?: number;
  /** Mascot expression to display */
  mascotExpression?: MascotExpression;
  /** Whether mascot is sleeping */
  mascotSleeping?: boolean;
  /** Number of Z's to show when sleeping */
  mascotSleepZCount?: number;
  /** Whether downloads are active */
  isDownloading?: boolean;
  /** Whether an update is available */
  updateAvailable?: boolean;
  /** Latest version available */
  latestVersion?: string | null;
}

/**
 * Main view component for Torm TUI
 *
 * Layout:
 * 1. ASCII art header (left-aligned, no border)
 * 2. TorrentList (with integrated search in Name column)
 * 3. StatusBar (hotkeys left, speeds right)
 */
export const MainView: React.FC<MainViewProps> = ({
  torrents,
  selectedIndex,
  totalDownloadSpeed,
  totalUploadSpeed,
  onSelectChange,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange: _onStatusFilterChange,
  isSearchFocused,
  onSearchFocusChange,
  daemonConnected = false,
  daemonUptime,
  connectionStatus,
  minVisibleTorrents = 5,
  mascotExpression = 'default',
  mascotSleeping = false,
  mascotSleepZCount = 0,
  isDownloading = false,
  updateAvailable = false,
  latestVersion,
}) => {
  const { columns } = useTerminalSize();

  // Get filtered torrents for StatusBar
  const filteredTorrents = useMemo(
    () => filterTorrents(torrents, searchQuery, statusFilter),
    [torrents, searchQuery, statusFilter]
  );

  const selectedTorrent =
    filteredTorrents.length > 0
      ? (filteredTorrents[selectedIndex] ?? null)
      : null;

  const isFiltered =
    (searchQuery && searchQuery.trim().length > 0) ||
    (statusFilter && statusFilter !== 'all');

  return (
    <Box flexDirection="column" height="100%">
      {/* ASCII art header - left aligned, no border */}
      <Header
        mascotExpression={mascotExpression}
        mascotSleeping={mascotSleeping}
        mascotSleepZCount={mascotSleepZCount}
        isDownloading={isDownloading}
      />

      {/* Torrent list with integrated search */}
      <Box flexGrow={1} flexDirection="column">
        <TorrentList
          torrents={torrents}
          selectedIndex={selectedIndex}
          onSelect={onSelectChange}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          statusFilter={statusFilter}
          isSearchFocused={isSearchFocused}
          onSearchFocusChange={onSearchFocusChange}
          width={columns}
          minVisibleTorrents={minVisibleTorrents}
        />
      </Box>

      {/* Status bar with hotkeys (left) and speeds (right) */}
      <StatusBar
        selectedTorrent={selectedTorrent}
        selectedIndex={selectedIndex + 1}
        totalCount={torrents.length}
        filteredCount={filteredTorrents.length}
        isFiltered={isFiltered}
        statusFilter={statusFilter}
        width={columns}
        totalDownloadSpeed={totalDownloadSpeed}
        totalUploadSpeed={totalUploadSpeed}
        daemonConnected={daemonConnected}
        daemonUptime={daemonUptime}
        connectionStatus={connectionStatus}
        updateAvailable={updateAvailable}
        latestVersion={latestVersion}
      />
    </Box>
  );
};

export default MainView;
