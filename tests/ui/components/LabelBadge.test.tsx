import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { LabelBadge, LabelList } from '../../../src/ui/components/LabelBadge.js';

describe('LabelBadge', () => {
  describe('single label rendering', () => {
    it('renders single label with brackets', () => {
      const { lastFrame } = render(
        <LabelBadge label="movies" />
      );

      expect(lastFrame()).toContain('[movies]');
    });

    it('renders label with correct format', () => {
      const { lastFrame } = render(
        <LabelBadge label="music" />
      );

      expect(lastFrame()).toBe('[music]');
    });

    it('renders custom labels', () => {
      const { lastFrame } = render(
        <LabelBadge label="my-custom-label" />
      );

      expect(lastFrame()).toContain('[my-custom-label]');
    });

    it('renders empty label (edge case)', () => {
      const { lastFrame } = render(
        <LabelBadge label="" />
      );

      expect(lastFrame()).toBe('[]');
    });
  });

  describe('label colors', () => {
    it('renders movies label (should have blue color)', () => {
      const { lastFrame } = render(
        <LabelBadge label="movies" />
      );

      // Just verify it renders - color is applied via Ink
      expect(lastFrame()).toContain('[movies]');
    });

    it('renders music label (should have green color)', () => {
      const { lastFrame } = render(
        <LabelBadge label="music" />
      );

      expect(lastFrame()).toContain('[music]');
    });

    it('renders games label (should have magenta color)', () => {
      const { lastFrame } = render(
        <LabelBadge label="games" />
      );

      expect(lastFrame()).toContain('[games]');
    });

    it('renders tv label (should have cyan color)', () => {
      const { lastFrame } = render(
        <LabelBadge label="tv" />
      );

      expect(lastFrame()).toContain('[tv]');
    });

    it('renders custom label with default color', () => {
      const { lastFrame } = render(
        <LabelBadge label="unknown-category" />
      );

      expect(lastFrame()).toContain('[unknown-category]');
    });
  });

  describe('selected state', () => {
    it('renders normally when not selected', () => {
      const { lastFrame } = render(
        <LabelBadge label="movies" isSelected={false} />
      );

      expect(lastFrame()).toContain('[movies]');
    });

    it('renders with inverse when selected', () => {
      const { lastFrame } = render(
        <LabelBadge label="movies" isSelected={true} />
      );

      // Just verify it renders - inverse is applied via Ink
      expect(lastFrame()).toContain('[movies]');
    });

    it('defaults to not selected', () => {
      const { lastFrame: withoutProp } = render(
        <LabelBadge label="test" />
      );
      const { lastFrame: withFalse } = render(
        <LabelBadge label="test" isSelected={false} />
      );

      expect(withoutProp()).toBe(withFalse());
    });
  });
});

describe('LabelList', () => {
  describe('multiple labels rendering', () => {
    it('renders multiple labels', () => {
      const { lastFrame } = render(
        <LabelList labels={['movies', 'hd', '2024']} />
      );

      const frame = lastFrame();
      expect(frame).toContain('[movies]');
      expect(frame).toContain('[hd]');
      expect(frame).toContain('[2024]');
    });

    it('renders single label', () => {
      const { lastFrame } = render(
        <LabelList labels={['music']} />
      );

      expect(lastFrame()).toContain('[music]');
    });

    it('returns null for empty labels array', () => {
      const { lastFrame } = render(
        <LabelList labels={[]} />
      );

      expect(lastFrame()).toBe('');
    });

    it('renders labels with space separation', () => {
      const { lastFrame } = render(
        <LabelList labels={['a', 'b']} />
      );

      // Labels should be separated, containing both
      const frame = lastFrame();
      expect(frame).toContain('[a]');
      expect(frame).toContain('[b]');
    });
  });

  describe('maxLabels prop', () => {
    it('respects maxLabels prop with default value', () => {
      // Default maxLabels is 3
      const { lastFrame } = render(
        <LabelList labels={['a', 'b', 'c', 'd', 'e']} />
      );

      const frame = lastFrame();
      expect(frame).toContain('[a]');
      expect(frame).toContain('[b]');
      expect(frame).toContain('[c]');
      expect(frame).not.toContain('[d]');
      expect(frame).not.toContain('[e]');
    });

    it('respects maxLabels=2', () => {
      const { lastFrame } = render(
        <LabelList labels={['movies', 'hd', '2024', 'favorite']} maxLabels={2} />
      );

      const frame = lastFrame();
      expect(frame).toContain('[movies]');
      expect(frame).toContain('[hd]');
      expect(frame).not.toContain('[2024]');
      expect(frame).not.toContain('[favorite]');
    });

    it('respects maxLabels=1', () => {
      const { lastFrame } = render(
        <LabelList labels={['first', 'second', 'third']} maxLabels={1} />
      );

      const frame = lastFrame();
      expect(frame).toContain('[first]');
      expect(frame).not.toContain('[second]');
      expect(frame).not.toContain('[third]');
    });

    it('shows all labels when maxLabels >= labels.length', () => {
      const { lastFrame } = render(
        <LabelList labels={['a', 'b']} maxLabels={5} />
      );

      const frame = lastFrame();
      expect(frame).toContain('[a]');
      expect(frame).toContain('[b]');
      expect(frame).not.toContain('+');
    });
  });

  describe('overflow indicator', () => {
    it('shows "+N" for overflow labels', () => {
      const { lastFrame } = render(
        <LabelList labels={['a', 'b', 'c', 'd', 'e']} maxLabels={2} />
      );

      expect(lastFrame()).toContain('+3');
    });

    it('shows correct count for single overflow', () => {
      const { lastFrame } = render(
        <LabelList labels={['a', 'b', 'c', 'd']} maxLabels={3} />
      );

      expect(lastFrame()).toContain('+1');
    });

    it('shows correct count for multiple overflow', () => {
      const { lastFrame } = render(
        <LabelList labels={['1', '2', '3', '4', '5', '6', '7']} maxLabels={2} />
      );

      expect(lastFrame()).toContain('+5');
    });

    it('does not show overflow indicator when no overflow', () => {
      const { lastFrame } = render(
        <LabelList labels={['a', 'b']} maxLabels={3} />
      );

      expect(lastFrame()).not.toContain('+');
    });

    it('shows overflow indicator with correct formatting', () => {
      const { lastFrame } = render(
        <LabelList labels={['movies', 'hd', '2024', 'favorite']} maxLabels={2} />
      );

      const frame = lastFrame();
      // Should contain +2 (since 4 total - 2 shown = 2 remaining)
      expect(frame).toContain('+2');
    });
  });

  describe('selected state', () => {
    it('passes isSelected to child badges when true', () => {
      const { lastFrame } = render(
        <LabelList labels={['movies', 'music']} isSelected={true} />
      );

      // Just verify it renders - inverse styling is applied via Ink
      expect(lastFrame()).toContain('[movies]');
      expect(lastFrame()).toContain('[music]');
    });

    it('passes isSelected to child badges when false', () => {
      const { lastFrame } = render(
        <LabelList labels={['movies', 'music']} isSelected={false} />
      );

      expect(lastFrame()).toContain('[movies]');
      expect(lastFrame()).toContain('[music]');
    });

    it('defaults to not selected', () => {
      const { lastFrame: withoutProp } = render(
        <LabelList labels={['test']} />
      );
      const { lastFrame: withFalse } = render(
        <LabelList labels={['test']} isSelected={false} />
      );

      expect(withoutProp()).toBe(withFalse());
    });

    it('applies isSelected to overflow indicator', () => {
      const { lastFrame } = render(
        <LabelList labels={['a', 'b', 'c', 'd']} maxLabels={2} isSelected={true} />
      );

      // Just verify it renders with the overflow indicator
      expect(lastFrame()).toContain('+2');
    });
  });

  describe('edge cases', () => {
    it('handles labels with special characters', () => {
      const { lastFrame } = render(
        <LabelList labels={['my-label', 'another_label', 'label.v2']} />
      );

      const frame = lastFrame();
      expect(frame).toContain('[my-label]');
      expect(frame).toContain('[another_label]');
      expect(frame).toContain('[label.v2]');
    });

    it('handles labels with numbers', () => {
      const { lastFrame } = render(
        <LabelList labels={['1080p', '4k', '2024']} />
      );

      const frame = lastFrame();
      expect(frame).toContain('[1080p]');
      expect(frame).toContain('[4k]');
      expect(frame).toContain('[2024]');
    });

    it('handles very long label lists', () => {
      const manyLabels = Array.from({ length: 20 }, (_, i) => `label${i}`);
      const { lastFrame } = render(
        <LabelList labels={manyLabels} maxLabels={3} />
      );

      const frame = lastFrame();
      expect(frame).toContain('[label0]');
      expect(frame).toContain('[label1]');
      expect(frame).toContain('[label2]');
      expect(frame).toContain('+17');
    });

    it('preserves label order', () => {
      const { lastFrame } = render(
        <LabelList labels={['first', 'second', 'third']} maxLabels={3} />
      );

      const frame = lastFrame();
      const firstIndex = frame.indexOf('[first]');
      const secondIndex = frame.indexOf('[second]');
      const thirdIndex = frame.indexOf('[third]');

      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });
  });
});
