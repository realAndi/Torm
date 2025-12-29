import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Header } from '../../../src/ui/components/Header.js';

describe('Header', () => {
  describe('component rendering', () => {
    it('should render the ASCII logo', () => {
      const { lastFrame } = render(<Header />);
      const frame = lastFrame();
      // Check for parts of the TORM ASCII art
      expect(frame).toContain('████████');
      expect(frame).toContain('██████╗');
    });

    it('should render with default props', () => {
      const { lastFrame } = render(<Header />);
      expect(lastFrame()).toBeDefined();
    });

    it('should render with mascot expression', () => {
      const { lastFrame } = render(<Header mascotExpression="happy" />);
      expect(lastFrame()).toBeDefined();
    });

    it('should render with sleeping mascot', () => {
      const { lastFrame } = render(
        <Header mascotSleeping={true} mascotSleepZCount={2} />
      );
      expect(lastFrame()).toBeDefined();
    });

    it('should render with downloading state', () => {
      const { lastFrame } = render(<Header isDownloading={true} />);
      expect(lastFrame()).toBeDefined();
    });
  });
});
