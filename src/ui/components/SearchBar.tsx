/**
 * SearchBar component for filtering and searching torrents.
 *
 * Provides a text input for search queries and a dropdown for status filtering.
 * Uses complete box outlines for a polished appearance.
 *
 * @module ui/components/SearchBar
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, borders } from '../theme/index.js';
import { TorrentState } from '../../engine/types.js';

/**
 * Filter options for torrent status
 */
export type StatusFilter = 'all' | TorrentState;

/**
 * Status filter options with display labels
 */
export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: TorrentState.DOWNLOADING, label: 'Downloading' },
  { value: TorrentState.SEEDING, label: 'Seeding' },
  { value: TorrentState.PAUSED, label: 'Paused' },
  { value: TorrentState.ERROR, label: 'Error' },
  { value: TorrentState.CHECKING, label: 'Checking' },
  { value: TorrentState.QUEUED, label: 'Queued' },
];

/**
 * Props for the SearchBar component
 */
export interface SearchBarProps {
  /** Current search query */
  searchQuery: string;
  /** Callback when search query changes */
  onSearchChange: (query: string) => void;
  /** Current status filter */
  statusFilter: StatusFilter;
  /** Callback when status filter changes */
  onStatusFilterChange: (filter: StatusFilter) => void;
  /** Whether the search input is focused */
  isFocused: boolean;
  /** Callback to set focus state */
  onFocusChange: (focused: boolean) => void;
  /** Terminal width for responsive layout */
  width?: number;
}

/** Cursor character displayed at the end of input text */
const CURSOR_CHAR = '▌';

/**
 * SearchBar component for filtering torrents
 *
 * Features a complete bordered box layout with search input and filter dropdown.
 */
export const SearchBar: React.FC<SearchBarProps> = ({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  isFocused,
  onFocusChange,
  width = 80,
}) => {
  // Handle keyboard input when focused
  useInput(
    (input, key) => {
      if (key.escape) {
        onSearchChange('');
        onFocusChange(false);
        return;
      }

      if (key.backspace || key.delete) {
        if (searchQuery.length > 0) {
          onSearchChange(searchQuery.slice(0, -1));
        }
        return;
      }

      if (key.tab) {
        const currentIndex = STATUS_FILTER_OPTIONS.findIndex(
          (opt) => opt.value === statusFilter
        );
        const nextIndex = (currentIndex + 1) % STATUS_FILTER_OPTIONS.length;
        onStatusFilterChange(STATUS_FILTER_OPTIONS[nextIndex].value);
        return;
      }

      if (key.leftArrow) {
        const currentIndex = STATUS_FILTER_OPTIONS.findIndex(
          (opt) => opt.value === statusFilter
        );
        const prevIndex =
          currentIndex <= 0
            ? STATUS_FILTER_OPTIONS.length - 1
            : currentIndex - 1;
        onStatusFilterChange(STATUS_FILTER_OPTIONS[prevIndex].value);
        return;
      }

      if (key.rightArrow) {
        const currentIndex = STATUS_FILTER_OPTIONS.findIndex(
          (opt) => opt.value === statusFilter
        );
        const nextIndex = (currentIndex + 1) % STATUS_FILTER_OPTIONS.length;
        onStatusFilterChange(STATUS_FILTER_OPTIONS[nextIndex].value);
        return;
      }

      if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.return) {
        return;
      }

      if (input && input.length > 0) {
        onSearchChange(searchQuery + input);
      }
    },
    { isActive: isFocused }
  );

  const innerWidth = Math.max(width - 2, 40);

  // Get current filter label
  const currentFilterLabel =
    STATUS_FILTER_OPTIONS.find((opt) => opt.value === statusFilter)?.label ||
    'All';

  // Calculate widths
  const searchLabelWidth = 10; // "  Search: "
  const filterSectionWidth = 20; // "  Filter: All     "
  const hintWidth = isFocused ? 16 : 18; // "(Tab/Arrows)" or "Press / to search"
  const searchInputWidth = Math.max(20, innerWidth - searchLabelWidth - filterSectionWidth - hintWidth - 4);

  // Display query with truncation
  const displayQuery =
    searchQuery.length > searchInputWidth - 1
      ? searchQuery.slice(-(searchInputWidth - 1))
      : searchQuery;
  const inputPadding = Math.max(0, searchInputWidth - displayQuery.length - (isFocused ? 1 : 0));

  const borderColor = isFocused ? colors.primary : colors.borderDim;

  return (
    <Box flexDirection="column" marginBottom={0}>
      {/* Top border */}
      <Text color={borderColor}>
        {borders.rounded.topLeft}
        {borders.horizontal.repeat(innerWidth)}
        {borders.rounded.topRight}
      </Text>

      {/* Content row */}
      <Box>
        <Text color={borderColor}>{borders.vertical}</Text>

        {/* Search section */}
        <Box>
          <Text color={colors.muted}> </Text>
          <Text color={isFocused ? colors.primary : colors.muted}>Search:</Text>
          <Text> </Text>
          <Text color={searchQuery ? colors.text : colors.muted}>
            {searchQuery || (isFocused ? '' : 'type to filter')}
          </Text>
          {isFocused && <Text color={colors.primary}>{CURSOR_CHAR}</Text>}
          <Text>{' '.repeat(inputPadding)}</Text>
        </Box>

        {/* Separator */}
        <Text color={colors.borderDim}> {borders.vertical} </Text>

        {/* Filter section */}
        <Box>
          <Text color={colors.muted}>Filter:</Text>
          <Text> </Text>
          <Text color={colors.primary} bold>{currentFilterLabel}</Text>
          <Text>{' '.repeat(Math.max(0, 12 - currentFilterLabel.length))}</Text>
        </Box>

        {/* Separator */}
        <Text color={colors.borderDim}> {borders.vertical} </Text>

        {/* Hint section */}
        <Box flexGrow={1} justifyContent="flex-end">
          {isFocused ? (
            <Text color={colors.muted} dimColor>Tab/←→: Filter  Esc: Close</Text>
          ) : (
            <Text color={colors.muted} dimColor>Press / to search</Text>
          )}
          <Text> </Text>
        </Box>

        <Text color={borderColor}>{borders.vertical}</Text>
      </Box>

      {/* Bottom border */}
      <Text color={borderColor}>
        {borders.rounded.bottomLeft}
        {borders.horizontal.repeat(innerWidth)}
        {borders.rounded.bottomRight}
      </Text>
    </Box>
  );
};

export default SearchBar;
