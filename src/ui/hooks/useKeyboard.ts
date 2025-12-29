/**
 * Keyboard input handling hook for the Torm TUI.
 *
 * Provides a unified interface for handling keyboard shortcuts throughout
 * the application. Supports arrow keys, vim-style navigation, and action keys.
 *
 * @module ui/hooks/useKeyboard
 */

import { useInput, Key } from 'ink';

/**
 * Standard key names that can be used in handlers.
 *
 * Arrow keys: 'up', 'down', 'left', 'right'
 * Vim-style: 'j' (down), 'k' (up), 'h' (left), 'l' (right)
 * Actions: 'q', 'p', 'r', 'd', 'a', 'enter', 'escape', '?', '/', 'L' (labels), 'S' (settings)
 * Tab numbers: '1', '2', '3', '4'
 */
export type KeyName =
  // Arrow keys
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  // Vim-style navigation
  | 'j'
  | 'k'
  | 'h'
  | 'l'
  // Action keys
  | 'q'
  | 'p'
  | 'r'
  | 'd'
  | 'a'
  | 'L' // Labels editor (uppercase to distinguish from vim 'l')
  | 'S' // Settings (uppercase)
  | 'enter'
  | 'escape'
  | 'backspace'
  | '?'
  | '/'
  // Tab numbers
  | '1'
  | '2'
  | '3'
  | '4';

/**
 * Handler map for keyboard shortcuts.
 * Keys are key names, values are handler functions.
 */
export type KeyboardHandlers = Partial<Record<KeyName, () => void>>;

/**
 * Options for the useKeyboard hook.
 */
export interface UseKeyboardOptions {
  /**
   * Map of key names to handler functions.
   * Handlers are called when the corresponding key is pressed.
   */
  handlers: KeyboardHandlers;

  /**
   * Whether keyboard input is enabled.
   * Set to false to disable input handling (e.g., when a modal is open).
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook for handling keyboard input in the Torm TUI.
 *
 * Wraps Ink's useInput hook and routes key presses to the appropriate
 * handlers based on the provided handler map.
 *
 * Supports:
 * - Arrow keys (up, down, left, right)
 * - Vim-style navigation (j=down, k=up, h=left, l=right)
 * - Action keys (q=quit, p=pause, r=resume, d=delete, a=add)
 * - Navigation keys (Enter, Escape, Backspace)
 * - Help key (?)
 * - Search key (/)
 * - Tab numbers (1-4)
 *
 * @example
 * ```tsx
 * // Basic usage in a component
 * useKeyboard({
 *   handlers: {
 *     up: () => selectPrev(),
 *     down: () => selectNext(),
 *     k: () => selectPrev(),  // vim-style
 *     j: () => selectNext(),  // vim-style
 *     enter: () => openDetails(),
 *     q: () => quit(),
 *     '?': () => toggleHelp(),
 *   },
 *   enabled: !showModal,  // Disable when modal is open
 * });
 * ```
 *
 * @example
 * ```tsx
 * // Detail view with tab navigation
 * useKeyboard({
 *   handlers: {
 *     left: () => prevTab(),
 *     right: () => nextTab(),
 *     h: () => prevTab(),
 *     l: () => nextTab(),
 *     escape: () => goBack(),
 *     backspace: () => goBack(),
 *     '1': () => setTab('files'),
 *     '2': () => setTab('peers'),
 *     '3': () => setTab('trackers'),
 *     '4': () => setTab('log'),
 *   },
 * });
 * ```
 */
export function useKeyboard({ handlers, enabled = true }: UseKeyboardOptions): void {
  useInput(
    (input: string, key: Key) => {
      // Handle special keys first
      if (key.upArrow) {
        handlers.up?.();
        return;
      }

      if (key.downArrow) {
        handlers.down?.();
        return;
      }

      if (key.leftArrow) {
        handlers.left?.();
        return;
      }

      if (key.rightArrow) {
        handlers.right?.();
        return;
      }

      if (key.return) {
        handlers.enter?.();
        return;
      }

      if (key.escape) {
        handlers.escape?.();
        return;
      }

      if (key.backspace || key.delete) {
        handlers.backspace?.();
        return;
      }

      // Handle character input
      const normalizedInput = input.toLowerCase();

      // Map input character to handler
      switch (normalizedInput) {
        // Vim-style navigation
        case 'j':
          handlers.j?.();
          break;
        case 'k':
          handlers.k?.();
          break;
        case 'h':
          handlers.h?.();
          break;
        case 'l':
          // 'l' can be used for both vim-style navigation AND label editor
          // Priority: if L handler exists, use it; otherwise use vim l handler
          if (handlers.L) {
            handlers.L();
          } else {
            handlers.l?.();
          }
          break;

        // Action keys
        case 'q':
          handlers.q?.();
          break;
        case 'p':
          handlers.p?.();
          break;
        case 'r':
          handlers.r?.();
          break;
        case 'd':
          handlers.d?.();
          break;
        case 'a':
          handlers.a?.();
          break;
        case 's':
          // 's' is used for settings (uppercase S handler)
          handlers.S?.();
          break;

        // Help and search
        case '?':
          handlers['?']?.();
          break;
        case '/':
          handlers['/']?.();
          break;

        // Tab numbers
        case '1':
          handlers['1']?.();
          break;
        case '2':
          handlers['2']?.();
          break;
        case '3':
          handlers['3']?.();
          break;
        case '4':
          handlers['4']?.();
          break;
      }
    },
    { isActive: enabled }
  );
}

export default useKeyboard;
