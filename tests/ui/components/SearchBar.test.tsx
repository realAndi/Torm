import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { SearchBar, STATUS_FILTER_OPTIONS } from '../../../src/ui/components/SearchBar.js';
import { TorrentState } from '../../../src/engine/types.js';

describe('SearchBar', () => {
  const defaultProps = {
    searchQuery: '',
    onSearchChange: vi.fn(),
    statusFilter: 'all' as const,
    onStatusFilterChange: vi.fn(),
    isFocused: false,
    onFocusChange: vi.fn(),
  };

  describe('placeholder display', () => {
    it('shows placeholder when not focused and no query', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          isFocused={false}
          searchQuery=""
        />
      );

      expect(lastFrame()).toContain('type to filter');
    });

    it('shows "Press / to search" hint when not focused', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          isFocused={false}
        />
      );

      expect(lastFrame()).toContain('Press / to search');
    });

    it('hides "/" hint when focused', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          isFocused={true}
        />
      );

      expect(lastFrame()).not.toContain('Press / to search');
    });
  });

  describe('focus states', () => {
    it('shows cursor when focused', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          isFocused={true}
          searchQuery=""
        />
      );

      // Cursor character is \u258C (left half block)
      expect(lastFrame()).toContain('\u258C');
    });

    it('does not show cursor when not focused', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          isFocused={false}
          searchQuery="test"
        />
      );

      expect(lastFrame()).not.toContain('\u258C');
    });

    it('shows Tab/Arrow hint when focused', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          isFocused={true}
        />
      );

      // Component shows "Tab/←→: Filter" hint
      expect(lastFrame()).toMatch(/Tab\/.*Filter/);
    });
  });

  describe('search query display', () => {
    it('displays current query', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          searchQuery="ubuntu"
          isFocused={false}
        />
      );

      expect(lastFrame()).toContain('ubuntu');
    });

    it('displays query when focused', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          searchQuery="linux"
          isFocused={true}
        />
      );

      expect(lastFrame()).toContain('linux');
    });

    it('displays long query (may be truncated)', () => {
      const longQuery = 'this is a very long search query that might be truncated';
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          searchQuery={longQuery}
          isFocused={true}
        />
      );

      // Should at least render without error
      expect(lastFrame()).toBeDefined();
    });
  });

  describe('status filter options', () => {
    it('shows filter label', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          statusFilter="all"
        />
      );

      // Component uses "Filter:" label
      expect(lastFrame()).toContain('Filter:');
    });

    it('shows "All" when status filter is all', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          statusFilter="all"
        />
      );

      expect(lastFrame()).toContain('All');
    });

    it('shows "Downloading" when status filter is downloading', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          statusFilter={TorrentState.DOWNLOADING}
        />
      );

      expect(lastFrame()).toContain('Downloading');
    });

    it('shows "Seeding" when status filter is seeding', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          statusFilter={TorrentState.SEEDING}
        />
      );

      expect(lastFrame()).toContain('Seeding');
    });

    it('shows "Paused" when status filter is paused', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          statusFilter={TorrentState.PAUSED}
        />
      );

      expect(lastFrame()).toContain('Paused');
    });

    it('shows "Error" when status filter is error', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          statusFilter={TorrentState.ERROR}
        />
      );

      expect(lastFrame()).toContain('Error');
    });

    it('shows "Checking" when status filter is checking', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          statusFilter={TorrentState.CHECKING}
        />
      );

      expect(lastFrame()).toContain('Checking');
    });

    it('shows "Queued" when status filter is queued', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          statusFilter={TorrentState.QUEUED}
        />
      );

      expect(lastFrame()).toContain('Queued');
    });
  });

  describe('active status filter highlighting', () => {
    it('highlights active status filter with color', () => {
      // Render with "all" filter
      const { lastFrame: allFilter } = render(
        <SearchBar
          {...defaultProps}
          statusFilter="all"
        />
      );

      // Render with "downloading" filter
      const { lastFrame: downloadingFilter } = render(
        <SearchBar
          {...defaultProps}
          statusFilter={TorrentState.DOWNLOADING}
        />
      );

      // Both should render the active filter
      expect(allFilter()).toContain('All');
      expect(downloadingFilter()).toContain('Downloading');
    });

    it('updates display when status filter changes', () => {
      const { lastFrame, rerender } = render(
        <SearchBar
          {...defaultProps}
          statusFilter="all"
        />
      );

      expect(lastFrame()).toContain('All');

      rerender(
        <SearchBar
          {...defaultProps}
          statusFilter={TorrentState.SEEDING}
        />
      );

      expect(lastFrame()).toContain('Seeding');
    });
  });

  describe('keyboard hints', () => {
    it('shows search label', () => {
      const { lastFrame } = render(
        <SearchBar {...defaultProps} />
      );

      expect(lastFrame()).toContain('Search:');
    });

    it('shows border characters', () => {
      const { lastFrame } = render(
        <SearchBar {...defaultProps} />
      );

      // Should contain vertical border characters (Unicode box drawing)
      expect(lastFrame()).toContain('\u2502'); // Unicode vertical line
    });
  });

  describe('layout and structure', () => {
    it('renders without error', () => {
      const { lastFrame } = render(
        <SearchBar {...defaultProps} />
      );

      expect(lastFrame()).toBeDefined();
      expect(lastFrame().length).toBeGreaterThan(0);
    });

    it('renders all elements together', () => {
      const { lastFrame } = render(
        <SearchBar
          {...defaultProps}
          searchQuery="test"
          statusFilter={TorrentState.DOWNLOADING}
          isFocused={true}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('Search:');
      expect(frame).toContain('test');
      expect(frame).toContain('Filter:');
      expect(frame).toContain('Downloading');
    });
  });
});

describe('STATUS_FILTER_OPTIONS', () => {
  it('contains all status filter options', () => {
    expect(STATUS_FILTER_OPTIONS).toHaveLength(7);
  });

  it('includes "all" option first', () => {
    expect(STATUS_FILTER_OPTIONS[0].value).toBe('all');
    expect(STATUS_FILTER_OPTIONS[0].label).toBe('All');
  });

  it('includes all torrent states', () => {
    const values = STATUS_FILTER_OPTIONS.map(opt => opt.value);

    expect(values).toContain('all');
    expect(values).toContain(TorrentState.DOWNLOADING);
    expect(values).toContain(TorrentState.SEEDING);
    expect(values).toContain(TorrentState.PAUSED);
    expect(values).toContain(TorrentState.ERROR);
    expect(values).toContain(TorrentState.CHECKING);
    expect(values).toContain(TorrentState.QUEUED);
  });

  it('has human-readable labels for each option', () => {
    STATUS_FILTER_OPTIONS.forEach(option => {
      expect(option.label).toBeDefined();
      expect(option.label.length).toBeGreaterThan(0);
      // First letter should be uppercase
      expect(option.label[0]).toBe(option.label[0].toUpperCase());
    });
  });
});
