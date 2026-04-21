import { describe, it, expect } from 'vitest';
import { MRZ_SYMBOLS } from './symbols.js';

describe('MRZ_SYMBOLS', () => {
  it('should contain 37 characters', () => {
    expect(MRZ_SYMBOLS).toHaveLength(37);
  });

  it('should contain all digits', () => {
    for (let i = 0; i <= 9; i++) {
      expect(MRZ_SYMBOLS).toContain(String(i));
    }
  });

  it('should contain all uppercase letters', () => {
    for (let i = 65; i <= 90; i++) {
      expect(MRZ_SYMBOLS).toContain(String.fromCharCode(i));
    }
  });

  it('should contain the filler character <', () => {
    expect(MRZ_SYMBOLS).toContain('<');
  });
});
