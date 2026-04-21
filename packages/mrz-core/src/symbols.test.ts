import { describe, it, expect } from 'vitest';
import { MRZ_SYMBOLS, SYMBOL_TO_INDEX, INDEX_TO_SYMBOL } from './symbols.js';

describe('MRZ_SYMBOLS', () => {
  it('should contain exactly 37 symbols', () => {
    expect(MRZ_SYMBOLS).toHaveLength(37);
  });

  it('should start with digits 0-9', () => {
    for (let i = 0; i <= 9; i++) {
      expect(MRZ_SYMBOLS[i]).toBe(String(i));
    }
  });

  it('should contain A-Z after digits', () => {
    for (let i = 0; i < 26; i++) {
      expect(MRZ_SYMBOLS[10 + i]).toBe(String.fromCharCode(65 + i));
    }
  });

  it('should end with <', () => {
    expect(MRZ_SYMBOLS[36]).toBe('<');
  });

  it('should have consistent bidirectional index mappings', () => {
    for (let i = 0; i < MRZ_SYMBOLS.length; i++) {
      const sym = MRZ_SYMBOLS[i];
      expect(SYMBOL_TO_INDEX.get(sym)).toBe(i);
      expect(INDEX_TO_SYMBOL.get(i)).toBe(sym);
    }
  });
});
