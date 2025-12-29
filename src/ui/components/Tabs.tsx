import React from 'react';
import { Box, Text } from 'ink';
import { colors, borders } from '../theme/index.js';

export interface Tab {
  /** Unique identifier for the tab */
  id: string;
  /** Display label for the tab */
  label: string;
}

export interface TabsProps {
  /** Array of tabs to display */
  tabs: Tab[];
  /** ID of the currently active tab */
  activeTab: string;
  /** Callback when active tab changes */
  onChange: (tabId: string) => void;
}

/**
 * Horizontal tab navigation component
 *
 * Displays a row of tabs with visual indication of the active tab.
 * Keyboard navigation is handled by the parent component.
 *
 * @example
 * const tabs = [
 *   { id: 'files', label: 'Files' },
 *   { id: 'peers', label: 'Peers' },
 * ];
 * <Tabs tabs={tabs} activeTab="files" onChange={setActiveTab} />
 *
 * // Output:
 * // [Files]  Peers   Trackers   Log
 */
export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab }) => {
  return (
    <Box flexDirection="row" paddingX={1}>
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab;
        const tabNumber = index + 1;

        return (
          <Box key={tab.id} marginRight={2}>
            {isActive ? (
              <Text>
                <Text color={colors.muted}>[</Text>
                <Text color={colors.primary} bold>
                  {tabNumber}:{tab.label}
                </Text>
                <Text color={colors.muted}>]</Text>
              </Text>
            ) : (
              <Text color={colors.muted}>
                {tabNumber}:{tab.label}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

/**
 * Get the next tab ID in a circular manner
 *
 * @param tabs - Array of tabs
 * @param currentTab - Current active tab ID
 * @param direction - 1 for next, -1 for previous
 * @returns The next/previous tab ID
 */
export function getAdjacentTab(
  tabs: Tab[],
  currentTab: string,
  direction: 1 | -1
): string {
  const currentIndex = tabs.findIndex((t) => t.id === currentTab);
  if (currentIndex === -1) return tabs[0]?.id ?? '';

  const newIndex = (currentIndex + direction + tabs.length) % tabs.length;
  return tabs[newIndex].id;
}

/**
 * Get tab ID by number (1-based index)
 *
 * @param tabs - Array of tabs
 * @param num - 1-based tab number
 * @returns The tab ID or undefined if out of range
 */
export function getTabByNumber(tabs: Tab[], num: number): string | undefined {
  const index = num - 1;
  if (index >= 0 && index < tabs.length) {
    return tabs[index].id;
  }
  return undefined;
}

export default Tabs;
