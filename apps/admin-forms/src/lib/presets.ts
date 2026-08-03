import { appearanceSchema, type FormAppearance } from '@shared/schemas/form-schema';

/**
 * Hand-built appearance presets applied in one click from the Design tab.
 * Each palette clears WCAG AA (4.5:1) on the readable pairs — text on
 * background/surface, muted on background, and button text on primary —
 * verified in `presets.test.ts`. Applying a preset only touches
 * colors/typography/layout/background; a merchant's logo/cover/branding/endings
 * survive (see DesignSettings.applyPreset).
 *
 * Batch 6 expands the built-in set from 6 → ~20 and groups them by
 * {@link category}, and adds admin-only JSON export/import (a preset is just a
 * schema-valid FormAppearance — zero renderer risk).
 */
export interface AppearancePreset {
  id: string;
  name: string;
  /** Grouping shown as a heading in the Design tab's preset picker. */
  category: PresetCategory;
  appearance: FormAppearance;
}

/** Preset groupings, in display order. */
export const PRESET_CATEGORIES = [
  'Classic',
  'Cool',
  'Warm',
  'Nature',
  'Bold',
  'Minimal',
  'Dark',
] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

/** Build a full appearance from a partial, letting the schema fill defaults. */
function preset(
  id: string,
  name: string,
  category: PresetCategory,
  partial: Record<string, unknown>,
): AppearancePreset {
  return { id, name, category, appearance: appearanceSchema.parse(partial) };
}

export const FORM_APPEARANCE_PRESETS: AppearancePreset[] = [
  // ── Classic ──────────────────────────────────────────────────
  preset('teal', 'Teal', 'Classic', {
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
  preset('slate', 'Slate', 'Classic', {
    colors: {
      primary: '#334155',
      background: '#ffffff',
      pageBackground: '#f1f5f9',
      surface: '#ffffff',
      text: '#0f172a',
      muted: '#475569',
      border: '#cbd5e1',
      error: '#c0392b',
      buttonText: '#ffffff',
    },
    layout: { radius: 8, shadow: 'sm' },
  }),
  preset('royal', 'Royal', 'Classic', {
    colors: {
      primary: '#1d4ed8',
      background: '#ffffff',
      pageBackground: '#eef2ff',
      surface: '#ffffff',
      text: '#1e293b',
      muted: '#475569',
      border: '#c7d2fe',
      error: '#c0392b',
      buttonText: '#ffffff',
    },
    layout: { radius: 12, shadow: 'md' },
  }),
  // ── Cool ─────────────────────────────────────────────────────
  preset('ocean', 'Ocean', 'Cool', {
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
  preset('sky', 'Sky', 'Cool', {
    colors: {
      primary: '#0369a1',
      background: '#ffffff',
      pageBackground: '#e0f2fe',
      surface: '#f8fafc',
      text: '#0c2233',
      muted: '#42607a',
      border: '#bae6fd',
      error: '#c0392b',
      buttonText: '#ffffff',
    },
    layout: { radius: 14, shadow: 'sm' },
  }),
  preset('indigo', 'Indigo', 'Cool', {
    colors: {
      primary: '#4338ca',
      background: '#ffffff',
      pageBackground: '#eef2ff',
      surface: '#f8faff',
      text: '#1e1b4b',
      muted: '#4b5563',
      border: '#c7d2fe',
      error: '#c0392b',
      buttonText: '#ffffff',
    },
    layout: { radius: 10, shadow: 'md' },
  }),
  // ── Warm ─────────────────────────────────────────────────────
  preset('warm', 'Warm', 'Warm', {
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
  preset('sunset', 'Sunset', 'Warm', {
    colors: {
      primary: '#b45309',
      background: '#fffbeb',
      pageBackground: '#fef3c7',
      surface: '#ffffff',
      text: '#431407',
      muted: '#78350f',
      border: '#fde68a',
      error: '#b91c1c',
      buttonText: '#ffffff',
    },
    layout: { radius: 12, shadow: 'sm' },
  }),
  preset('blush', 'Blush', 'Warm', {
    colors: {
      primary: '#be123c',
      background: '#fffafa',
      pageBackground: '#ffe4e6',
      surface: '#ffffff',
      text: '#4c0519',
      muted: '#9f1239',
      border: '#fecdd3',
      error: '#b91c1c',
      buttonText: '#ffffff',
    },
    layout: { radius: 16, shadow: 'sm' },
  }),
  // ── Nature ───────────────────────────────────────────────────
  preset('forest', 'Forest', 'Nature', {
    colors: {
      primary: '#15803d',
      background: '#f7fdf9',
      pageBackground: '#dcfce7',
      surface: '#ffffff',
      text: '#14532d',
      muted: '#3f6212',
      border: '#bbf7d0',
      error: '#b91c1c',
      buttonText: '#ffffff',
    },
    layout: { radius: 10, shadow: 'sm' },
  }),
  preset('sage', 'Sage', 'Nature', {
    colors: {
      primary: '#3f6212',
      background: '#f7fee7',
      pageBackground: '#ecfccb',
      surface: '#ffffff',
      text: '#1a2e05',
      muted: '#3f6212',
      border: '#d9f99d',
      error: '#b91c1c',
      buttonText: '#ffffff',
    },
    layout: { radius: 8, shadow: 'none' },
  }),
  preset('earth', 'Earth', 'Nature', {
    colors: {
      primary: '#57534e',
      background: '#fafaf9',
      pageBackground: '#f5f5f4',
      surface: '#ffffff',
      text: '#292524',
      muted: '#57534e',
      border: '#e7e5e4',
      error: '#b91c1c',
      buttonText: '#ffffff',
    },
    typography: { fontFamily: 'merriweather' },
    layout: { radius: 6, shadow: 'sm' },
  }),
  // ── Bold ─────────────────────────────────────────────────────
  preset('crimson', 'Crimson', 'Bold', {
    colors: {
      primary: '#b91c1c',
      background: '#ffffff',
      pageBackground: '#fef2f2',
      surface: '#ffffff',
      text: '#1a1a1a',
      muted: '#52525b',
      border: '#fecaca',
      error: '#b91c1c',
      buttonText: '#ffffff',
    },
    layout: { radius: 10, shadow: 'md', buttonShape: 'pill' },
  }),
  preset('grape', 'Grape', 'Bold', {
    colors: {
      primary: '#7c3aed',
      background: '#ffffff',
      pageBackground: '#f5f3ff',
      surface: '#ffffff',
      text: '#2e1065',
      muted: '#52525b',
      border: '#ddd6fe',
      error: '#b91c1c',
      buttonText: '#ffffff',
    },
    layout: { radius: 14, shadow: 'md', buttonShape: 'pill' },
  }),
  preset('tangerine', 'Tangerine', 'Bold', {
    colors: {
      // A light amber primary paired with dark button text (the reverse of the
      // usual white-on-dark), still clearing AA.
      primary: '#f59e0b',
      background: '#fffbeb',
      pageBackground: '#fef3c7',
      surface: '#ffffff',
      text: '#451a03',
      muted: '#78350f',
      border: '#fde68a',
      error: '#b91c1c',
      buttonText: '#1a1a1a',
    },
    layout: { radius: 12, shadow: 'sm' },
  }),
  // ── Minimal ──────────────────────────────────────────────────
  preset('minimal', 'Minimal', 'Minimal', {
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
  preset('paper', 'Paper', 'Minimal', {
    colors: {
      primary: '#292524',
      background: '#fafaf9',
      pageBackground: '#f5f5f4',
      surface: '#ffffff',
      text: '#1c1917',
      muted: '#57534e',
      border: '#e7e5e4',
      error: '#b91c1c',
      buttonText: '#fafaf9',
    },
    layout: { radius: 2, shadow: 'none', cardBorder: true },
  }),
  preset('high-contrast', 'High contrast', 'Minimal', {
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
  // ── Dark ─────────────────────────────────────────────────────
  preset('midnight', 'Midnight', 'Dark', {
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
  preset('carbon', 'Carbon', 'Dark', {
    colors: {
      primary: '#a78bfa',
      background: '#18181b',
      pageBackground: '#09090b',
      surface: '#27272a',
      text: '#fafafa',
      muted: '#a1a1aa',
      border: '#3f3f46',
      error: '#f87171',
      buttonText: '#18181b',
    },
    layout: { radius: 10, shadow: 'lg' },
  }),
  preset('dusk', 'Dusk', 'Dark', {
    colors: {
      primary: '#818cf8',
      background: '#1e1b2e',
      pageBackground: '#13111f',
      surface: '#2a2640',
      text: '#ede9fe',
      muted: '#c4b5fd',
      border: '#3b3563',
      error: '#f87171',
      buttonText: '#1e1b2e',
    },
    layout: { radius: 14, shadow: 'lg' },
    background: { type: 'gradient', gradientFrom: '#13111f', gradientTo: '#2a2640' },
  }),
];

/** Version tag stamped on an exported preset so an import can sniff the shape. */
const PRESET_EXPORT_VERSION = 1;

interface PresetExportEnvelope {
  ratioFormsPreset: number;
  appearance: FormAppearance;
}

/**
 * Serialize an appearance as a shareable preset JSON (admin-only). Wrapped in a
 * small envelope so an import can recognize the file; the appearance is a plain
 * schema-valid object, so the export is lossless and re-importable anywhere.
 */
export function exportPresetJson(appearance: FormAppearance): string {
  const envelope: PresetExportEnvelope = {
    ratioFormsPreset: PRESET_EXPORT_VERSION,
    appearance,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Parse a preset JSON back into a validated FormAppearance. Accepts either the
 * wrapped export envelope or a bare appearance object. Runs the SAME
 * appearanceSchema the builder/backend use, so a malformed or hostile file is
 * rejected (never applied) rather than reaching the renderer. Returns a
 * discriminated result so the caller can surface a friendly message.
 */
export function importPresetJson(
  text: string,
): { ok: true; appearance: FormAppearance } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That doesn't look like valid JSON." };
  }
  // Unwrap the export envelope when present; otherwise treat the whole value as
  // the appearance.
  const candidate =
    raw && typeof raw === 'object' && 'appearance' in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).appearance
      : raw;
  const parsed = appearanceSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: 'This is not a valid appearance preset.' };
  }
  return { ok: true, appearance: parsed.data };
}
