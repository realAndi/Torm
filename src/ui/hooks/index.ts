/**
 * UI Hooks index
 *
 * Re-exports all custom hooks for the Torm TUI.
 *
 * @module ui/hooks
 */

export { useEngine, type UseEngineResult } from './useEngine.js';
export {
  useDaemonClient,
  type UseDaemonClientResult,
} from './useDaemonClient.js';
export {
  useKeyboard,
  type KeyName,
  type KeyboardHandlers,
  type UseKeyboardOptions,
} from './useKeyboard.js';
export { useTorrents, type UseTorrentsResult } from './useTorrents.js';
export {
  useTorrentLogs,
  type LogLevel,
  type LogEntry,
  type UseTorrentLogsResult,
} from './useTorrentLogs.js';
