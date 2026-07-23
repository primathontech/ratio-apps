/**
 * WCAG relative-luminance contrast (WebAIM algorithm), plus the tier/grade and
 * scrim-compositing helpers the Design tab's accessibility report needs.
 *
 * Admin-only — NEVER import this into `packages/forms-sdk` (widget bundle cost).
 */

/** WCAG 2.x thresholds, by tier. */
export const WCAG = {
  /** Normal body text, AA. */
  AA_NORMAL: 4.5,
  /** Large text (≥24px, or ≥18.66px bold), AA — also the AAA-normal bar. */
  AA_LARGE: 3,
  /** Normal body text, AAA. */
  AAA_NORMAL: 7,
  /** Large text, AAA. */
  AAA_LARGE: 4.5,
  /** Non-text UI components (borders, focus rings, icons) — WCAG 1.4.11. */
  NON_TEXT: 3,
} as const;

type Rgb = [number, number, number];

/** Parse `#rgb`/`#rrggbb`/`#rrggbbaa` to 0-255 channels; null on garbage. */
function parseHex(hex: string): Rgb | null {
  const m = hex.trim().replace(/^#/, '');
  let r: string;
  let g: string;
  let b: string;
  if (m.length === 3) {
    r = `${m[0]}${m[0]}`;
    g = `${m[1]}${m[1]}`;
    b = `${m[2]}${m[2]}`;
  } else if (m.length === 6 || m.length === 8) {
    r = m.slice(0, 2);
    g = m.slice(2, 4);
    b = m.slice(4, 6);
  } else {
    return null;
  }
  const rn = Number.parseInt(r, 16);
  const gn = Number.parseInt(g, 16);
  const bn = Number.parseInt(b, 16);
  if (Number.isNaN(rn) || Number.isNaN(gn) || Number.isNaN(bn)) return null;
  return [rn, gn, bn];
}

function toHex([r, g, b]: Rgb): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** sRGB channel (0-255) to its linearized component. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a hex colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(linearize) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio (1-21) between two hex colours; null if either is invalid. */
export function contrastRatio(fg: string, bg: string): number | null {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  if (l1 === null || l2 === null) return null;
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Composite an opaque `top` colour at `alpha` (0-1) over an opaque `bottom`
 * colour (source-over alpha blend), returning the resulting hex. Models the
 * page scrim — a translucent black layer painted over the page background
 * before text sits on it. Null if either colour is unparseable.
 */
export function blendOver(topHex: string, alpha: number, bottomHex: string): string | null {
  const top = parseHex(topHex);
  const bottom = parseHex(bottomHex);
  if (!top || !bottom) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return toHex([
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
  ]);
}

/** The effective background after a black scrim at `scrim` opacity over `bg`. */
export function scrimmed(bgHex: string, scrim: number): string {
  return blendOver('#000000', scrim, bgHex) ?? bgHex;
}

interface ThresholdOpts {
  level?: 'AA' | 'AAA';
  /** Large text (≥24px or ≥18.66px bold) — drops the text bar to the large tier. */
  large?: boolean;
  /** Non-text UI component (border, focus ring, icon) — flat 3:1. */
  nonText?: boolean;
}

function thresholdFor({ level = 'AA', large = false, nonText = false }: ThresholdOpts): number {
  if (nonText) return WCAG.NON_TEXT;
  if (level === 'AAA') return large ? WCAG.AAA_LARGE : WCAG.AAA_NORMAL;
  return large ? WCAG.AA_LARGE : WCAG.AA_NORMAL;
}

/**
 * Whether a pair clears its threshold. Back-compatible: pass a number for a raw
 * threshold, or `{ level, large, nonText }` to resolve the WCAG tier.
 */
export function meetsContrast(
  fg: string,
  bg: string,
  opt: number | ThresholdOpts = WCAG.AA_NORMAL,
): boolean {
  const threshold = typeof opt === 'number' ? opt : thresholdFor(opt);
  const ratio = contrastRatio(fg, bg);
  return ratio !== null && ratio >= threshold;
}

/** Black or white — whichever has the higher contrast on `bg`. The auto-fix. */
export function bestTextOn(bg: string): '#000000' | '#ffffff' {
  const onBlack = contrastRatio('#000000', bg) ?? 0;
  const onWhite = contrastRatio('#ffffff', bg) ?? 0;
  return onWhite >= onBlack ? '#ffffff' : '#000000';
}

/** How a colour pair reads, for advisory display (not a pass/fail gate). */
export type ContrastState = 'good' | 'ok' | 'low';

export interface ContrastGrade {
  /** The ratio, or null when a colour is unparseable. */
  ratio: number | null;
  /** `good` = meets AA · `ok` = large-text only · `low` = below the bar. */
  state: ContrastState;
  /** Best tier met, for the chip: `AAA` | `AA` | `AA large` | `OK` (non-text) | null. */
  chip: string | null;
}

/**
 * Grade a pair for the report. Text pairs get the AAA/AA/AA-large ladder;
 * non-text pairs (borders, focus rings) get a flat 3:1 meets/low.
 */
export function gradeContrast(
  fg: string,
  bg: string,
  { nonText = false }: { nonText?: boolean } = {},
): ContrastGrade {
  const ratio = contrastRatio(fg, bg);
  if (ratio === null) return { ratio: null, state: 'low', chip: null };
  if (nonText) {
    return ratio >= WCAG.NON_TEXT
      ? { ratio, state: 'good', chip: 'OK' }
      : { ratio, state: 'low', chip: null };
  }
  if (ratio >= WCAG.AAA_NORMAL) return { ratio, state: 'good', chip: 'AAA' };
  if (ratio >= WCAG.AA_NORMAL) return { ratio, state: 'good', chip: 'AA' };
  if (ratio >= WCAG.AA_LARGE) return { ratio, state: 'ok', chip: 'AA large' };
  return { ratio, state: 'low', chip: null };
}
