import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { HelpOverlay } from '../../../src/ui/components/HelpOverlay.js';

describe('HelpOverlay', () => {
  const defaultProps = {
    visible: true,
    onClose: vi.fn(),
  };

  describe('visibility', () => {
    it('renders nothing when visible is false', () => {
      const { lastFrame } = render(<HelpOverlay visible={false} onClose={vi.fn()} />);

      expect(lastFrame()).toBe('');
    });

    it('renders when visible is true', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      expect(lastFrame()).not.toBe('');
    });
  });

  describe('title', () => {
    it('renders "Keyboard Shortcuts" title', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('Keyboard Shortcuts');
    });
  });

  describe('Navigation section', () => {
    it('groups shortcuts by Navigation section', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('Navigation');
    });

    it('shows up/k shortcut for select previous', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('\u2191/k'); // up arrow/k
      expect(frame).toContain('Select previous');
    });

    it('shows down/j shortcut for select next', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('\u2193/j'); // down arrow/j
      expect(frame).toContain('Select next');
    });

    it('shows Enter shortcut for open details', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('Enter');
      expect(frame).toContain('Open details');
    });
  });

  describe('Actions section', () => {
    it('groups shortcuts by Actions section', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('Actions');
    });

    it('shows p shortcut for pause torrent', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('p');
      expect(frame).toContain('Pause torrent');
    });

    it('shows r shortcut for resume torrent', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('r');
      expect(frame).toContain('Resume torrent');
    });

    it('shows d shortcut for delete torrent', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('d');
      expect(frame).toContain('Delete torrent');
    });

    it('shows a shortcut for add torrent', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('a');
      expect(frame).toContain('Add torrent');
    });

    it('shows l shortcut for edit labels', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('l');
      expect(frame).toContain('Edit labels');
    });
  });

  describe('Global section', () => {
    it('groups shortcuts by Global section', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('Global');
    });

    it('shows ? shortcut for toggle help', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('?');
      expect(frame).toContain('Toggle this help');
    });

    it('shows q shortcut for quit', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('q');
      expect(frame).toContain('Quit');
    });
  });

  describe('keyboard shortcut format', () => {
    it('shows key and description for each shortcut', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      // Check that shortcuts are formatted with key followed by description
      // Key should be visible followed by description
      expect(frame).toMatch(/p.*Pause torrent/);
      expect(frame).toMatch(/r.*Resume torrent/);
      expect(frame).toMatch(/d.*Delete torrent/);
    });
  });

  describe('footer', () => {
    it('shows "Press any key to close" hint', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('Press any key to close');
    });
  });

  describe('border styling', () => {
    it('has proper border styling', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      // Check for box-drawing characters
      expect(frame).toContain('\u250c'); // top-left corner
      expect(frame).toContain('\u2510'); // top-right corner
      expect(frame).toContain('\u2514'); // bottom-left corner
      expect(frame).toContain('\u2518'); // bottom-right corner
      expect(frame).toContain('\u2500'); // horizontal line
      expect(frame).toContain('\u2502'); // vertical line
    });

    it('has section separator junctions', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();
      // Check for T-junction characters used to separate title from content
      expect(frame).toContain('\u251c'); // left junction
      expect(frame).toContain('\u2524'); // right junction
    });
  });

  describe('all shortcuts rendered', () => {
    it('renders all keyboard shortcuts', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();

      // Navigation shortcuts
      expect(frame).toContain('Select previous');
      expect(frame).toContain('Select next');
      expect(frame).toContain('Open details');

      // Action shortcuts
      expect(frame).toContain('Pause torrent');
      expect(frame).toContain('Resume torrent');
      expect(frame).toContain('Delete torrent');
      expect(frame).toContain('Add torrent');
      expect(frame).toContain('Edit labels');

      // Global shortcuts
      expect(frame).toContain('Toggle this help');
      expect(frame).toContain('Quit');
    });

    it('renders all section headers', () => {
      const { lastFrame } = render(<HelpOverlay {...defaultProps} />);

      const frame = lastFrame();

      expect(frame).toContain('Navigation');
      expect(frame).toContain('Actions');
      expect(frame).toContain('Global');
    });
  });
});
