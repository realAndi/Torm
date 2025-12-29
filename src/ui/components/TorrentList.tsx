import React, { useMemo, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ScrollList, ScrollListRef } from 'ink-scroll-list';
import { Torrent } from '../../engine/types.js';
import { TorrentRow, calculateColumnWidths } from './TorrentRow.js';
import { colors, borders } from '../theme/index.js';
import type { StatusFilter } from './SearchBar.js';

export interface TorrentListProps {
  /** Array of torrents to display */
  torrents: Torrent[];
  /** Index of the currently selected torrent (0-based) */
  selectedIndex: number;
  /** Callback when selection changes */
  onSelect: (index: number) => void;
  /** Search query to filter torrents by name (optional) */
  searchQuery?: string;
  /** Callback when search query changes */
  onSearchChange?: (query: string) => void;
  /** Status filter to filter torrents by state (optional) */
  statusFilter?: StatusFilter;
  /** Whether search is focused */
  isSearchFocused?: boolean;
  /** Callback when search focus changes */
  onSearchFocusChange?: (focused: boolean) => void;
  /** Terminal width in columns for responsive layout */
  width?: number;
  /** Minimum number of torrents visible in the scroll list (default: 8) */
  minVisibleTorrents?: number;
}

/**
 * Filter torrents based on search query and status filter
 */
export function filterTorrents(
  torrents: Torrent[],
  searchQuery?: string,
  statusFilter?: StatusFilter
): Torrent[] {
  let filtered = torrents;

  if (searchQuery && searchQuery.trim().length > 0) {
    const query = searchQuery.toLowerCase().trim();
    filtered = filtered.filter((t) => t.name.toLowerCase().includes(query));
  }

  if (statusFilter && statusFilter !== 'all') {
    filtered = filtered.filter((t) => t.state === statusFilter);
  }

  return filtered;
}

/**
 * Calculate total table width (inner width, excluding outer borders)
 */
function getTotalWidth(width: number) {
  const cols = calculateColumnWidths(width);
  // 6 internal separators between 7 columns
  return (
    cols.name +
    cols.progress +
    cols.size +
    cols.speed +
    cols.seeds +
    cols.peers +
    cols.status +
    6
  );
}

/**
 * Get minimum terminal width for the table
 */
const MIN_WIDTH = 60;

/** Cursor character */
const CURSOR_CHAR = '▌';

/**
 * TorrentList with integrated search in the Name column header
 */
export const TorrentList: React.FC<TorrentListProps> = ({
  torrents,
  selectedIndex,
  onSelect,
  searchQuery = '',
  onSearchChange,
  statusFilter,
  isSearchFocused = false,
  onSearchFocusChange,
  width = 80,
  minVisibleTorrents = 5,
}) => {
  const scrollListRef = useRef<ScrollListRef>(null);
  // Ensure minimum width to prevent layout issues
  const effectiveWidth = Math.max(MIN_WIDTH, width);
  const cols = calculateColumnWidths(effectiveWidth);
  const totalWidth = getTotalWidth(effectiveWidth);

  // Handle search input
  useInput(
    (input, key) => {
      if (!onSearchChange) return;

      if (key.escape) {
        onSearchChange('');
        onSearchFocusChange?.(false);
        return;
      }

      if (key.backspace || key.delete) {
        if (searchQuery.length > 0) {
          onSearchChange(searchQuery.slice(0, -1));
        }
        return;
      }

      if (
        key.ctrl ||
        key.meta ||
        key.upArrow ||
        key.downArrow ||
        key.return ||
        key.tab
      ) {
        return;
      }

      if (input && input.length > 0) {
        onSearchChange(searchQuery + input);
      }
    },
    { isActive: isSearchFocused }
  );

  // Filter torrents
  const filteredTorrents = useMemo(
    () => filterTorrents(torrents, searchQuery, statusFilter),
    [torrents, searchQuery, statusFilter]
  );

  // Keep scroll position synced with selection
  useEffect(() => {
    if (scrollListRef.current && filteredTorrents.length > 0) {
      scrollListRef.current.scrollToItem(selectedIndex, 'auto');
    }
  }, [selectedIndex, filteredTorrents.length]);

  // Remeasure scroll list when terminal width changes
  useEffect(() => {
    if (scrollListRef.current) {
      scrollListRef.current.remeasure?.();
    }
  }, [width]);

  const hasActiveFilters =
    (searchQuery && searchQuery.trim().length > 0) ||
    (statusFilter && statusFilter !== 'all');

  // Calculate search display width
  const searchDisplayWidth = cols.name - 8; // " Name: " = 7 chars + 1 for cursor
  const displayQuery =
    searchQuery.length > searchDisplayWidth - 1
      ? searchQuery.slice(-(searchDisplayWidth - 1))
      : searchQuery;

  // Render header
  const renderHeader = () => (
    <Box flexDirection="column">
      {/* Top border */}
      <Text color={colors.border}>
        {borders.rounded.topLeft}
        {borders.horizontal.repeat(totalWidth)}
        {borders.rounded.topRight}
      </Text>

      {/* Header row */}
      <Box flexDirection="row">
        <Text color={colors.border}>{borders.vertical}</Text>

        {/* Name column with integrated search */}
        <Box width={cols.name}>
          {isSearchFocused ? (
            <Text>
              <Text color={colors.primary}> Filter: </Text>
              <Text color={colors.text}>{displayQuery}</Text>
              <Text color={colors.primary}>{CURSOR_CHAR}</Text>
            </Text>
          ) : searchQuery ? (
            <Text>
              <Text color={colors.primary}> Filter: </Text>
              <Text color={colors.text}>{displayQuery}</Text>
              <Text color={colors.muted}> (Esc to clear)</Text>
            </Text>
          ) : (
            <Text bold color={colors.muted}>
              {' '}
              Name
            </Text>
          )}
        </Box>

        <Text color={colors.borderDim}>{borders.vertical}</Text>

        <Box width={cols.progress}>
          <Text bold color={colors.muted}>
            {' '}
            Progress
          </Text>
        </Box>

        <Text color={colors.borderDim}>{borders.vertical}</Text>

        <Box width={cols.size} justifyContent="flex-end">
          <Text bold color={colors.muted}>
            Size{' '}
          </Text>
        </Box>

        <Text color={colors.borderDim}>{borders.vertical}</Text>

        <Box width={cols.speed} justifyContent="flex-end">
          <Text bold color={colors.muted}>
            Speed{' '}
          </Text>
        </Box>

        <Text color={colors.borderDim}>{borders.vertical}</Text>

        <Box width={cols.seeds} justifyContent="flex-end">
          <Text bold color={colors.muted}>
            Seeds{' '}
          </Text>
        </Box>

        <Text color={colors.borderDim}>{borders.vertical}</Text>

        <Box width={cols.peers} justifyContent="flex-end">
          <Text bold color={colors.muted}>
            Peers{' '}
          </Text>
        </Box>

        <Text color={colors.borderDim}>{borders.vertical}</Text>

        <Box width={cols.status}>
          <Text bold color={colors.muted}>
            {' '}
            Status
          </Text>
        </Box>

        <Text color={colors.border}>{borders.vertical}</Text>
      </Box>

      {/* Header separator */}
      <Text color={colors.border}>
        {borders.junctions.left}
        {borders.horizontal.repeat(cols.name)}
        {borders.junctions.cross}
        {borders.horizontal.repeat(cols.progress)}
        {borders.junctions.cross}
        {borders.horizontal.repeat(cols.size)}
        {borders.junctions.cross}
        {borders.horizontal.repeat(cols.speed)}
        {borders.junctions.cross}
        {borders.horizontal.repeat(cols.seeds)}
        {borders.junctions.cross}
        {borders.horizontal.repeat(cols.peers)}
        {borders.junctions.cross}
        {borders.horizontal.repeat(cols.status)}
        {borders.junctions.right}
      </Text>
    </Box>
  );

  // Render footer
  const renderFooter = () => (
    <Text color={colors.border}>
      {borders.rounded.bottomLeft}
      {borders.horizontal.repeat(totalWidth)}
      {borders.rounded.bottomRight}
    </Text>
  );

  // Render an empty placeholder row with borders (for filling scroll gaps)
  const renderEmptyRow = (key: string) => (
    <Box key={key} flexDirection="row">
      <Text color={colors.border}>{borders.vertical}</Text>
      <Box width={cols.name}>
        <Text>{' '.repeat(cols.name)}</Text>
      </Box>
      <Text color={colors.borderDim}>{borders.vertical}</Text>
      <Box width={cols.progress}>
        <Text>{' '.repeat(cols.progress)}</Text>
      </Box>
      <Text color={colors.borderDim}>{borders.vertical}</Text>
      <Box width={cols.size}>
        <Text>{' '.repeat(cols.size)}</Text>
      </Box>
      <Text color={colors.borderDim}>{borders.vertical}</Text>
      <Box width={cols.speed}>
        <Text>{' '.repeat(cols.speed)}</Text>
      </Box>
      <Text color={colors.borderDim}>{borders.vertical}</Text>
      <Box width={cols.seeds}>
        <Text>{' '.repeat(cols.seeds)}</Text>
      </Box>
      <Text color={colors.borderDim}>{borders.vertical}</Text>
      <Box width={cols.peers}>
        <Text>{' '.repeat(cols.peers)}</Text>
      </Box>
      <Text color={colors.borderDim}>{borders.vertical}</Text>
      <Box width={cols.status}>
        <Text>{' '.repeat(cols.status)}</Text>
      </Box>
      <Text color={colors.border}>{borders.vertical}</Text>
    </Box>
  );

  // Render empty state - each line needs proper borders
  const renderEmptyState = (isFiltered: boolean) => {
    const line1 = isFiltered
      ? 'No matching torrents found'
      : 'No torrents added yet';
    const line2 = isFiltered
      ? 'Press Escape to clear filter'
      : "Press 'a' to add a torrent";
    // All rows should have exactly totalWidth characters between the borders
    const emptyRow = ' '.repeat(totalWidth);
    const line1Padded =
      ' ' + line1 + ' '.repeat(Math.max(0, totalWidth - line1.length - 1));
    const line2Padded =
      ' ' + line2 + ' '.repeat(Math.max(0, totalWidth - line2.length - 1));

    return (
      <Box flexDirection="column">
        {/* Empty row for spacing */}
        <Box>
          <Text color={colors.border}>{borders.vertical}</Text>
          <Text>{emptyRow}</Text>
          <Text color={colors.border}>{borders.vertical}</Text>
        </Box>
        {/* Line 1 */}
        <Box>
          <Text color={colors.border}>{borders.vertical}</Text>
          <Text color={colors.muted}>{line1Padded}</Text>
          <Text color={colors.border}>{borders.vertical}</Text>
        </Box>
        {/* Line 2 */}
        <Box>
          <Text color={colors.border}>{borders.vertical}</Text>
          <Text color={colors.dim}>{line2Padded}</Text>
          <Text color={colors.border}>{borders.vertical}</Text>
        </Box>
        {/* Empty row for spacing */}
        <Box>
          <Text color={colors.border}>{borders.vertical}</Text>
          <Text>{emptyRow}</Text>
          <Text color={colors.border}>{borders.vertical}</Text>
        </Box>
      </Box>
    );
  };

  // Handle empty states
  if (torrents.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        {renderHeader()}
        {renderEmptyState(false)}
        {renderFooter()}
      </Box>
    );
  }

  if (filteredTorrents.length === 0 && hasActiveFilters) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        {renderHeader()}
        {renderEmptyState(true)}
        {renderFooter()}
      </Box>
    );
  }

  // Calculate how many empty rows we need to fill the gap
  const emptyRowsCount = Math.max(
    0,
    minVisibleTorrents - filteredTorrents.length
  );
  const emptyRows = Array.from({ length: emptyRowsCount }, (_, i) =>
    renderEmptyRow(`empty-${i}`)
  );

  // Only use ScrollList when we have more torrents than minVisibleTorrents
  const needsScrolling = filteredTorrents.length > minVisibleTorrents;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {renderHeader()}

      {needsScrolling ? (
        /* Scrollable torrent rows when content exceeds minVisibleTorrents */
        <ScrollList
          ref={scrollListRef}
          selectedIndex={selectedIndex}
          onSelectionChange={onSelect}
          scrollAlignment="auto"
          height={minVisibleTorrents}
        >
          {filteredTorrents.map((torrent, index) => (
            <TorrentRow
              key={torrent.infoHash}
              torrent={torrent}
              isSelected={index === selectedIndex}
              index={index + 1}
              width={width}
            />
          ))}
        </ScrollList>
      ) : (
        /* Static rows when content fits within minVisibleTorrents */
        <Box flexDirection="column">
          {filteredTorrents.map((torrent, index) => (
            <TorrentRow
              key={torrent.infoHash}
              torrent={torrent}
              isSelected={index === selectedIndex}
              index={index + 1}
              width={width}
            />
          ))}
          {emptyRows}
        </Box>
      )}

      {renderFooter()}
    </Box>
  );
};

export default TorrentList;
