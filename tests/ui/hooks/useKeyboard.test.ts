/**
 * Tests for useKeyboard hook.
 *
 * Since useKeyboard wraps Ink's useInput hook, we test the internal
 * input handler logic by extracting and testing the handler behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Key } from 'ink';
import type { KeyboardHandlers } from '../../../src/ui/hooks/useKeyboard.js';

// Mock ink's useInput to capture the handler
let capturedInputHandler: ((input: string, key: Key) => void) | null = null;
let capturedOptions: { isActive?: boolean } | null = null;

vi.mock('ink', () => ({
  useInput: (handler: (input: string, key: Key) => void, options?: { isActive?: boolean }) => {
    capturedInputHandler = handler;
    capturedOptions = options || null;
  },
}));

// Import after mocking
import { useKeyboard } from '../../../src/ui/hooks/useKeyboard.js';

/**
 * Helper to create a mock Key object with default false values.
 */
function createMockKey(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...overrides,
  };
}

/**
 * Helper to simulate a key press after useKeyboard has been called.
 */
function simulateKeyPress(input: string, key: Partial<Key> = {}): void {
  if (!capturedInputHandler) {
    throw new Error('useKeyboard must be called before simulating key presses');
  }
  capturedInputHandler(input, createMockKey(key));
}

describe('useKeyboard', () => {
  beforeEach(() => {
    capturedInputHandler = null;
    capturedOptions = null;
    vi.clearAllMocks();
  });

  describe('arrow keys', () => {
    it('should call up handler for upArrow key', () => {
      const handlers: KeyboardHandlers = {
        up: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('', { upArrow: true });

      expect(handlers.up).toHaveBeenCalledTimes(1);
    });

    it('should call down handler for downArrow key', () => {
      const handlers: KeyboardHandlers = {
        down: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('', { downArrow: true });

      expect(handlers.down).toHaveBeenCalledTimes(1);
    });

    it('should call left handler for leftArrow key', () => {
      const handlers: KeyboardHandlers = {
        left: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('', { leftArrow: true });

      expect(handlers.left).toHaveBeenCalledTimes(1);
    });

    it('should call right handler for rightArrow key', () => {
      const handlers: KeyboardHandlers = {
        right: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('', { rightArrow: true });

      expect(handlers.right).toHaveBeenCalledTimes(1);
    });
  });

  describe('vim navigation keys (j/k/h/l)', () => {
    it('should call j handler for j key (down)', () => {
      const handlers: KeyboardHandlers = {
        j: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('j');

      expect(handlers.j).toHaveBeenCalledTimes(1);
    });

    it('should call k handler for k key (up)', () => {
      const handlers: KeyboardHandlers = {
        k: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('k');

      expect(handlers.k).toHaveBeenCalledTimes(1);
    });

    it('should call h handler for h key (left)', () => {
      const handlers: KeyboardHandlers = {
        h: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('h');

      expect(handlers.h).toHaveBeenCalledTimes(1);
    });

    it('should call l handler for l key (right)', () => {
      const handlers: KeyboardHandlers = {
        l: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('l');

      expect(handlers.l).toHaveBeenCalledTimes(1);
    });

    it('should normalize uppercase vim keys to lowercase', () => {
      const handlers: KeyboardHandlers = {
        j: vi.fn(),
        k: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('J');
      simulateKeyPress('K');

      expect(handlers.j).toHaveBeenCalledTimes(1);
      expect(handlers.k).toHaveBeenCalledTimes(1);
    });
  });

  describe('action keys (p/r/d/a)', () => {
    it('should call p handler for p key (pause)', () => {
      const handlers: KeyboardHandlers = {
        p: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('p');

      expect(handlers.p).toHaveBeenCalledTimes(1);
    });

    it('should call r handler for r key (resume)', () => {
      const handlers: KeyboardHandlers = {
        r: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('r');

      expect(handlers.r).toHaveBeenCalledTimes(1);
    });

    it('should call d handler for d key (delete)', () => {
      const handlers: KeyboardHandlers = {
        d: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('d');

      expect(handlers.d).toHaveBeenCalledTimes(1);
    });

    it('should call a handler for a key (add)', () => {
      const handlers: KeyboardHandlers = {
        a: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('a');

      expect(handlers.a).toHaveBeenCalledTimes(1);
    });

    it('should call q handler for q key (quit)', () => {
      const handlers: KeyboardHandlers = {
        q: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('q');

      expect(handlers.q).toHaveBeenCalledTimes(1);
    });
  });

  describe('special keys (enter/escape/backspace)', () => {
    it('should call enter handler for return key', () => {
      const handlers: KeyboardHandlers = {
        enter: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('', { return: true });

      expect(handlers.enter).toHaveBeenCalledTimes(1);
    });

    it('should call escape handler for escape key', () => {
      const handlers: KeyboardHandlers = {
        escape: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('', { escape: true });

      expect(handlers.escape).toHaveBeenCalledTimes(1);
    });

    it('should call backspace handler for backspace key', () => {
      const handlers: KeyboardHandlers = {
        backspace: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('', { backspace: true });

      expect(handlers.backspace).toHaveBeenCalledTimes(1);
    });

    it('should call backspace handler for delete key', () => {
      const handlers: KeyboardHandlers = {
        backspace: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('', { delete: true });

      expect(handlers.backspace).toHaveBeenCalledTimes(1);
    });
  });

  describe('search key', () => {
    it('should call / handler for / key (search)', () => {
      const handlers: KeyboardHandlers = {
        '/': vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('/');

      expect(handlers['/']).toHaveBeenCalledTimes(1);
    });
  });

  describe('tab number keys (1-4)', () => {
    it('should call 1 handler for 1 key', () => {
      const handlers: KeyboardHandlers = {
        '1': vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('1');

      expect(handlers['1']).toHaveBeenCalledTimes(1);
    });

    it('should call 2 handler for 2 key', () => {
      const handlers: KeyboardHandlers = {
        '2': vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('2');

      expect(handlers['2']).toHaveBeenCalledTimes(1);
    });

    it('should call 3 handler for 3 key', () => {
      const handlers: KeyboardHandlers = {
        '3': vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('3');

      expect(handlers['3']).toHaveBeenCalledTimes(1);
    });

    it('should call 4 handler for 4 key', () => {
      const handlers: KeyboardHandlers = {
        '4': vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('4');

      expect(handlers['4']).toHaveBeenCalledTimes(1);
    });
  });

  describe('enabled flag', () => {
    it('should pass enabled=true as isActive to useInput by default', () => {
      const handlers: KeyboardHandlers = {};

      useKeyboard({ handlers });

      expect(capturedOptions).toEqual({ isActive: true });
    });

    it('should pass enabled value as isActive to useInput', () => {
      const handlers: KeyboardHandlers = {};

      useKeyboard({ handlers, enabled: false });

      expect(capturedOptions).toEqual({ isActive: false });
    });

    it('should pass enabled=true explicitly', () => {
      const handlers: KeyboardHandlers = {};

      useKeyboard({ handlers, enabled: true });

      expect(capturedOptions).toEqual({ isActive: true });
    });
  });

  describe('missing handlers', () => {
    it('should not throw when handler is not defined for a key', () => {
      const handlers: KeyboardHandlers = {};

      useKeyboard({ handlers });

      expect(() => simulateKeyPress('', { upArrow: true })).not.toThrow();
      expect(() => simulateKeyPress('j')).not.toThrow();
      expect(() => simulateKeyPress('p')).not.toThrow();
      expect(() => simulateKeyPress('', { return: true })).not.toThrow();
    });
  });

  describe('L key (labels editor)', () => {
    it('should call L handler when L handler is defined', () => {
      const handlers: KeyboardHandlers = {
        L: vi.fn(),
        l: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('l');

      // L takes priority over l
      expect(handlers.L).toHaveBeenCalledTimes(1);
      expect(handlers.l).not.toHaveBeenCalled();
    });

    it('should call l handler when L handler is not defined', () => {
      const handlers: KeyboardHandlers = {
        l: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('l');

      expect(handlers.l).toHaveBeenCalledTimes(1);
    });
  });

  describe('special key priority', () => {
    it('should handle arrow keys before character input', () => {
      const handlers: KeyboardHandlers = {
        up: vi.fn(),
        k: vi.fn(),
      };

      useKeyboard({ handlers });
      // When upArrow is true, even if input is 'k', arrow key takes priority
      simulateKeyPress('k', { upArrow: true });

      expect(handlers.up).toHaveBeenCalledTimes(1);
      expect(handlers.k).not.toHaveBeenCalled();
    });

    it('should handle return key before character input', () => {
      const handlers: KeyboardHandlers = {
        enter: vi.fn(),
      };

      useKeyboard({ handlers });
      simulateKeyPress('', { return: true });

      expect(handlers.enter).toHaveBeenCalledTimes(1);
    });
  });
});
