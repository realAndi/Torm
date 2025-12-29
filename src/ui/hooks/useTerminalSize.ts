import { useState, useEffect } from 'react';
import { useStdout } from 'ink';

export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * Hook to get and track terminal dimensions.
 * Updates when the terminal is resized and clears the screen to prevent artifacts.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();

  const [size, setSize] = useState<TerminalSize>({
    columns: stdout.columns || 80,
    rows: stdout.rows || 24,
  });

  useEffect(() => {
    const handleResize = () => {
      // Clear terminal and scrollback to prevent visual artifacts from old renders
      // \x1B[2J clears screen, \x1B[3J clears scrollback, \x1B[H moves cursor home
      stdout.write('\x1B[3J\x1B[2J\x1B[H');

      setSize({
        columns: stdout.columns || 80,
        rows: stdout.rows || 24,
      });
    };

    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  return size;
}

export default useTerminalSize;
