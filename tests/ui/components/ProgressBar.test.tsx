import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ProgressBar } from '../../../src/ui/components/ProgressBar.js';

describe('ProgressBar', () => {
  const FILLED_CHAR = '\u2588'; // Full block character
  const EMPTY_CHAR = '\u2591'; // Light shade character

  describe('progress rendering', () => {
    it('should render 0% progress', () => {
      const { lastFrame } = render(<ProgressBar progress={0} width={10} />);
      const frame = lastFrame();
      // Should have 0 filled and 10 empty blocks
      expect(frame).toContain('0%');
      // All should be empty
      const filledCount = (frame?.match(new RegExp(FILLED_CHAR, 'g')) || []).length;
      expect(filledCount).toBe(0);
    });

    it('should render 50% progress', () => {
      const { lastFrame } = render(<ProgressBar progress={0.5} width={10} />);
      const frame = lastFrame();
      expect(frame).toContain('50%');
      // Should have 5 filled and 5 empty blocks
      const filledCount = (frame?.match(new RegExp(FILLED_CHAR, 'g')) || []).length;
      const emptyCount = (frame?.match(new RegExp(EMPTY_CHAR, 'g')) || []).length;
      expect(filledCount).toBe(5);
      expect(emptyCount).toBe(5);
    });

    it('should render 100% progress', () => {
      const { lastFrame } = render(<ProgressBar progress={1} width={10} />);
      const frame = lastFrame();
      expect(frame).toContain('100%');
      // All should be filled
      const filledCount = (frame?.match(new RegExp(FILLED_CHAR, 'g')) || []).length;
      expect(filledCount).toBe(10);
    });
  });

  describe('percentage text', () => {
    it('should show percentage text by default', () => {
      const { lastFrame } = render(<ProgressBar progress={0.42} width={10} />);
      expect(lastFrame()).toContain('42%');
    });

    it('should show percentage text when showPercentage is true', () => {
      const { lastFrame } = render(
        <ProgressBar progress={0.75} width={10} showPercentage={true} />
      );
      expect(lastFrame()).toContain('75%');
    });

    it('should hide percentage text when showPercentage is false', () => {
      const { lastFrame } = render(
        <ProgressBar progress={0.5} width={10} showPercentage={false} />
      );
      expect(lastFrame()).not.toContain('%');
    });

    it('should pad percentage text to 3 characters', () => {
      const { lastFrame } = render(<ProgressBar progress={0.05} width={10} />);
      expect(lastFrame()).toContain('5%');
    });
  });

  describe('width prop', () => {
    it('should use default width of 10 when not specified', () => {
      const { lastFrame } = render(<ProgressBar progress={1} />);
      const frame = lastFrame();
      const filledCount = (frame?.match(new RegExp(FILLED_CHAR, 'g')) || []).length;
      expect(filledCount).toBe(10);
    });

    it('should respect custom width of 5', () => {
      const { lastFrame } = render(<ProgressBar progress={1} width={5} />);
      const frame = lastFrame();
      const filledCount = (frame?.match(new RegExp(FILLED_CHAR, 'g')) || []).length;
      expect(filledCount).toBe(5);
    });

    it('should respect custom width of 20', () => {
      const { lastFrame } = render(<ProgressBar progress={1} width={20} />);
      const frame = lastFrame();
      const filledCount = (frame?.match(new RegExp(FILLED_CHAR, 'g')) || []).length;
      expect(filledCount).toBe(20);
    });

    it('should calculate correct filled blocks for custom width', () => {
      // 50% of 20 = 10 filled blocks
      const { lastFrame } = render(<ProgressBar progress={0.5} width={20} />);
      const frame = lastFrame();
      const filledCount = (frame?.match(new RegExp(FILLED_CHAR, 'g')) || []).length;
      const emptyCount = (frame?.match(new RegExp(EMPTY_CHAR, 'g')) || []).length;
      expect(filledCount).toBe(10);
      expect(emptyCount).toBe(10);
    });
  });

  describe('edge cases', () => {
    it('should clamp progress below 0', () => {
      const { lastFrame } = render(<ProgressBar progress={-0.5} width={10} />);
      expect(lastFrame()).toContain('0%');
    });

    it('should clamp progress above 1', () => {
      const { lastFrame } = render(<ProgressBar progress={1.5} width={10} />);
      expect(lastFrame()).toContain('100%');
    });

    it('should round progress for display', () => {
      const { lastFrame } = render(<ProgressBar progress={0.334} width={10} />);
      expect(lastFrame()).toContain('33%');
    });
  });
});
