import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { readdirSync, statSync, existsSync } from 'fs';
import { dirname, join, basename, resolve } from 'path';
import { homedir } from 'os';
import { colors, borders } from '../theme/index.js';

export interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  width?: number;
  focused?: boolean;
}

const CURSOR_CHAR = '▌';

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/**
 * Get directories in a given path
 */
function getDirectories(basePath: string): string[] {
  try {
    const expanded = expandPath(basePath);
    if (!existsSync(expanded)) return [];

    const entries = readdirSync(expanded, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Get autocomplete suggestions for a partial path
 */
function getSuggestions(partialPath: string): string[] {
  const expanded = expandPath(partialPath);
  const dir = dirname(expanded);
  const partial = basename(expanded);

  try {
    if (!existsSync(dir)) return [];

    const entries = readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(entry => {
        if (!entry.isDirectory()) return false;
        if (entry.name.startsWith('.')) return false;
        return entry.name.toLowerCase().startsWith(partial.toLowerCase());
      })
      .map(entry => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Check if path is a valid directory
 */
function isValidDirectory(path: string): boolean {
  try {
    const expanded = expandPath(path);
    return existsSync(expanded) && statSync(expanded).isDirectory();
  } catch {
    return false;
  }
}

export const PathInput: React.FC<PathInputProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  width = 40,
  focused = false,
}) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [directories, setDirectories] = useState<string[]>([]);

  // Refs for stable callbacks
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);

  // Update suggestions when value changes
  useEffect(() => {
    if (!focused) {
      setShowSuggestions(false);
      return;
    }

    const expanded = expandPath(value);

    // Check if we're at a directory boundary (ends with /)
    if (value.endsWith('/') || value.endsWith('\\')) {
      const dirs = getDirectories(expanded);
      setDirectories(dirs);
      setSuggestions([]);
      setShowSuggestions(dirs.length > 0);
      setSelectedSuggestion(0);
    } else {
      // Get autocomplete suggestions
      const suggs = getSuggestions(value);
      setSuggestions(suggs);
      setDirectories([]);
      setShowSuggestions(suggs.length > 0 && value.length > 0);
      setSelectedSuggestion(0);
    }
  }, [value, focused]);

  // Handle keyboard input
  useInput(
    (input, key) => {
      // Tab to autocomplete or cycle suggestions
      if (key.tab) {
        if (suggestions.length > 0) {
          // Autocomplete with current suggestion
          const suggestion = suggestions[selectedSuggestion];
          if (suggestion) {
            const newValue = suggestion + '/';
            valueRef.current = newValue;
            onChangeRef.current(newValue);
          }
        } else if (directories.length > 0) {
          // Select from directory list
          const dir = directories[selectedSuggestion];
          if (dir) {
            const basePath = expandPath(value);
            const newValue = join(basePath, dir) + '/';
            valueRef.current = newValue;
            onChangeRef.current(newValue);
          }
        }
        return;
      }

      // Up/Down to cycle through suggestions when showing
      if (showSuggestions && (key.upArrow || key.downArrow)) {
        const list = suggestions.length > 0 ? suggestions : directories;
        if (list.length > 0) {
          if (key.upArrow) {
            setSelectedSuggestion(prev => prev > 0 ? prev - 1 : list.length - 1);
          } else {
            setSelectedSuggestion(prev => prev < list.length - 1 ? prev + 1 : 0);
          }
        }
        return;
      }

      // Enter to submit or select suggestion
      if (key.return) {
        if (showSuggestions && (suggestions.length > 0 || directories.length > 0)) {
          const list = suggestions.length > 0 ? suggestions : directories;
          const selected = list[selectedSuggestion];
          if (selected) {
            const newValue = suggestions.length > 0
              ? selected + '/'
              : join(expandPath(value), selected) + '/';
            valueRef.current = newValue;
            onChangeRef.current(newValue);
            return;
          }
        }
        if (onSubmitRef.current) {
          onSubmitRef.current();
        }
        return;
      }

      // Handle backspace/delete
      if (key.backspace || key.delete) {
        if (valueRef.current.length > 0) {
          const newValue = valueRef.current.slice(0, -1);
          valueRef.current = newValue;
          onChangeRef.current(newValue);
        }
        return;
      }

      // Ignore other control keys
      if (key.ctrl || key.meta || key.escape || key.leftArrow || key.rightArrow) {
        return;
      }

      // Append printable characters
      if (input && input.length > 0) {
        const newValue = valueRef.current + input;
        valueRef.current = newValue;
        onChangeRef.current(newValue);
      }
    },
    { isActive: focused }
  );

  // Calculate dimensions
  const innerWidth = Math.max(width - 4, 1);
  const isEmpty = value.length === 0;
  const displayText = isEmpty ? placeholder : value;

  // Visible text with scrolling
  const cursorSpace = focused ? 1 : 0;
  const maxVisibleLength = innerWidth - cursorSpace;
  const visibleText = displayText.length > maxVisibleLength
    ? displayText.slice(displayText.length - maxVisibleLength)
    : displayText;

  const textLength = visibleText.length + cursorSpace;
  const paddingLength = Math.max(0, innerWidth - textLength);
  const padding = ' '.repeat(paddingLength);

  const borderColor = focused ? colors.primary : colors.muted;
  const horizontalLine = borders.horizontal.repeat(width - 2);

  // Validity indicator
  const isValid = isValidDirectory(value);

  // Determine what list to show
  const listToShow = suggestions.length > 0 ? suggestions : directories;
  const maxVisible = 5;
  const visibleList = listToShow.slice(0, maxVisible);

  return (
    <Box flexDirection="column">
      {/* Top border */}
      <Text color={borderColor}>
        {borders.rounded.topLeft}
        {horizontalLine}
        {borders.rounded.topRight}
      </Text>

      {/* Input content row */}
      <Text>
        <Text color={borderColor}>{borders.vertical}</Text>
        <Text> </Text>
        <Text color={isEmpty ? colors.muted : isValid ? colors.success : undefined}>
          {visibleText}
        </Text>
        {focused && <Text color={colors.primary}>{CURSOR_CHAR}</Text>}
        <Text>{padding}</Text>
        <Text> </Text>
        <Text color={borderColor}>{borders.vertical}</Text>
      </Text>

      {/* Bottom border of input */}
      <Text color={borderColor}>
        {borders.rounded.bottomLeft}
        {horizontalLine}
        {borders.rounded.bottomRight}
      </Text>

      {/* Suggestions dropdown */}
      {focused && showSuggestions && visibleList.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          <Text color={colors.muted} dimColor>
            {suggestions.length > 0 ? ' Suggestions:' : ' Folders:'}
          </Text>
          {visibleList.map((item, index) => {
            const isSelected = index === selectedSuggestion;
            const displayName = suggestions.length > 0
              ? basename(item)
              : item;
            const truncated = displayName.length > innerWidth - 4
              ? displayName.slice(0, innerWidth - 7) + '...'
              : displayName;

            return (
              <Text key={item}>
                <Text color={isSelected ? colors.primary : colors.muted}>
                  {isSelected ? ' > ' : '   '}
                </Text>
                <Text color={isSelected ? colors.primary : colors.text} bold={isSelected}>
                  {truncated}
                </Text>
              </Text>
            );
          })}
          {listToShow.length > maxVisible && (
            <Text color={colors.muted} dimColor>
              {`   ... and ${listToShow.length - maxVisible} more`}
            </Text>
          )}
          <Text color={colors.muted} dimColor>
            {' Tab: complete  ↑↓: select'}
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default PathInput;
