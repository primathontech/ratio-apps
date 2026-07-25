import { describe, expect, it } from 'vitest';
import {
  bestTextOn,
  blendOver,
  contrastRatio,
  gradeContrast,
  relativeLuminance,
  scrimmed,
} from './contrast';

describe('contrastRatio', () => {
  it('returns 21:1 for black on white (the WCAG maximum)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('is 1:1 for a colour against itself and order-independent', () => {
    expect(contrastRatio('#0fb3a9', '#0fb3a9')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(
      contrastRatio('#fff', '#000') ?? Number.NaN,
      5,
    );
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

describe('gradeContrast', () => {
  it('grades text pairs on the AAA/AA/AA-large/low ladder', () => {
    expect(gradeContrast('#000000', '#ffffff')).toMatchObject({ state: 'good', chip: 'AAA' });
    // ~4.5–7 band → AA (not AAA).
    expect(gradeContrast('#767676', '#ffffff')).toMatchObject({ state: 'good', chip: 'AA' });
    // ~3–4.5 band → large-text only.
    expect(gradeContrast('#949494', '#ffffff')).toMatchObject({ state: 'ok', chip: 'AA large' });
    // below 3 → low, no chip.
    expect(gradeContrast('#cccccc', '#ffffff')).toMatchObject({ state: 'low', chip: null });
  });

  it('grades non-text pairs on the flat 3:1 rule', () => {
    expect(gradeContrast('#949494', '#ffffff', { nonText: true })).toMatchObject({
      state: 'good',
      chip: 'OK',
    });
    expect(gradeContrast('#e5e7eb', '#ffffff', { nonText: true })).toMatchObject({
      state: 'low',
      chip: null,
    });
  });

  it('returns a low/null grade for unparseable colours', () => {
    expect(gradeContrast('nope', '#ffffff')).toEqual({ ratio: null, state: 'low', chip: null });
  });
});

describe('blendOver / scrimmed', () => {
  it('is a no-op at alpha 0 and equals the top colour at alpha 1', () => {
    expect(blendOver('#000000', 0, '#ffffff')).toBe('#ffffff');
    expect(blendOver('#000000', 1, '#ffffff')).toBe('#000000');
  });

  it('darkens the background as scrim increases (more scrim = lower luminance)', () => {
    const light = scrimmed('#ffffff', 0.2);
    const dark = scrimmed('#ffffff', 0.7);
    expect(relativeLuminance(dark) ?? 1).toBeLessThan(relativeLuminance(light) ?? 1);
    // A darker background gives white text more contrast than white-on-white (1:1).
    expect(contrastRatio('#ffffff', dark) ?? 0).toBeGreaterThan(1);
  });
});

describe('bestTextOn', () => {
  it('picks white on dark backgrounds and black on light ones', () => {
    expect(bestTextOn('#0b1f2a')).toBe('#ffffff');
    expect(bestTextOn('#ffffff')).toBe('#000000');
    expect(bestTextOn('#f5c518')).toBe('#000000'); // bright yellow → black text
  });

  it('always clears the large-text bar (3:1) on solid backgrounds', () => {
    for (const bg of ['#3d7cc9', '#0fb3a9', '#c0392b', '#6b7280']) {
      expect(contrastRatio(bestTextOn(bg), bg) ?? 0).toBeGreaterThanOrEqual(3);
    }
  });
});
