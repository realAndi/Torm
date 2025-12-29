/**
 * App - Root component for the Torm TUI.
 *
 * This is the main application shell that manages:
 * - Engine connection and torrent state
 * - View routing (MainView, DetailView)
 * - Global keyboard shortcuts
 * - Help overlay visibility
 * - Modal dialogs (Add Torrent, Delete Confirmation)
 *
 * @module ui/App
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Box, useApp, useInput } from 'ink';
import { useDaemonClient } from './hooks/useDaemonClient.js';
import { useTorrents } from './hooks/useTorrents.js';
import { useKeyboard } from './hooks/useKeyboard.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { useMascotState } from './hooks/useMascotState.js';
import { usePaste } from './hooks/usePaste.js';
import { MainView } from './views/MainView.js';
import { DetailView } from './views/DetailView.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { AddTorrentModal } from './components/AddTorrentModal.js';
import { BatchAddModal } from './components/BatchAddModal.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { LabelEditorModal } from './components/LabelEditorModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import type { StatusFilter } from './components/SearchBar.js';
import type { PartialEngineConfig, EngineConfig, Peer } from '../engine/types.js';

/**
 * View type for routing within the application.
 */
type ViewType = 'main' | 'detail';

/**
 * App component - Root of the Torm TUI
 *
 * Responsibilities:
 * - Initialize engine connection via useEngine hook
 * - Manage torrent selection via useTorrents hook
 * - Handle global keyboard shortcuts via useKeyboard hook
 * - Route to correct view (MainView or DetailView)
 * - Manage help overlay visibility
 * - Manage modal dialogs (Add Torrent, Delete Confirmation)
 *
 * State:
 * - currentView: 'main' | 'detail'
 * - showHelp: boolean
 * - showAddModal: boolean
 * - showDeleteConfirm: boolean
 * - deleteFiles: boolean
 *
 * Keyboard shortcuts (handled by this component):
 * - q: Quit application
 * - ?: Toggle help overlay
 * - up/k: Select previous torrent
 * - down/j: Select next torrent
 * - p: Pause selected torrent
 * - r: Resume selected torrent
 * - d: Delete selected torrent (opens confirmation dialog)
 * - a: Add new torrent (opens add modal)
 * - l: Edit labels for selected torrent (opens label editor)
 *
 * @example
 * ```tsx
 * import { render } from 'ink';
 * import { App } from './ui/App.js';
 *
 * render(<App />);
 * ```
 */
export const App: React.FC = () => {
  // Ink's useApp hook for exit functionality
  const { exit } = useApp();

  // Connect to daemon and get torrent state
  const {
    torrents,
    isReady,
    isConnecting,
    error: daemonError,
    daemonUptime,
    getPeers,
    addTorrent,
    removeTorrent,
    pauseTorrent,
    resumeTorrent,
    getConfig,
    updateConfig,
    shutdownDaemon,
  } = useDaemonClient();

  // State for peers (fetched async)
  const [currentPeers, setCurrentPeers] = useState<Peer[]>([]);

  // State for config (fetched async)
  const [config, setConfig] = useState<EngineConfig | null>(null);

  // Labels state (managed locally since daemon doesn't have labels API yet)
  const [labelsMap, setLabelsMap] = useState<Map<string, string[]>>(new Map());

  // Torrent selection management
  const {
    selectedTorrent,
    selectedIndex,
    selectNext,
    selectPrev,
    selectByIndex,
  } = useTorrents(torrents);

  // View state
  const [currentView, setCurrentView] = useState<ViewType>('main');

  // Help overlay state
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchAddModal, setShowBatchAddModal] = useState(false);
  const [batchAddFiles, setBatchAddFiles] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [showLabelEditor, setShowLabelEditor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  // Terminal size for responsive layout
  const { columns } = useTerminalSize();

  // Mascot expression state (tracks idle, connection, completions, deletions)
  const mascotState = useMascotState({
    torrents,
    isConnected: isReady,
    isConnecting,
  });

  // Search/filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Calculate total speeds from all torrents
  const totalDownloadSpeed = useMemo(() => {
    return torrents.reduce((sum, t) => sum + t.downloadSpeed, 0);
  }, [torrents]);

  const totalUploadSpeed = useMemo(() => {
    return torrents.reduce((sum, t) => sum + t.uploadSpeed, 0);
  }, [torrents]);

  // ==========================================================================
  // Action Handlers
  // ==========================================================================

  /**
   * Exit the application cleanly
   * The farewell message is handled by the CLI after Ink fully exits
   */
  const performExit = useCallback(() => {
    exit();
  }, [exit]);

  /**
   * Show quit confirmation dialog
   */
  const handleQuit = useCallback(() => {
    setShowQuitConfirm(true);
  }, []);

  /**
   * Confirm quit and exit
   */
  const handleConfirmQuit = useCallback(() => {
    setShowQuitConfirm(false);
    performExit();
  }, [performExit]);

  /**
   * Cancel quit and close dialog
   */
  const handleCancelQuit = useCallback(() => {
    setShowQuitConfirm(false);
  }, []);

  /**
   * Toggle help overlay visibility
   */
  const handleToggleHelp = useCallback(() => {
    setShowHelp((prev) => !prev);
  }, []);

  /**
   * Close help overlay
   */
  const handleCloseHelp = useCallback(() => {
    setShowHelp(false);
  }, []);

  /**
   * Pause the selected torrent
   */
  const handlePause = useCallback(() => {
    if (selectedTorrent) {
      pauseTorrent(selectedTorrent.infoHash).catch(() => {
        // Silently ignore pause errors (e.g., already paused)
      });
    }
  }, [pauseTorrent, selectedTorrent]);

  /**
   * Resume the selected torrent
   */
  const handleResume = useCallback(() => {
    if (selectedTorrent) {
      resumeTorrent(selectedTorrent.infoHash).catch(() => {
        // Silently ignore resume errors (e.g., already running)
      });
    }
  }, [resumeTorrent, selectedTorrent]);

  /**
   * Delete the selected torrent (legacy direct delete - kept for reference)
   */
  const _handleDelete = useCallback(() => {
    if (selectedTorrent) {
      removeTorrent(selectedTorrent.infoHash).catch(() => {
        // Silently ignore removal errors
      });
    }
  }, [removeTorrent, selectedTorrent]);

  /**
   * Open detail view for selected torrent
   */
  const handleOpenDetail = useCallback(() => {
    if (selectedTorrent) {
      setCurrentView('detail');
    }
  }, [selectedTorrent]);

  /**
   * Return to main view
   */
  const handleBackToMain = useCallback(() => {
    setCurrentView('main');
  }, []);

  // ==========================================================================
  // Modal Handlers
  // ==========================================================================

  /**
   * Open the add torrent modal
   */
  const handleOpenAddModal = useCallback(() => {
    setShowAddModal(true);
  }, []);

  /**
   * Close the add torrent modal
   */
  const handleCloseAddModal = useCallback(() => {
    setShowAddModal(false);
  }, []);

  /**
   * Handle adding a new torrent
   */
  const handleAddTorrent = useCallback(async (source: string, downloadPath: string) => {
    try {
      await addTorrent(source, { downloadPath });
      setShowAddModal(false);
    } catch (error) {
      // TODO: Show error to user
      console.error('Failed to add torrent:', error);
    }
  }, [addTorrent]);

  /**
   * Handle drag-and-drop of .torrent files
   * Opens batch add modal when files are detected
   */
  const handleTorrentFilesDrop = useCallback((files: string[]) => {
    if (files.length === 0) return;

    // Close add modal if open, switch to batch modal
    setShowAddModal(false);
    setBatchAddFiles(files);
    setShowBatchAddModal(true);
  }, []);

  /**
   * Close the batch add modal
   */
  const handleCloseBatchAddModal = useCallback(() => {
    setShowBatchAddModal(false);
    setBatchAddFiles([]);
  }, []);

  /**
   * Handle batch adding multiple torrents
   */
  const handleBatchAddTorrents = useCallback(async (files: string[], downloadPath: string) => {
    // Add all files in parallel
    const addPromises = files.map(async (file) => {
      try {
        await addTorrent(file, { downloadPath });
        return { file, success: true };
      } catch (error) {
        console.error(`Failed to add torrent ${file}:`, error);
        return { file, success: false };
      }
    });

    await Promise.all(addPromises);
    setShowBatchAddModal(false);
    setBatchAddFiles([]);
  }, [addTorrent]);

  /**
   * Open the delete confirmation dialog
   */
  const handleOpenDeleteConfirm = useCallback(() => {
    if (selectedTorrent) {
      setShowDeleteConfirm(true);
    }
  }, [selectedTorrent]);

  /**
   * Cancel delete and close dialog
   */
  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setDeleteFiles(false);
  }, []);

  /**
   * Confirm delete and remove the torrent
   */
  const handleConfirmDelete = useCallback(() => {
    if (selectedTorrent) {
      // Close dialog immediately for responsiveness (optimistic UI)
      setShowDeleteConfirm(false);
      setDeleteFiles(false);

      // Fire off the delete in the background
      removeTorrent(selectedTorrent.infoHash, deleteFiles).catch(() => {
        // Error handling is done in useDaemonClient (state restoration)
      });
    }
  }, [removeTorrent, selectedTorrent, deleteFiles]);

  /**
   * Open the label editor modal
   */
  const handleOpenLabelEditor = useCallback(() => {
    if (selectedTorrent) {
      setShowLabelEditor(true);
    }
  }, [selectedTorrent]);

  /**
   * Close the label editor modal
   */
  const handleCloseLabelEditor = useCallback(() => {
    setShowLabelEditor(false);
  }, []);

  /**
   * Save labels for the selected torrent
   */
  const handleSaveLabels = useCallback(async (labels: string[]) => {
    if (selectedTorrent) {
      // Store labels locally (daemon doesn't support labels yet)
      setLabelsMap(prev => {
        const newMap = new Map(prev);
        newMap.set(selectedTorrent.infoHash, labels);
        return newMap;
      });
      setShowLabelEditor(false);
    }
  }, [selectedTorrent]);

  /**
   * Get all unique labels across all torrents
   */
  const allLabels = useMemo(() => {
    const labelSet = new Set<string>();
    for (const labels of labelsMap.values()) {
      for (const label of labels) {
        labelSet.add(label);
      }
    }
    return Array.from(labelSet).sort();
  }, [labelsMap]);

  // ==========================================================================
  // Settings Handlers
  // ==========================================================================

  /**
   * Open the settings modal
   */
  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  /**
   * Close the settings modal
   */
  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  /**
   * Save settings and update engine config
   */
  const handleSaveSettings = useCallback(async (newConfig: PartialEngineConfig) => {
    try {
      await updateConfig(newConfig);
      // Refresh local config state to reflect changes
      const updatedConfig = await getConfig();
      setConfig(updatedConfig);
      setShowSettings(false);
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }, [updateConfig, getConfig]);

  // ==========================================================================
  // Search Handlers
  // ==========================================================================

  /**
   * Focus the search input
   */
  const handleFocusSearch = useCallback(() => {
    setIsSearchFocused(true);
  }, []);

  /**
   * Clear search and unfocus
   */
  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setIsSearchFocused(false);
  }, []);

  // ==========================================================================
  // Keyboard Handling
  // ==========================================================================

  // Keyboard handlers (disabled when help or modals are shown)
  // Main view handlers only active in main view, global handlers always active
  const isMainView = currentView === 'main';

  useKeyboard({
    handlers: {
      // Global shortcuts (always active)
      q: handleQuit,
      '?': handleToggleHelp,
      // Main view navigation (only in main view and not searching)
      up: isMainView && !isSearchFocused ? selectPrev : undefined,
      k: isMainView && !isSearchFocused ? selectPrev : undefined,
      down: isMainView && !isSearchFocused ? selectNext : undefined,
      j: isMainView && !isSearchFocused ? selectNext : undefined,
      // Main view actions (only in main view and not searching)
      p: isMainView && !isSearchFocused ? handlePause : undefined,
      r: isMainView && !isSearchFocused ? handleResume : undefined,
      d: isMainView && !isSearchFocused ? handleOpenDeleteConfirm : undefined,
      a: isMainView && !isSearchFocused ? handleOpenAddModal : undefined,
      L: isMainView && !isSearchFocused ? handleOpenLabelEditor : undefined,
      S: isMainView && !isSearchFocused ? handleOpenSettings : undefined,
      // Search (only in main view)
      '/': isMainView && !isSearchFocused ? handleFocusSearch : undefined,
      // Escape to clear search when filtering is active (main view only)
      escape:
        isMainView && (searchQuery || statusFilter !== 'all')
          ? handleClearSearch
          : undefined,
      // Open detail (only in main view and not searching)
      enter: isMainView && !isSearchFocused ? handleOpenDetail : undefined,
      // Note: escape/backspace handled by DetailView when in detail view
    },
    enabled: !showHelp && !showAddModal && !showBatchAddModal && !showDeleteConfirm && !showLabelEditor && !showSettings && !showQuitConfirm && !isSearchFocused,
  });

  // Detect drag-and-drop of .torrent files
  // Active when no modals are open (files can be dropped anywhere in the TUI)
  usePaste({
    onTorrentFiles: handleTorrentFilesDrop,
    enabled: !showHelp && !showAddModal && !showBatchAddModal && !showDeleteConfirm && !showLabelEditor && !showSettings && !showQuitConfirm && !isSearchFocused,
  });

  // Handle Ctrl+C globally to show quit confirmation
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      // If already showing quit confirm, confirm the quit
      if (showQuitConfirm) {
        handleConfirmQuit();
      } else {
        // Show quit confirmation
        setShowQuitConfirm(true);
      }
    }
  });

  // ==========================================================================
  // Render
  // ==========================================================================

  // Fetch peers when viewing detail
  useEffect(() => {
    if (currentView === 'detail' && selectedTorrent) {
      getPeers(selectedTorrent.infoHash).then(setCurrentPeers).catch(() => setCurrentPeers([]));
      const interval = setInterval(() => {
        getPeers(selectedTorrent.infoHash).then(setCurrentPeers).catch(() => setCurrentPeers([]));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [currentView, selectedTorrent, getPeers]);

  // Fetch config on mount
  useEffect(() => {
    if (isReady) {
      getConfig().then(setConfig).catch(() => setConfig(null));
    }
  }, [isReady, getConfig]);

  /**
   * Render the current view based on state
   */
  const renderView = () => {
    // Show detail view if selected
    if (currentView === 'detail' && selectedTorrent) {
      return (
        <DetailView
          torrent={selectedTorrent}
          peers={currentPeers}
          logs={[]}
          onBack={handleBackToMain}
          keyboardEnabled={!showHelp && !showAddModal && !showBatchAddModal && !showDeleteConfirm && !showLabelEditor && !showSettings && !showQuitConfirm}
        />
      );
    }

    return (
      <MainView
        torrents={torrents}
        selectedIndex={selectedIndex}
        totalDownloadSpeed={totalDownloadSpeed}
        totalUploadSpeed={totalUploadSpeed}
        onSelectChange={selectByIndex}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        isSearchFocused={isSearchFocused}
        onSearchFocusChange={setIsSearchFocused}
        daemonConnected={isReady}
        daemonUptime={daemonUptime}
        connectionStatus={isConnecting ? daemonError ?? undefined : undefined}
        minVisibleTorrents={config?.ui?.minVisibleTorrents}
        mascotExpression={mascotState.expression}
        mascotSleeping={mascotState.isSleeping}
        mascotSleepZCount={mascotState.sleepZCount}
        isDownloading={totalDownloadSpeed > 0}
      />
    );
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Main content area - hidden when settings, add modal, batch add modal, or quit confirm is open */}
      {!showSettings && !showAddModal && !showBatchAddModal && !showQuitConfirm && renderView()}

      {/* Add Torrent Modal */}
      <AddTorrentModal
        visible={showAddModal}
        onAdd={handleAddTorrent}
        onClose={handleCloseAddModal}
        defaultDownloadPath={config?.downloadPath}
        onBatchFiles={handleTorrentFilesDrop}
      />

      {/* Batch Add Modal (for drag-and-drop of multiple .torrent files) */}
      <BatchAddModal
        visible={showBatchAddModal}
        files={batchAddFiles}
        onAdd={handleBatchAddTorrents}
        onClose={handleCloseBatchAddModal}
        defaultDownloadPath={config?.downloadPath}
      />

      {/* Delete Confirmation Dialog */}
      {selectedTorrent && (
        <ConfirmDialog
          visible={showDeleteConfirm}
          title="Delete Torrent"
          message={`Delete "${selectedTorrent.name}"?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive={true}
          checkboxLabel="Also delete downloaded files"
          checkboxValue={deleteFiles}
          onCheckboxChange={setDeleteFiles}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      {/* Quit Confirmation Dialog */}
      <ConfirmDialog
        visible={showQuitConfirm}
        title="Quit Torm"
        message="Are you sure you want to quit?"
        confirmLabel="Quit"
        cancelLabel="Cancel"
        destructive={false}
        onConfirm={handleConfirmQuit}
        onCancel={handleCancelQuit}
      />

      {/* Label Editor Modal */}
      {selectedTorrent && (
        <LabelEditorModal
          visible={showLabelEditor}
          torrentName={selectedTorrent.name}
          currentLabels={selectedTorrent.labels || []}
          existingLabels={allLabels}
          onSave={handleSaveLabels}
          onClose={handleCloseLabelEditor}
        />
      )}

      {/* Settings Modal */}
      {config && (
        <SettingsModal
          visible={showSettings}
          config={config}
          onSave={handleSaveSettings}
          onClose={handleCloseSettings}
          width={columns}
          daemonConnected={isReady}
          daemonUptime={daemonUptime}
          onStopDaemon={shutdownDaemon}
        />
      )}

      {/* Help overlay (conditionally rendered) */}
      <HelpOverlay visible={showHelp} onClose={handleCloseHelp} />
    </Box>
  );
};

export default App;
