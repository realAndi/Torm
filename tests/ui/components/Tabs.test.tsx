import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import {
  Tabs,
  getAdjacentTab,
  getTabByNumber,
  type Tab,
} from '../../../src/ui/components/Tabs.js';

describe('Tabs', () => {
  const sampleTabs: Tab[] = [
    { id: 'files', label: 'Files' },
    { id: 'peers', label: 'Peers' },
    { id: 'trackers', label: 'Trackers' },
    { id: 'log', label: 'Log' },
  ];

  describe('component rendering', () => {
    it('should render all tabs', () => {
      const { lastFrame } = render(
        <Tabs tabs={sampleTabs} activeTab="files" onChange={() => {}} />
      );
      const frame = lastFrame();

      expect(frame).toContain('Files');
      expect(frame).toContain('Peers');
      expect(frame).toContain('Trackers');
      expect(frame).toContain('Log');
    });

    it('should show tab numbers', () => {
      const { lastFrame } = render(
        <Tabs tabs={sampleTabs} activeTab="files" onChange={() => {}} />
      );
      const frame = lastFrame();

      expect(frame).toContain('1:Files');
      expect(frame).toContain('2:Peers');
      expect(frame).toContain('3:Trackers');
      expect(frame).toContain('4:Log');
    });

    it('should highlight active tab with brackets', () => {
      const { lastFrame } = render(
        <Tabs tabs={sampleTabs} activeTab="files" onChange={() => {}} />
      );
      const frame = lastFrame();

      // Active tab should be wrapped in brackets
      expect(frame).toContain('[1:Files]');
    });

    it('should highlight correct tab when different tab is active', () => {
      const { lastFrame } = render(
        <Tabs tabs={sampleTabs} activeTab="peers" onChange={() => {}} />
      );
      const frame = lastFrame();

      // Active tab should be wrapped in brackets
      expect(frame).toContain('[2:Peers]');
      // Other tabs should not have brackets
      expect(frame).not.toContain('[1:Files]');
    });

    it('should render empty when no tabs provided', () => {
      const { lastFrame } = render(
        <Tabs tabs={[]} activeTab="" onChange={() => {}} />
      );
      // Should render but be minimal (just the Box wrapper)
      expect(lastFrame()).toBeDefined();
    });

    it('should render single tab correctly', () => {
      const singleTab: Tab[] = [{ id: 'only', label: 'Only Tab' }];
      const { lastFrame } = render(
        <Tabs tabs={singleTab} activeTab="only" onChange={() => {}} />
      );
      const frame = lastFrame();

      expect(frame).toContain('[1:Only Tab]');
    });
  });

  describe('getAdjacentTab', () => {
    it('should return next tab when direction is 1', () => {
      expect(getAdjacentTab(sampleTabs, 'files', 1)).toBe('peers');
      expect(getAdjacentTab(sampleTabs, 'peers', 1)).toBe('trackers');
      expect(getAdjacentTab(sampleTabs, 'trackers', 1)).toBe('log');
    });

    it('should return previous tab when direction is -1', () => {
      expect(getAdjacentTab(sampleTabs, 'peers', -1)).toBe('files');
      expect(getAdjacentTab(sampleTabs, 'trackers', -1)).toBe('peers');
      expect(getAdjacentTab(sampleTabs, 'log', -1)).toBe('trackers');
    });

    it('should wrap from last to first tab', () => {
      expect(getAdjacentTab(sampleTabs, 'log', 1)).toBe('files');
    });

    it('should wrap from first to last tab', () => {
      expect(getAdjacentTab(sampleTabs, 'files', -1)).toBe('log');
    });

    it('should return first tab when current tab is not found', () => {
      expect(getAdjacentTab(sampleTabs, 'nonexistent', 1)).toBe('files');
      expect(getAdjacentTab(sampleTabs, 'nonexistent', -1)).toBe('files');
    });

    it('should return empty string for empty tabs array', () => {
      expect(getAdjacentTab([], 'any', 1)).toBe('');
      expect(getAdjacentTab([], 'any', -1)).toBe('');
    });

    it('should handle single tab correctly', () => {
      const singleTab: Tab[] = [{ id: 'only', label: 'Only' }];
      // Both directions should return the same tab (wrap around to itself)
      expect(getAdjacentTab(singleTab, 'only', 1)).toBe('only');
      expect(getAdjacentTab(singleTab, 'only', -1)).toBe('only');
    });
  });

  describe('getTabByNumber', () => {
    it('should return correct tab for valid numbers', () => {
      expect(getTabByNumber(sampleTabs, 1)).toBe('files');
      expect(getTabByNumber(sampleTabs, 2)).toBe('peers');
      expect(getTabByNumber(sampleTabs, 3)).toBe('trackers');
      expect(getTabByNumber(sampleTabs, 4)).toBe('log');
    });

    it('should return undefined for number 0', () => {
      expect(getTabByNumber(sampleTabs, 0)).toBeUndefined();
    });

    it('should return undefined for negative numbers', () => {
      expect(getTabByNumber(sampleTabs, -1)).toBeUndefined();
      expect(getTabByNumber(sampleTabs, -5)).toBeUndefined();
    });

    it('should return undefined for out of range numbers', () => {
      expect(getTabByNumber(sampleTabs, 5)).toBeUndefined();
      expect(getTabByNumber(sampleTabs, 100)).toBeUndefined();
    });

    it('should return undefined for empty tabs array', () => {
      expect(getTabByNumber([], 1)).toBeUndefined();
    });

    it('should handle single tab', () => {
      const singleTab: Tab[] = [{ id: 'only', label: 'Only' }];
      expect(getTabByNumber(singleTab, 1)).toBe('only');
      expect(getTabByNumber(singleTab, 2)).toBeUndefined();
    });
  });
});
