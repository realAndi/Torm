import { describe, it, expect } from 'vitest';
import { VERSION, APP_NAME } from '../../src/shared/constants.js';

describe('Constants', () => {
  it('should have correct version', () => {
    expect(VERSION).toBe('0.3.0');
  });

  it('should have correct app name', () => {
    expect(APP_NAME).toBe('Torm');
  });
});
