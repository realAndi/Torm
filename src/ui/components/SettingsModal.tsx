import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, borders } from '../theme/index.js';
import { TextInput } from './TextInput.js';
import { DirectoryBrowser } from './DirectoryBrowser.js';
import { Checkbox } from './Checkbox.js';
import type { EngineConfig, UIConfig } from '../../engine/types.js';

export interface SettingsModalProps {
  visible: boolean;
  config: EngineConfig;
  onSave: (config: Partial<EngineConfig>) => void;
  onClose: () => void;
  width?: number;
  daemonConnected?: boolean;
  daemonUptime?: number;
  onStopDaemon?: () => void;
}

type FieldType = 'number' | 'checkbox';

interface SettingField {
  key: keyof EngineConfig;
  label: string;
  type: FieldType;
  section: 'limits' | 'network' | 'behavior';
}

interface UISettingField {
  key: keyof UIConfig;
  label: string;
  type: FieldType;
}

// Settings fields (excluding downloadPath which uses DirectoryBrowser)
const SETTINGS_FIELDS: SettingField[] = [
  {
    key: 'maxDownloadSpeed',
    label: 'Max Download',
    type: 'number',
    section: 'limits',
  },
  {
    key: 'maxUploadSpeed',
    label: 'Max Upload',
    type: 'number',
    section: 'limits',
  },
  {
    key: 'maxConnections',
    label: 'Max Connections',
    type: 'number',
    section: 'limits',
  },
  {
    key: 'maxConnectionsPerTorrent',
    label: 'Per Torrent',
    type: 'number',
    section: 'limits',
  },
  { key: 'port', label: 'Listen Port', type: 'number', section: 'network' },
  {
    key: 'dhtEnabled',
    label: 'Enable DHT',
    type: 'checkbox',
    section: 'network',
  },
  {
    key: 'pexEnabled',
    label: 'Enable PEX',
    type: 'checkbox',
    section: 'network',
  },
  {
    key: 'startOnAdd',
    label: 'Auto-start torrents',
    type: 'checkbox',
    section: 'behavior',
  },
  {
    key: 'verifyOnAdd',
    label: 'Verify on add',
    type: 'checkbox',
    section: 'behavior',
  },
];

// UI/Display settings fields
const UI_SETTINGS_FIELDS: UISettingField[] = [
  { key: 'minVisibleTorrents', label: 'Min Visible Torrents', type: 'number' },
];

function formatSpeed(value: number): string {
  if (value === 0) return 'Unlimited';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  return `${value} B/s`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// Focus areas: 'browser' for directory browser, then field indices, then buttons
type FocusArea = 'browser' | 'fields' | 'buttons';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  config,
  onSave,
  onClose,
  width = 80,
  daemonConnected = false,
  daemonUptime,
}) => {
  const [localConfig, setLocalConfig] = useState<Partial<EngineConfig>>({});
  const [focusArea, setFocusArea] = useState<FocusArea>('browser');
  const [fieldIndex, setFieldIndex] = useState(0);
  const [buttonFocus, setButtonFocus] = useState<'save' | 'cancel'>('save');

  const totalFields = SETTINGS_FIELDS.length + UI_SETTINGS_FIELDS.length;
  const wasVisible = useRef(false);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      setLocalConfig({
        downloadPath: config.downloadPath,
        maxDownloadSpeed: config.maxDownloadSpeed,
        maxUploadSpeed: config.maxUploadSpeed,
        maxConnections: config.maxConnections,
        maxConnectionsPerTorrent: config.maxConnectionsPerTorrent,
        port: config.port,
        dhtEnabled: config.dhtEnabled,
        pexEnabled: config.pexEnabled,
        startOnAdd: config.startOnAdd,
        verifyOnAdd: config.verifyOnAdd,
        ui: {
          minVisibleTorrents: config.ui?.minVisibleTorrents ?? 5,
        },
      });
      setFocusArea('browser');
      setFieldIndex(0);
      setButtonFocus('save');
    }
    wasVisible.current = visible;
  }, [visible, config]);

  const updateValue = useCallback(
    (key: keyof EngineConfig, value: string | number | boolean) => {
      setLocalConfig((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const updateUIValue = useCallback((key: keyof UIConfig, value: number) => {
    setLocalConfig((prev) => ({
      ...prev,
      ui: {
        ...prev.ui,
        [key]: value,
      },
    }));
  }, []);

  const handleSave = useCallback(() => {
    onSave(localConfig);
  }, [localConfig, onSave]);

  // Navigate from browser to fields (on Enter)
  const handleBrowserSubmit = useCallback(() => {
    setFocusArea('fields');
    setFieldIndex(0);
  }, []);

  // Handle navigation for fields and buttons (browser handles its own input)
  useInput(
    (input, key) => {
      // Escape always closes
      if (key.escape) {
        onClose();
        return;
      }

      // Skip if browser is focused (it handles its own input)
      if (focusArea === 'browser') {
        return;
      }

      // Tab navigation for fields and buttons
      if (key.tab) {
        if (focusArea === 'fields') {
          if (key.shift) {
            if (fieldIndex > 0) {
              setFieldIndex((prev) => prev - 1);
            } else {
              setFocusArea('browser');
            }
          } else {
            if (fieldIndex < totalFields - 1) {
              setFieldIndex((prev) => prev + 1);
            } else {
              setFocusArea('buttons');
            }
          }
        } else if (focusArea === 'buttons') {
          if (key.shift) {
            setFocusArea('fields');
            setFieldIndex(totalFields - 1);
          } else {
            setFocusArea('browser');
          }
        }
        return;
      }

      // Arrow keys for fields
      if (focusArea === 'fields') {
        if (key.upArrow && fieldIndex > 0) {
          setFieldIndex((prev) => prev - 1);
          return;
        }
        if (key.downArrow && fieldIndex < totalFields - 1) {
          setFieldIndex((prev) => prev + 1);
          return;
        }
        if (key.downArrow && fieldIndex === totalFields - 1) {
          setFocusArea('buttons');
          return;
        }
        if (key.upArrow && fieldIndex === 0) {
          setFocusArea('browser');
          return;
        }
      }

      // Button navigation
      if (focusArea === 'buttons') {
        if (key.leftArrow) {
          setButtonFocus('save');
          return;
        }
        if (key.rightArrow) {
          setButtonFocus('cancel');
          return;
        }
        if (key.upArrow) {
          setFocusArea('fields');
          setFieldIndex(totalFields - 1);
          return;
        }
        if (key.return) {
          if (buttonFocus === 'save') {
            handleSave();
          } else {
            onClose();
          }
          return;
        }
      }
    },
    { isActive: visible }
  );

  if (!visible) {
    return null;
  }

  const contentWidth = Math.min(80, width - 4);
  const columnWidth = Math.floor((contentWidth - 4) / 2);

  const renderField = (field: SettingField, index: number) => {
    const isFocused = focusArea === 'fields' && fieldIndex === index;
    const value = localConfig[field.key];

    if (field.type === 'checkbox') {
      return (
        <Box key={field.key} marginBottom={0}>
          <Checkbox
            checked={value as boolean}
            onChange={(checked) => updateValue(field.key, checked)}
            label={field.label}
            focused={isFocused}
          />
        </Box>
      );
    }

    const stringValue = value?.toString() ?? '';
    const isSpeed =
      field.key === 'maxDownloadSpeed' || field.key === 'maxUploadSpeed';
    const speedHint = isSpeed ? ` (${formatSpeed(Number(value) || 0)})` : '';

    return (
      <Box key={field.key} flexDirection="column" marginBottom={0}>
        <Text
          color={isFocused ? colors.primary : colors.muted}
          bold={isFocused}
        >
          {field.label}
          {speedHint}
        </Text>
        <TextInput
          value={stringValue}
          onChange={(newValue) => {
            const numericValue = newValue.replace(/[^0-9]/g, '');
            updateValue(
              field.key,
              numericValue ? parseInt(numericValue, 10) : 0
            );
          }}
          placeholder="0"
          width={columnWidth - 4}
          focused={isFocused}
        />
      </Box>
    );
  };

  const limitFields = SETTINGS_FIELDS.filter((f) => f.section === 'limits');
  const networkFields = SETTINGS_FIELDS.filter((f) => f.section === 'network');
  const behaviorFields = SETTINGS_FIELDS.filter(
    (f) => f.section === 'behavior'
  );

  // Calculate field indices for each section
  const getFieldGlobalIndex = (field: SettingField) => {
    return SETTINGS_FIELDS.findIndex((f) => f.key === field.key);
  };

  // Calculate UI field indices (offset by SETTINGS_FIELDS.length)
  const getUIFieldGlobalIndex = (field: UISettingField) => {
    return (
      SETTINGS_FIELDS.length +
      UI_SETTINGS_FIELDS.findIndex((f) => f.key === field.key)
    );
  };

  const renderUIField = (field: UISettingField, index: number) => {
    const isFocused = focusArea === 'fields' && fieldIndex === index;
    const value = localConfig.ui?.[field.key];
    const stringValue = value?.toString() ?? '';

    return (
      <Box key={field.key} flexDirection="column" marginBottom={0}>
        <Text
          color={isFocused ? colors.primary : colors.muted}
          bold={isFocused}
        >
          {field.label}
        </Text>
        <TextInput
          value={stringValue}
          onChange={(newValue) => {
            const numericValue = newValue.replace(/[^0-9]/g, '');
            updateUIValue(
              field.key,
              numericValue ? parseInt(numericValue, 10) : 5
            );
          }}
          placeholder="5"
          width={columnWidth - 4}
          focused={isFocused}
        />
      </Box>
    );
  };

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={colors.primary} bold>
          {borders.double.horizontal.repeat(3)} Settings{' '}
          {borders.double.horizontal.repeat(contentWidth - 14)}
        </Text>
      </Box>

      {/* Daemon Status */}
      <Box marginBottom={1} gap={3}>
        <Box>
          <Text color={daemonConnected ? colors.success : colors.error}>
            {daemonConnected ? '●' : '○'}
          </Text>
          <Text color={colors.muted}> Daemon: </Text>
          <Text color={daemonConnected ? colors.success : colors.warning}>
            {daemonConnected ? 'Running' : 'Stopped'}
          </Text>
        </Box>
        {daemonConnected && daemonUptime !== undefined && (
          <Box>
            <Text color={colors.muted}>Uptime: </Text>
            <Text color={colors.text}>{formatUptime(daemonUptime)}</Text>
          </Box>
        )}
      </Box>

      {/* Download Path Section with Directory Browser */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.primary} bold>
          {' '}
          Download Location
        </Text>
        <DirectoryBrowser
          value={localConfig.downloadPath?.toString() ?? ''}
          onChange={(path) => updateValue('downloadPath', path)}
          width={contentWidth}
          focused={focusArea === 'browser'}
          onSubmit={handleBrowserSubmit}
        />
      </Box>

      {/* Other Settings - Three Column Layout */}
      <Box flexDirection="row" gap={2}>
        {/* Speed & Connections */}
        <Box flexDirection="column" width={columnWidth}>
          <Text color={colors.primary} bold>
            {' '}
            Speed & Limits
          </Text>
          <Box flexDirection="column" paddingLeft={1}>
            {limitFields.map((field) =>
              renderField(field, getFieldGlobalIndex(field))
            )}
          </Box>
        </Box>

        {/* Network */}
        <Box flexDirection="column" width={columnWidth}>
          <Text color={colors.primary} bold>
            {' '}
            Network
          </Text>
          <Box flexDirection="column" paddingLeft={1}>
            {networkFields.map((field) =>
              renderField(field, getFieldGlobalIndex(field))
            )}
          </Box>

          <Box marginTop={1}>
            <Text color={colors.primary} bold>
              {' '}
              Behavior
            </Text>
          </Box>
          <Box flexDirection="column" paddingLeft={1}>
            {behaviorFields.map((field) =>
              renderField(field, getFieldGlobalIndex(field))
            )}
          </Box>

          <Box marginTop={1}>
            <Text color={colors.primary} bold>
              {' '}
              Display
            </Text>
          </Box>
          <Box flexDirection="column" paddingLeft={1}>
            {UI_SETTINGS_FIELDS.map((field) =>
              renderUIField(field, getUIFieldGlobalIndex(field))
            )}
          </Box>
        </Box>
      </Box>

      {/* Footer with buttons */}
      <Box marginTop={1} flexDirection="column">
        <Text color={colors.borderDim}>
          {borders.horizontal.repeat(contentWidth)}
        </Text>
        <Box marginTop={1} gap={3}>
          <Box>
            <Text
              color={
                focusArea === 'buttons' && buttonFocus === 'save'
                  ? colors.success
                  : colors.muted
              }
              bold={focusArea === 'buttons' && buttonFocus === 'save'}
              inverse={focusArea === 'buttons' && buttonFocus === 'save'}
            >
              {' Save '}
            </Text>
          </Box>
          <Box>
            <Text
              color={
                focusArea === 'buttons' && buttonFocus === 'cancel'
                  ? colors.error
                  : colors.muted
              }
              bold={focusArea === 'buttons' && buttonFocus === 'cancel'}
              inverse={focusArea === 'buttons' && buttonFocus === 'cancel'}
            >
              {' Cancel '}
            </Text>
          </Box>
          <Box flexGrow={1} />
          <Text color={colors.muted} dimColor>
            Tab: Next section ↑↓←→: Navigate Enter: Confirm Esc: Cancel
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export default SettingsModal;
