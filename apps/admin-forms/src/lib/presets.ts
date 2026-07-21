import { appearanceSchema, type FormAppearance } from '@shared/schemas/form-schema';

/**
 * Hand-built appearance presets applied in one click from the Design tab.
 * Each palette clears WCAG AA (4.5:1) on the readable pairs — text on
 * background/surface, muted on background, and button text on primary —
 * verified in `presets.test.ts`. Applying a preset only touches
 * colors/typography/layout; a merchant's logo/cover survive.
 */
export interface AppearancePreset {
  id: string;
  name: string;
  appearance: FormAppearance;
}

/** Build a full appearance from a partial, letting the schema fill defaults. */
function preset(id: string, name: string, partial: Record<string, unknown>): AppearancePreset {
  return { id, name, appearance: appearanceSchema.parse(partial) };
}

export const FORM_APPEARANCE_PRESETS: AppearancePreset[] = [
  preset('teal', 'Teal', {
    colors: {
      primary: '#0f766e',
      background: '#ffffff',
      pageBackground: '#eef2f4',
      surface: '#ffffff',
      text: '#1a1a1a',
      muted: '#5b6472',
      border: '#d9dee5',
      error: '#c0392b',
      buttonText: '#ffffff',
    },
    layout: { radius: 10, shadow: 'sm' },
  }),
  preset('midnight', 'Midnight', {
    colors: {
      primary: '#38bdf8',
      background: '#0f172a',
      pageBackground: '#020617',
      surface: '#1e293b',
      text: '#f1f5f9',
      muted: '#94a3b8',
      border: '#334155',
      error: '#f87171',
      buttonText: '#0f172a',
    },
    layout: { radius: 12, shadow: 'md' },
    // A subtle top-to-bottom gradient behind the card for depth.
    background: { type: 'gradient', gradientFrom: '#020617', gradientTo: '#1e293b' },
  }),
  preset('minimal', 'Minimal', {
    colors: {
      primary: '#171717',
      background: '#ffffff',
      pageBackground: '#f5f5f5',
      surface: '#fafafa',
      text: '#171717',
      muted: '#595959',
      border: '#d4d4d4',
      error: '#c0392b',
      buttonText: '#ffffff',
    },
    typography: { fontFamily: 'inter' },
    layout: { radius: 4, shadow: 'none', buttonShape: 'sharp' },
  }),
  preset('warm', 'Warm', {
    colors: {
      primary: '#c2410c',
      background: '#fffbf5',
      pageBackground: '#f6ecdd',
      surface: '#ffffff',
      text: '#3d2b1f',
      muted: '#846148',
      border: '#e8d9c5',
      error: '#b91c1c',
      buttonText: '#ffffff',
    },
    typography: { fontFamily: 'source-serif' },
    layout: { radius: 14, shadow: 'sm' },
  }),
  preset('high-contrast', 'High contrast', {
    colors: {
      primary: '#000000',
      background: '#ffffff',
      pageBackground: '#ffffff',
      surface: '#ffffff',
      text: '#000000',
      muted: '#3f3f46',
      border: '#000000',
      error: '#b91c1c',
      buttonText: '#ffffff',
    },
    layout: { radius: 6, shadow: 'none' },
  }),
  preset('ocean', 'Ocean', {
    colors: {
      primary: '#0369a1',
      background: '#f8fbfd',
      pageBackground: '#e3eef5',
      surface: '#ffffff',
      text: '#0f2a3d',
      muted: '#4a6b80',
      border: '#cfe0ea',
      error: '#c0392b',
      buttonText: '#ffffff',
    },
    layout: { radius: 12, shadow: 'sm', inputVariant: 'filled' },
    // A light diagonal gradient plus filled inputs for a softer, modern look.
    background: {
      type: 'gradient',
      gradientFrom: '#e3eef5',
      gradientTo: '#f8fbfd',
      gradientDir: 'to bottom right',
    },
  }),
];
