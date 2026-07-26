import { appearanceSchema } from '@shared/schemas/form-schema';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import {
  exportPresetJson,
  FORM_APPEARANCE_PRESETS,
  importPresetJson,
  PRESET_CATEGORIES,
} from './presets';

/** The readable pairs every preset must clear at AA (4.5:1). */
const AA_PAIRS: [
  fg: 'text' | 'muted' | 'buttonText',
  bg: 'background' | 'pageBackground' | 'surface' | 'primary',
][] = [
  ['text', 'background'],
  ['text', 'pageBackground'],
  ['text', 'surface'],
  ['muted', 'background'],
  ['buttonText', 'primary'],
];

describe('FORM_APPEARANCE_PRESETS', () => {
  it('ships the expanded (Batch 6) preset set with unique ids', () => {
    // Batch 6 expanded the built-in set from 6 → ~20.
    expect(FORM_APPEARANCE_PRESETS.length).toBeGreaterThanOrEqual(18);
    const ids = FORM_APPEARANCE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns every preset a known category (Batch 6)', () => {
    for (const preset of FORM_APPEARANCE_PRESETS) {
      expect(PRESET_CATEGORIES).toContain(preset.category);
    }
    // Every declared category is represented by at least one preset.
    for (const category of PRESET_CATEGORIES) {
      expect(FORM_APPEARANCE_PRESETS.some((p) => p.category === category)).toBe(true);
    }
  });

  it('every preset is a schema-valid, fully-defaulted FormAppearance', () => {
    for (const { appearance } of FORM_APPEARANCE_PRESETS) {
      expect(appearanceSchema.safeParse(appearance).success).toBe(true);
    }
  });

  it('every preset clears WCAG AA on the readable colour pairs', () => {
    for (const { name, appearance } of FORM_APPEARANCE_PRESETS) {
      for (const [fg, bg] of AA_PAIRS) {
        const ratio = contrastRatio(appearance.colors[fg], appearance.colors[bg]);
        expect(ratio, `${name}: ${fg} on ${bg}`).not.toBeNull();
        expect(ratio ?? 0, `${name}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('preset JSON export/import (Batch 6)', () => {
  const first = FORM_APPEARANCE_PRESETS[0];
  if (!first) throw new Error('no presets to sample');
  const sample = first.appearance;

  it('round-trips an appearance through export → import', () => {
    const json = exportPresetJson(sample);
    const result = importPresetJson(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.appearance).toEqual(sample);
  });

  it('accepts a bare appearance object (no envelope)', () => {
    const result = importPresetJson(JSON.stringify(sample));
    expect(result.ok).toBe(true);
  });

  it('rejects invalid JSON with a friendly error', () => {
    const result = importPresetJson('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON/i);
  });

  it('rejects a schema-invalid appearance (hostile/malformed)', () => {
    const result = importPresetJson(JSON.stringify({ colors: { primary: 'red' } }));
    expect(result.ok).toBe(false);
  });
});
