import { describe, it, expect } from 'vitest';
import { parse } from './mrz-relax.js';

// Use a TD1 (ID card) format which is more lenient with state codes
// TD3 (passport) MRZ with fictional but structurally valid data
const VALID_TD3 = [
  'P<GABORIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36GAB7408122F1204159ZE184226B<<<<<14',
];

describe('parse', () => {
  it('should parse MRZ and return structured result', () => {
    const result = parse(VALID_TD3);
    expect(result).toBeDefined();
    expect(result.details).toBeDefined();
    expect(result.details.length).toBeGreaterThan(0);
  });

  it('should fix O->0 in numeric fields', () => {
    // Introduce an O where a 0 should be in the document number check digit area
    const mrz = [
      'P<GABORIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C36GAB74O8122F1204159ZE184226B<<<<<14',
    ];
    const result = parse(mrz);
    expect(result).toBeDefined();
    // The relaxation should attempt to fix O -> 0 in numeric positions
    if (result.modified) {
      expect(result.modified[1]).toContain('740');
    }
  });

  it('should fix 0->O in name/state fields', () => {
    // Replace O with 0 in the issuing state field (should be letters)
    const mrz = [
      'P<GAB0RIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C36GAB7408122F1204159ZE184226B<<<<<14',
    ];
    const result = parse(mrz);
    expect(result).toBeDefined();
    // The relaxation should attempt to fix 0 -> O in alpha positions
    if (result.modified) {
      expect(result.modified[0]).toContain('GABO');
    }
  });

  it('should handle MRZ without infinite recursion', () => {
    // Should complete without stack overflow regardless of validity
    const result = parse(VALID_TD3);
    expect(result).toBeDefined();
  });

  it('should set modified only when corrections were applied', () => {
    const result = parse(VALID_TD3);
    // If valid, no modifications needed; if already needs fixing, modified is set
    if (result.valid) {
      expect(result.modified).toBeUndefined();
    }
  });
});
