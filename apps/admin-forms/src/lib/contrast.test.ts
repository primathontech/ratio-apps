import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsContrast, relativeLuminance } from './contrast';

describe('contrastRatio', () => {
  it('returns 21:1 for black on white (the WCAG maximum)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('is 1:1 for a colour against itself and order-independent', () => {
    expect(contrastRatio('#0fb3a9', '#0fb3a9')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(contrastRatio('#fff', '#000')!, 5);
  });

  it('accepts shorthand and 8-digit hex', () => {
    expect(contrastRatio('#000', '#ffffffff')).toBeCloseTo(21, 5);
  });

  it('matches the WebAIM reference for mid-grey on white', () => {
    // #767676 on #ffffff is the canonical 4.54:1 AA boundary grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('returns null for invalid hex', () => {
    expect(contrastRatio('rgb(0,0,0)', '#fff')).toBeNull();
    expect(relativeLuminance('nonsense')).toBeNull();
  });
});

describe('meetsContrast', () => {
  it('passes AA for black on white and fails for a low-contrast pair', () => {
    expect(meetsContrast('#000000', '#ffffff')).toBe(true);
    expect(meetsContrast('#cccccc', '#ffffff')).toBe(false);
    // UI-component threshold (3:1) is easier to clear than the 4.5 default.
    expect(meetsContrast('#949494', '#ffffff', 3)).toBe(true);
  });
});
