/**
 * WCAG relative-luminance contrast (WebAIM algorithm). Used by the Design tab
 * to warn when a colour pair falls below its readability threshold.
 */

/** Parse `#rgb`/`#rrggbb`/`#rrggbbaa` to 0-255 channels; null on garbage. */
function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, '');
  let r: string;
  let g: string;
  let b: string;
  if (m.length === 3) {
    r = m[0]! + m[0]!;
    g = m[1]! + m[1]!;
    b = m[2]! + m[2]!;
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

/** sRGB channel (0-255) to its linearized component. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a hex colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(linearize) as [number, number, number];
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

/** Whether a pair clears the given WCAG threshold (default AA normal text). */
export function meetsContrast(fg: string, bg: string, threshold = 4.5): boolean {
  const ratio = contrastRatio(fg, bg);
  return ratio !== null && ratio >= threshold;
}
