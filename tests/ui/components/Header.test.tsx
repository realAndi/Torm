import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Header, formatSpeed } from '../../../src/ui/components/Header.js';

describe('Header', () => {
  describe('formatSpeed', () => {
    it('should format zero bytes per second', () => {
      expect(formatSpeed(0)).toBe('0 B/s');
    });

    it('should format bytes per second', () => {
      expect(formatSpeed(500)).toBe('500 B/s');
      expect(formatSpeed(1023)).toBe('1023 B/s');
    });

    it('should format kilobytes per second', () => {
      expect(formatSpeed(1024)).toBe('1 KB/s');
      expect(formatSpeed(2048)).toBe('2 KB/s');
      expect(formatSpeed(256 * 1024)).toBe('256 KB/s');
    });

    it('should format megabytes per second', () => {
      expect(formatSpeed(1024 * 1024)).toBe('1 MB/s');
      expect(formatSpeed(1.5 * 1024 * 1024)).toBe('1.5 MB/s');
      expect(formatSpeed(100 * 1024 * 1024)).toBe('100 MB/s');
    });

    it('should format gigabytes per second', () => {
      expect(formatSpeed(1024 * 1024 * 1024)).toBe('1 GB/s');
      expect(formatSpeed(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB/s');
    });

    it('should handle large speeds (GB/s)', () => {
      const tenGB = 10 * 1024 * 1024 * 1024;
      expect(formatSpeed(tenGB)).toBe('10 GB/s');
    });

    it('should remove trailing .0 for whole numbers', () => {
      expect(formatSpeed(1024 * 1024)).toBe('1 MB/s');
      expect(formatSpeed(2 * 1024 * 1024)).toBe('2 MB/s');
    });

    it('should show decimals for non-whole numbers', () => {
      expect(formatSpeed(1.5 * 1024 * 1024)).toBe('1.5 MB/s');
      expect(formatSpeed(1.2 * 1024)).toBe('1.2 KB/s');
    });
  });

  describe('component rendering', () => {
    it('should render the app name "Torm"', () => {
      const { lastFrame } = render(
        <Header totalDownloadSpeed={0} totalUploadSpeed={0} />
      );
      expect(lastFrame()).toContain('Torm');
    });

    it('should display download speed correctly formatted', () => {
      const { lastFrame } = render(
        <Header totalDownloadSpeed={1024 * 1024} totalUploadSpeed={0} />
      );
      const frame = lastFrame();
      expect(frame).toContain('1 MB/s');
    });

    it('should display upload speed correctly formatted', () => {
      const { lastFrame } = render(
        <Header totalDownloadSpeed={0} totalUploadSpeed={512 * 1024} />
      );
      const frame = lastFrame();
      expect(frame).toContain('512 KB/s');
    });

    it('should handle zero speeds', () => {
      const { lastFrame } = render(
        <Header totalDownloadSpeed={0} totalUploadSpeed={0} />
      );
      const frame = lastFrame();
      expect(frame).toContain('0 B/s');
    });

    it('should handle large speeds (GB/s)', () => {
      const oneGB = 1024 * 1024 * 1024;
      const { lastFrame } = render(
        <Header totalDownloadSpeed={oneGB} totalUploadSpeed={2 * oneGB} />
      );
      const frame = lastFrame();
      expect(frame).toContain('1 GB/s');
      expect(frame).toContain('2 GB/s');
    });

    it('should display both download and upload arrows', () => {
      const { lastFrame } = render(
        <Header totalDownloadSpeed={1024} totalUploadSpeed={2048} />
      );
      const frame = lastFrame();
      // Check for arrow symbols
      expect(frame).toMatch(/[↓]/);
      expect(frame).toMatch(/[↑]/);
    });
  });
});
