import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { readdirSync, statSync, existsSync } from 'fs';
import { dirname, join, basename } from 'path';
import { homedir } from 'os';
import { colors, borders } from '../theme/index.js';

export interface DirectoryBrowserProps {
  value: string;
  onChange: (path: string) => void;
  width?: number;
  focused?: boolean;
  /** Called when user presses Enter to confirm and move to next element */
  onSubmit?: () => void;
  /** Called when user presses Up arrow to navigate to previous field */
  onNavigateUp?: () => void;
}

function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

function getAutocompleteSuggestions(partialPath: string): string[] {
  if (!partialPath) return [];

  const expanded = expandPath(partialPath);

  // If path ends with /, show contents of that directory
  if (partialPath.endsWith('/')) {
    try {
      if (existsSync(expanded) && statSync(expanded).isDirectory()) {
        const items = readdirSync(expanded, { withFileTypes: true });
        return items
          .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
          .map((item) => join(expanded, item.name))
          .slice(0, 6);
      }
    } catch {
      // Directory not accessible, ignore
    }
    return [];
  }

  // Otherwise, suggest completions for partial name
  const dir = dirname(expanded);
  const partial = basename(expanded).toLowerCase();

  try {
    if (!existsSync(dir)) return [];

    const items = readdirSync(dir, { withFileTypes: true });
    return items
      .filter((item) => {
        if (!item.isDirectory()) return false;
        if (item.name.startsWith('.')) return false;
        return item.name.toLowerCase().startsWith(partial);
      })
      .map((item) => join(dir, item.name))
      .slice(0, 6);
  } catch {
    return [];
  }
}

function isValidDirectory(path: string): boolean {
  try {
    const expanded = expandPath(path);
    return existsSync(expanded) && statSync(expanded).isDirectory();
  } catch {
    return false;
  }
}

const CURSOR_CHAR = '▌';

export const DirectoryBrowser: React.FC<DirectoryBrowserProps> = ({
  value,
  onChange,
  width = 50,
  focused = false,
  onSubmit,
  onNavigateUp,
}) => {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  const inputValueRef = useRef(inputValue);

  // Keep ref in sync
  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue]);

  // Sync with external value
  useEffect(() => {
    if (value !== inputValue) {
      setInputValue(value);
    }
  }, [value]);

  // Update suggestions when input changes
  useEffect(() => {
    const suggs = getAutocompleteSuggestions(inputValue);
    setSuggestions(suggs);
    setSelectedSuggestion(0);
  }, [inputValue]);

  const applyPath = useCallback(
    (path: string) => {
      setInputValue(path);
      inputValueRef.current = path;
      onChange(path);
    },
    [onChange]
  );

  const autocomplete = useCallback(() => {
    if (suggestions.length > 0) {
      const suggestion = suggestions[selectedSuggestion];
      if (suggestion) {
        applyPath(suggestion + '/');
      }
    }
  }, [suggestions, selectedSuggestion, applyPath]);

  useInput(
    (input, key) => {
      if (!focused) return;

      // Tab or Right arrow to autocomplete
      if (key.tab || key.rightArrow) {
        autocomplete();
        return;
      }

      // Enter to submit and move to next element
      if (key.return) {
        if (onSubmit) {
          onSubmit();
        }
        return;
      }

      // Up/Down to cycle through suggestions
      if (key.downArrow && suggestions.length > 0) {
        setSelectedSuggestion((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        return;
      }

      if (key.upArrow) {
        if (suggestions.length > 0 && selectedSuggestion > 0) {
          setSelectedSuggestion((prev) => prev - 1);
        } else if (onNavigateUp) {
          // At top of suggestions or no suggestions, navigate up to previous field
          onNavigateUp();
        }
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        if (inputValueRef.current.length > 0) {
          const newValue = inputValueRef.current.slice(0, -1);
          inputValueRef.current = newValue;
          setInputValue(newValue);
          onChange(newValue);
        }
        return;
      }

      // Escape to go back to previous field
      if (key.escape) {
        if (onNavigateUp) {
          onNavigateUp();
        }
        return;
      }

      // Ignore other control keys
      if (key.ctrl || key.meta || key.leftArrow) {
        return;
      }

      // Type characters
      if (input && input.length > 0) {
        const newValue = inputValueRef.current + input;
        inputValueRef.current = newValue;
        setInputValue(newValue);
        onChange(newValue);
      }
    },
    { isActive: focused }
  );

  // Width calculations:
  // Total width = width
  // Border line = corner (1) + horizontal (width-2) + corner (1) = width
  // Middle line = vertical (1) + content (width-2) + vertical (1) = width
  // Content = space (1) + text + cursor? + padding + space (1) = width - 2
  // So text area = width - 4 (minus 2 borders, minus 2 padding spaces)
  const textAreaWidth = width - 4;
  const cursorWidth = focused ? 1 : 0;
  const maxTextLength = textAreaWidth - cursorWidth;

  // Display input with cursor
  const displayValue = inputValue || '';
  const visibleValue =
    displayValue.length > maxTextLength
      ? '...' + displayValue.slice(-(maxTextLength - 3))
      : displayValue;
  const paddingLength = Math.max(0, maxTextLength - visibleValue.length);

  const isValid = isValidDirectory(inputValue);

  // Build complete border strings
  const horizontalLine = borders.horizontal.repeat(width - 2);
  const topBorder = `${borders.rounded.topLeft}${horizontalLine}${borders.rounded.topRight}`;
  const bottomBorder = `${borders.rounded.bottomLeft}${horizontalLine}${borders.rounded.bottomRight}`;

  // Build middle content - must be exactly (width - 2) chars to fit between vertical borders
  const cursorChar = focused ? CURSOR_CHAR : '';
  const middleContent = ` ${visibleValue}${cursorChar}${' '.repeat(paddingLength)} `;
  const borderColor = focused ? colors.border : colors.borderDim;

  return (
    <Box flexDirection="column" width={width}>
      {/* Path input */}
      <Box flexDirection="column">
        <Text wrap="truncate">
          <Text color={borderColor}>{topBorder}</Text>
        </Text>
        <Text wrap="truncate">
          <Text color={borderColor}>{borders.vertical}</Text>
          <Text color={isValid ? colors.success : colors.text}>
            {middleContent}
          </Text>
          <Text color={borderColor}>{borders.vertical}</Text>
        </Text>
        <Text wrap="truncate">
          <Text color={borderColor}>{bottomBorder}</Text>
        </Text>
      </Box>

      {/* Autocomplete suggestions */}
      {focused && suggestions.length > 0 && (
        <Box flexDirection="column" marginLeft={1} marginTop={0}>
          {suggestions.map((sugg, idx) => {
            const isSelected = idx === selectedSuggestion;
            const name = basename(sugg);
            const truncatedName =
              name.length > textAreaWidth - 4
                ? name.slice(0, textAreaWidth - 7) + '...'
                : name;
            return (
              <Text key={sugg}>
                <Text color={isSelected ? colors.primary : colors.muted}>
                  {isSelected ? '> ' : '  '}
                </Text>
                <Text
                  color={isSelected ? colors.primary : colors.text}
                  bold={isSelected}
                >
                  {truncatedName}/
                </Text>
              </Text>
            );
          })}
          <Text color={colors.muted} dimColor>
            {'  '}↑↓: select Tab/→: complete Enter: confirm
          </Text>
        </Box>
      )}

      {/* Help when no suggestions */}
      {focused && suggestions.length === 0 && (
        <Box marginLeft={1} marginTop={0}>
          <Text color={colors.muted} dimColor>
            Type a path (e.g. ~ for home, / for root)
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default DirectoryBrowser;
