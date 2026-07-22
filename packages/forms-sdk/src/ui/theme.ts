// Shared visual theme tokens for the forms SDK components.
import type { FormAppearance } from '@ratio-app/shared';
import { css } from 'lit';

/**
 * Theme input accepted by the SDK: the optional {@link FormAppearance} served
 * with the public form schema. When absent (or partial) every token falls back
 * to the baked-in defaults in {@link themeVars}, so an un-themed form is
 * visually unchanged.
 */
export type FormsThemeInput = FormAppearance | undefined;

type FontFamily = FormAppearance['typography']['fontFamily'];
type ButtonSize = FormAppearance['layout']['buttonSize'];
type InputSize = FormAppearance['layout']['inputSize'];
type BackgroundConfig = FormAppearance['background'];

// Curated font stacks, keyed by the shared FORM_FONT_FAMILIES enum. 'system'
// is the current default (no network font); the rest name a family loaded at
// document scope and fall back to the system stack while it loads.
const SYSTEM_FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
const FONT_STACKS: Record<FontFamily, string> = {
  system: SYSTEM_FONT,
  inter: `'Inter', ${SYSTEM_FONT}`,
  roboto: `'Roboto', ${SYSTEM_FONT}`,
  'open-sans': `'Open Sans', ${SYSTEM_FONT}`,
  lato: `'Lato', ${SYSTEM_FONT}`,
  montserrat: `'Montserrat', ${SYSTEM_FONT}`,
  poppins: `'Poppins', ${SYSTEM_FONT}`,
  'source-serif': `'Source Serif 4', Georgia, serif`,
  merriweather: `'Merriweather', Georgia, serif`,
};

/**
 * Fixed Google Fonts stylesheet URLs, enum-keyed so the merchant never supplies
 * a URL — nothing dynamic reaches the injected `<link href>`. 'system' has no
 * entry (no network font). Loaded once at document scope (see form-renderer).
 */
export const GOOGLE_FONT_HREF: Record<Exclude<FontFamily, 'system'>, string> = {
  inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
  roboto: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  'open-sans': 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap',
  lato: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap',
  montserrat: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap',
  poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap',
  'source-serif':
    'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&display=swap',
  merriweather: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap',
};

/**
 * Re-sanitize a merchant-supplied custom Google Font name at the SDK layer
 * (defense in depth — the shared schema already allow-lists it). Strips
 * anything outside `[A-Za-z0-9 -]` and collapses whitespace, then rejects the
 * empty result. The clean name is safe to interpolate into both the
 * font-family CSS declaration and the Google Fonts URL — no quotes, parens,
 * `;`, braces, or `url()` can survive. Returns null when nothing usable remains.
 */
export function sanitizeFontName(name: string | undefined): string | null {
  if (!name) return null;
  const clean = name.replace(/[^A-Za-z0-9 -]/g, '').trim().replace(/\s+/g, ' ');
  return clean.length > 0 ? clean : null;
}

/**
 * Build the Google Fonts stylesheet URL for a custom family name. The SDK, not
 * the merchant, composes the URL from a re-sanitized name (spaces → `+`), so
 * nothing dynamic reaches the injected `<link href>` — same invariant as the
 * fixed {@link GOOGLE_FONT_HREF} map. Returns null when the name is not usable.
 */
export function customGoogleFontHref(name: string | undefined): string | null {
  const clean = sanitizeFontName(name);
  if (!clean) return null;
  const family = clean.replace(/ /g, '+');
  // No :wght axis — a merchant can type any family, and css2 returns HTTP 400
  // (no CSS) if a requested weight doesn't exist for that font. Omitting it
  // loads the family's default face (always resolves); bold is synthesized.
  return `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
}

/** Font-family stack for a custom family name, over the shared system fallback. */
export function customFontStack(name: string | undefined): string | null {
  const clean = sanitizeFontName(name);
  return clean ? `'${clean}', ${SYSTEM_FONT}` : null;
}

// Density → field gap + vertical input padding + card padding (px). pad-x
// stays constant.
const DENSITY: Record<
  FormAppearance['layout']['density'],
  { gap: number; padY: number; cardPad: number }
> = {
  compact: { gap: 10, padY: 6, cardPad: 20 },
  comfortable: { gap: 14, padY: 8, cardPad: 28 },
  spacious: { gap: 20, padY: 11, cardPad: 36 },
};

// Card drop shadow, keyed by the shared FORM_SHADOWS enum. 'sm' is the default.
const SHADOWS: Record<FormAppearance['layout']['shadow'], string> = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px rgba(0, 0, 0, 0.05), 0 10px 20px rgba(0, 0, 0, 0.1)',
};

// Submit button size (§1.5) → vertical padding + font size tokens. 'md' is the
// default and reproduces today's button exactly (pad-y+2, base font size).
const BUTTON_SIZE: Record<ButtonSize, { padY: string; font: string }> = {
  sm: { padY: 'var(--wz-pad-y)', font: 'calc(var(--wz-font-size) - 1px)' },
  md: { padY: 'calc(var(--wz-pad-y) + 2px)', font: 'var(--wz-font-size)' },
  lg: { padY: 'calc(var(--wz-pad-y) + 6px)', font: 'calc(var(--wz-font-size) + 2px)' },
};

// Input size (§1.9) → min control height (px) for text inputs, selects, and
// textareas. 'md' is the default (~today). Height only: vertical padding still
// comes from density / the §1.6 inputPadY override, so this composes with both.
const INPUT_SIZE: Record<InputSize, number> = {
  sm: 34,
  md: 40,
  lg: 48,
};

/**
 * Re-validate a merchant asset URL and wrap it as a CSS `url("…")` — the SDK,
 * not the merchant, builds every `url()` (§1.1 security invariant). Returns the
 * inert CSS token or null when the URL is not a clean https asset. Rejects any
 * `)`, `,`, quote, or whitespace that could break out of the function.
 */
export function safeCssUrl(url: string | undefined): string | null {
  if (!url?.startsWith('https://')) return null;
  if (/[)\s,"']/.test(url)) return null;
  return `url("${url}")`;
}

/** A flat scrim overlay layer (§1.1) built from a bounded number — inert CSS. */
function scrimLayer(scrim: number): string {
  return scrim > 0 ? `linear-gradient(rgba(0,0,0,${scrim}),rgba(0,0,0,${scrim}))` : 'transparent';
}

/**
 * Compose the page-background layers (§1.1) from the appearance background
 * config. Everything is built from hex, enum members, bounded numbers, or a
 * re-validated https `url()` — never raw merchant CSS. Default (`solid`,
 * scrim 0) yields today's flat page background, unchanged.
 */
function pageBackground(bg: BackgroundConfig | undefined): {
  image: string;
  size: string;
  repeat: string;
  scrim: string;
} {
  const type = bg?.type ?? 'solid';
  if (type === 'gradient' && bg?.gradientFrom && bg?.gradientTo) {
    const dir = bg.gradientDir ?? 'to bottom';
    const image =
      dir === 'radial'
        ? `radial-gradient(circle, ${bg.gradientFrom}, ${bg.gradientTo})`
        : `linear-gradient(${dir}, ${bg.gradientFrom}, ${bg.gradientTo})`;
    return { image, size: 'auto', repeat: 'no-repeat', scrim: scrimLayer(bg.scrim ?? 0) };
  }
  if (type === 'image') {
    const url = safeCssUrl(bg?.imageUrl);
    if (url) {
      const fit = bg?.imageFit ?? 'cover';
      // Over an image, clamp the scrim to a contrast floor (WCAG) so text on
      // the card and any transparent surface stays legible.
      const scrim = Math.max(bg?.scrim ?? 0, 0.35);
      return {
        image: url,
        size: fit === 'repeat' ? 'auto' : fit,
        repeat: fit === 'repeat' ? 'repeat' : 'no-repeat',
        scrim: scrimLayer(scrim),
      };
    }
  }
  return { image: 'none', size: 'auto', repeat: 'no-repeat', scrim: scrimLayer(bg?.scrim ?? 0) };
}

/**
 * Emit a `:host` CSS custom-property block from an appearance. Returned as a
 * plain string so consumers can inline it (an instance `<style>` block) — Lit
 * components read these tokens via `var(--wz-*)`. Every token defaults to
 * today's baked-in value, so `themeVars(undefined)` reproduces the current look.
 */
export function themeVars(appearance?: FormsThemeInput): string {
  const c = appearance?.colors;
  const t = appearance?.typography;
  const l = appearance?.layout;

  const primary = c?.primary ?? '#0fb3a9';
  const radius = `${l?.radius ?? 10}px`;
  const density = DENSITY[l?.density ?? 'comfortable'];
  const shape = l?.buttonShape ?? 'rounded';
  const btnRadius = shape === 'sharp' ? '0' : shape === 'pill' ? '999px' : 'var(--wz-radius)';
  // fullWidthButton wins (button spans the column); otherwise buttonAlign picks
  // the submit's align-self within the flex column.
  const ALIGN_SELF = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;
  const btnAlign = l?.fullWidthButton ? 'stretch' : ALIGN_SELF[l?.buttonAlign ?? 'left'];
  const cardShadow = SHADOWS[l?.shadow ?? 'sm'];
  const cardBorder = l?.cardBorder === false ? 'none' : '1px solid var(--wz-border)';
  // §1.6 — explicit fieldGap/inputPadY win over the density preset when set.
  const gap = l?.fieldGap ?? density.gap;
  const padY = l?.inputPadY ?? density.padY;
  // §1.5 — button size tokens; 'md' reproduces today.
  const btnSize = BUTTON_SIZE[l?.buttonSize ?? 'md'];
  // §1.9 — input min-height; 'md' reproduces today.
  const inputMinH = INPUT_SIZE[l?.inputSize ?? 'md'];
  // §2.4 — transitions are OFF by default (today). Only when animations is on
  // does the duration token become non-zero, so an un-toggled form has no
  // transitions; the renderer still collapses it to ~0 under
  // prefers-reduced-motion so the OS setting always wins.
  const dur = l?.animations ? '0.12s' : '0s';
  // §2.6 — frosted-card blur radius (px). Only meaningful over an image
  // backdrop; the renderer gates the actual backdrop-filter behind a host
  // attribute, so 0 (default) is a no-op.
  const cardBlur = appearance?.background?.cardBlur ?? 0;
  // §1.1 — page background layers (gradient string / built url() / scrim).
  const bg = pageBackground(appearance?.background);
  // §2 — the area around the card defaults to TRANSPARENT so the host page
  // shows through (no white gutters). Only a distinct explicit solid color
  // paints; gradient/image paint via the image layer, so the base stays
  // transparent there too.
  const bgType = appearance?.background?.type ?? 'solid';
  const cardBg = c?.background ?? '#ffffff';
  const pageBg =
    bgType === 'solid' && c?.pageBackground && c.pageBackground !== cardBg
      ? c.pageBackground
      : 'transparent';
  // §3 — when a backdrop actually paints, give the root block padding so the
  // background breathes above/below the centered card, not only in the side
  // gutters. Transparent/unset ⇒ 0, so un-themed embeds keep a tight layout.
  const painted = pageBg !== 'transparent' || bg.image !== 'none';
  const pagePad = painted ? 'clamp(24px, 6vw, 72px)' : '0';

  return (
    `:host { ` +
    `--wz-primary: ${primary}; ` +
    `--wz-primary-hover: color-mix(in srgb, ${primary} 85%, #000); ` +
    `--wz-bg: ${c?.background ?? '#fff'}; ` +
    // Page color AROUND the card (§2). Transparent unless a distinct solid
    // color / gradient / image is explicitly chosen, so the host page shows
    // through instead of painting white gutters.
    `--wz-page-bg: ${pageBg}; ` +
    `--wz-surface: ${c?.surface ?? '#fff'}; ` +
    // Subtle fill for status boxes and the +91 phone chip. Derived from the
    // surface nudged toward the text color, so it reads as a faint panel on
    // light themes and a faint lift on dark ones (never a baked light gray).
    `--wz-subtle: color-mix(in srgb, var(--wz-surface) 92%, var(--wz-fg)); ` +
    `--wz-fg: ${c?.text ?? '#1a1a1a'}; ` +
    `--wz-muted: ${c?.muted ?? '#6b7280'}; ` +
    `--wz-border: ${c?.border ?? '#e5e7eb'}; ` +
    `--wz-error: ${c?.error ?? '#c0392b'}; ` +
    `--wz-btn-text: ${c?.buttonText ?? '#fff'}; ` +
    `--wz-radius: ${radius}; ` +
    // A set customGoogleFont wins over the preset fontFamily; both fall back to
    // the shared system stack. The name is re-sanitized before it reaches CSS.
    `--wz-font: ${customFontStack(t?.customGoogleFont) ?? FONT_STACKS[t?.fontFamily ?? 'system']}; ` +
    `--wz-font-size: ${t?.baseSize ?? 14}px; ` +
    `--wz-gap: ${gap}px; ` +
    `--wz-pad-y: ${padY}px; ` +
    `--wz-pad-x: 10px; ` +
    // §1.9 — min control height for text inputs, selects, and textareas.
    `--wz-input-min-h: ${inputMinH}px; ` +
    `--wz-max-width: ${l?.maxWidth ?? 640}px; ` +
    `--wz-btn-radius: ${btnRadius}; ` +
    `--wz-btn-align: ${btnAlign}; ` +
    `--wz-btn-pad-y: ${btnSize.padY}; ` +
    `--wz-btn-font: ${btnSize.font}; ` +
    `--wz-card-pad: ${density.cardPad}px; ` +
    `--wz-card-shadow: ${cardShadow}; ` +
    `--wz-card-border: ${cardBorder}; ` +
    `--wz-focus: ${primary}; ` +
    `--wz-focus-width: ${l?.focusWidth ?? 2}px; ` +
    // Motion tokens (§2.4). Duration is 0 unless animations is on; the ease is
    // shared by every transition. Both collapse to ~0 under prefers-reduced-
    // motion in the renderer's stylesheet, which preserves transitionend.
    `--wz-dur: ${dur}; ` +
    `--wz-ease: cubic-bezier(0.4, 0, 0.2, 1); ` +
    // §2.6 — frosted-card blur radius; gated to an image backdrop by a host
    // attribute in the renderer, so this value is inert without one.
    `--wz-card-blur: ${cardBlur}px; ` +
    // Page background (§1.1). Gradient/scrim are inert CSS from hex+enum+number;
    // the image path is a re-validated, SDK-built url(). Solid default = today.
    `--wz-page-bg-image: ${bg.image}; ` +
    `--wz-page-bg-size: ${bg.size}; ` +
    `--wz-page-bg-repeat: ${bg.repeat}; ` +
    `--wz-page-scrim: ${bg.scrim}; ` +
    // §3 — block padding around the card; 0 unless a backdrop paints.
    `--wz-page-pad: ${pagePad}; ` +
    `}`
  );
}

/**
 * Shared resets + token-driven helpers imported by every Forms UI component.
 * Kept lean: box model, system font stack, button/anchor resets, and a couple
 * of layout helpers (`.wz-card`, `.wz-grid`). The `:host` also carries the
 * default token values so a bare component (no injected themeVars) still looks
 * right, and neutralizes host-page style bleed with `all: initial`.
 */
export const baseStyles = css`
  :host {
    /* Neutralize inheritable font/color/line-height bleed from the merchant
       page. Custom properties are not affected by 'all', so --wz-* survive.
       The --wz-* token defaults live in themeVars(), always injected as an
       instance <style> that layers over these adopted styles, so they are not
       duplicated here; this block carries only structural host properties. */
    all: initial;
    display: block;
    box-sizing: border-box;
    container-type: inline-size;
    contain: layout style;
    /* The host fills its mount; the card centers within it via its own
       max-width + margin, so --wz-page-bg shows as the area around the card. */
    color: var(--wz-fg);
    font-family: var(--wz-font);
    font-size: var(--wz-font-size);
  }
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }
  a {
    color: inherit;
    text-decoration: none;
  }
  .wz-card {
    background: var(--wz-bg);
    border: 1px solid var(--wz-border);
    border-radius: var(--wz-radius);
    overflow: hidden;
  }
  .wz-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }
`;
