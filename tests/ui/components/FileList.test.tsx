import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { FileList } from '../../../src/ui/components/FileList.js';
import type { TorrentFile } from '../../../src/engine/types.js';
import { FilePriority } from '../../../src/engine/types.js';

/**
 * Helper to create a mock file with default values
 */
function createMockFile(overrides: Partial<TorrentFile> = {}): TorrentFile {
  return {
    path: 'example.txt',
    size: 1024,
    downloaded: 0,
    priority: FilePriority.Normal,
    index: 0,
    ...overrides,
  };
}

describe('FileList', () => {
  describe('empty state', () => {
    it('renders empty state', () => {
      const { lastFrame } = render(<FileList files={[]} />);
      expect(lastFrame()).toContain('No files');
    });

    it('does not render header when no files', () => {
      const { lastFrame } = render(<FileList files={[]} />);
      expect(lastFrame()).not.toContain('File');
      expect(lastFrame()).not.toContain('Size');
    });
  });

  describe('single file', () => {
    it('renders single file', () => {
      const files: TorrentFile[] = [
        createMockFile({ path: 'ubuntu-24.04.iso' }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('ubuntu-24.04.iso');
    });

    it('renders header row with column labels for single file', () => {
      const files: TorrentFile[] = [createMockFile()];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('Pri');
      expect(lastFrame()).toContain('File');
      expect(lastFrame()).toContain('Size');
      expect(lastFrame()).toContain('Progress');
    });
  });

  describe('multiple files with tree structure', () => {
    it('renders multiple files', () => {
      const files: TorrentFile[] = [
        createMockFile({ path: 'file1.txt', index: 0 }),
        createMockFile({ path: 'file2.txt', index: 1 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('file1.txt');
      expect(lastFrame()).toContain('file2.txt');
    });

    it('renders files with directory structure', () => {
      const files: TorrentFile[] = [
        createMockFile({ path: 'Album/01 - Track One.mp3', index: 0 }),
        createMockFile({ path: 'Album/02 - Track Two.mp3', index: 1 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      // Should show directory name
      expect(lastFrame()).toContain('Album');
      // Should show file names
      expect(lastFrame()).toContain('Track One');
      expect(lastFrame()).toContain('Track Two');
    });

    it('renders nested directory structure', () => {
      // Need multiple files for tree structure to be rendered
      const files: TorrentFile[] = [
        createMockFile({ path: 'Root/SubDir/file1.txt', index: 0 }),
        createMockFile({ path: 'Root/SubDir/file2.txt', index: 1 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('Root');
      expect(lastFrame()).toContain('SubDir');
      expect(lastFrame()).toContain('file1.txt');
      expect(lastFrame()).toContain('file2.txt');
    });

    it('renders tree connectors for multi-file torrents', () => {
      const files: TorrentFile[] = [
        createMockFile({ path: 'dir/file1.txt', index: 0 }),
        createMockFile({ path: 'dir/file2.txt', index: 1 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      // Should contain tree-drawing characters
      const frame = lastFrame();
      // Tree connectors: unicode box-drawing
      expect(frame).toMatch(/[\u2514\u251c\u2500]/);
    });
  });

  describe('file sizes', () => {
    it('shows file size in bytes', () => {
      const files: TorrentFile[] = [
        createMockFile({ size: 500 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('500 B');
    });

    it('shows file size in KB', () => {
      const files: TorrentFile[] = [
        createMockFile({ size: 256 * 1024 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('256');
      expect(lastFrame()).toContain('KB');
    });

    it('shows file size in MB', () => {
      const files: TorrentFile[] = [
        createMockFile({ size: 8.2 * 1024 * 1024 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('8.2');
      expect(lastFrame()).toContain('MB');
    });

    it('shows file size in GB', () => {
      const files: TorrentFile[] = [
        createMockFile({ size: 4.7 * 1024 * 1024 * 1024 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('4.7');
      expect(lastFrame()).toContain('GB');
    });
  });

  describe('per-file progress', () => {
    it('shows 0% progress', () => {
      const files: TorrentFile[] = [
        createMockFile({ size: 1000, downloaded: 0 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('0%');
    });

    it('shows 100% progress', () => {
      const files: TorrentFile[] = [
        createMockFile({ size: 1000, downloaded: 1000 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('100%');
    });

    it('shows partial progress', () => {
      const files: TorrentFile[] = [
        createMockFile({ size: 1000, downloaded: 670 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('67%');
    });

    it('shows mini progress bar', () => {
      const files: TorrentFile[] = [
        createMockFile({ size: 1000, downloaded: 500 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      // Should contain progress bar characters (filled and empty)
      const frame = lastFrame();
      expect(frame).toMatch(/[\u2588\u2591]/);
    });

    it('handles zero-size files', () => {
      const files: TorrentFile[] = [
        createMockFile({ size: 0, downloaded: 0 }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      // Should handle gracefully without division by zero
      expect(lastFrame()).toContain('0%');
    });
  });

  describe('priority indicators', () => {
    it('shows skip priority indicator', () => {
      const files: TorrentFile[] = [
        createMockFile({ priority: FilePriority.Skip }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      // Skip uses cross symbol
      expect(lastFrame()).toContain('\u2717');
    });

    it('shows low priority indicator', () => {
      const files: TorrentFile[] = [
        createMockFile({ priority: FilePriority.Low }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      // Low priority uses down arrow
      expect(lastFrame()).toContain('\u2193');
    });

    it('shows normal priority indicator', () => {
      const files: TorrentFile[] = [
        createMockFile({ priority: FilePriority.Normal }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      // Normal priority uses bullet
      expect(lastFrame()).toContain('\u2022');
    });

    it('shows high priority indicator', () => {
      const files: TorrentFile[] = [
        createMockFile({ priority: FilePriority.High }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      // High priority uses up arrow
      expect(lastFrame()).toContain('\u2191');
    });

    it('shows different priorities for different files', () => {
      const files: TorrentFile[] = [
        createMockFile({ path: 'high.txt', index: 0, priority: FilePriority.High }),
        createMockFile({ path: 'normal.txt', index: 1, priority: FilePriority.Normal }),
        createMockFile({ path: 'skip.txt', index: 2, priority: FilePriority.Skip }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      const frame = lastFrame();
      // Should contain all priority indicators
      expect(frame).toContain('\u2191'); // High
      expect(frame).toContain('\u2022'); // Normal
      expect(frame).toContain('\u2717'); // Skip
    });
  });

  describe('file name truncation', () => {
    it('truncates long file names', () => {
      const files: TorrentFile[] = [
        createMockFile({
          path: 'This_is_a_very_long_filename_that_should_definitely_be_truncated.txt'
        }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      // Should contain ellipsis character
      expect(lastFrame()).toContain('\u2026');
    });

    it('does not truncate short file names', () => {
      const files: TorrentFile[] = [
        createMockFile({ path: 'short.txt' }),
      ];
      const { lastFrame } = render(<FileList files={files} />);
      expect(lastFrame()).toContain('short.txt');
      // Should not contain ellipsis in the filename part
    });
  });
});
