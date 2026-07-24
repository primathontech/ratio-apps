import { appearanceSchema } from '@shared/schemas/form-schema';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { FORM_APPEARANCE_PRESETS } from './presets';

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
  it('ships a handful of presets with unique ids', () => {
    expect(FORM_APPEARANCE_PRESETS.length).toBeGreaterThanOrEqual(5);
    const ids = FORM_APPEARANCE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
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
