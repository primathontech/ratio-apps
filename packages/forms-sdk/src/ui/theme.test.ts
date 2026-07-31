import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appearanceSchema, FORM_FONT_FAMILIES, type FormAppearance } from '@ratio-app/shared';
import { describe, expect, it } from 'vitest';
import {
  customGoogleFontHref,
  darkThemeVars,
  GOOGLE_FONT_HREF,
  safeCssUrl,
  sanitizeFontName,
  themeVars,
} from './theme';

/** Build a fully-defaulted appearance, optionally overriding a group. */
function appearance(overrides: Record<string, unknown> = {}): FormAppearance {
  return appearanceSchema.parse(overrides);
}

describe('themeVars', () => {
  it('reproduces today’s defaults when given no appearance', () => {
    const css = themeVars(undefined);
    expect(css).toContain('--wz-primary: #0fb3a9');
    expect(css).toContain('--wz-bg: #fff');
    expect(css).toContain('--wz-surface: #fff');
    expect(css).toContain('--wz-fg: #1a1a1a');
    expect(css).toContain('--wz-muted: #6b7280');
    expect(css).toContain('--wz-border: #e5e7eb');
    expect(css).toContain('--wz-error: #c0392b');
    expect(css).toContain('--wz-btn-text: #fff');
    expect(css).toContain('--wz-radius: 10px');
    expect(css).toContain('--wz-font-size: 14px');
    expect(css).toContain('--wz-gap: 14px');
    expect(css).toContain('--wz-pad-y: 8px');
    expect(css).toContain('--wz-pad-x: calc(var(--wz-font-size) * 0.714)');
    expect(css).toContain('--wz-max-width: 640px');
    expect(css).toContain('--wz-btn-radius: var(--wz-radius)');
    expect(css).toContain('--wz-btn-align: flex-start');
    expect(css).toContain('system-ui');
  });

  it('reproduces today’s values from a parsed default appearance', () => {
    // Schema defaults emit #ffffff where the bare fallback uses #fff — the same
    // color. The layout/typography tokens must match today's exactly.
    const css = themeVars(appearance());
    expect(css).toContain('--wz-primary: #0fb3a9');
    expect(css).toContain('--wz-radius: 10px');
    expect(css).toContain('--wz-font-size: 14px');
    expect(css).toContain('--wz-gap: 14px');
    expect(css).toContain('--wz-max-width: 640px');
    expect(css).toContain('--wz-btn-radius: var(--wz-radius)');
  });

  it('maps color tokens from appearance.colors', () => {
    const css = themeVars(appearance({ colors: { primary: '#123456', text: '#222' } }));
    expect(css).toContain('--wz-primary: #123456');
    expect(css).toContain('--wz-focus: #123456');
    expect(css).toContain('--wz-fg: #222');
  });

  it('appends px to numeric radius / baseSize / maxWidth', () => {
    const css = themeVars(
      appearance({ layout: { radius: 4, maxWidth: 480 }, typography: { baseSize: 18 } }),
    );
    expect(css).toContain('--wz-radius: 4px');
    expect(css).toContain('--wz-font-size: 18px');
    expect(css).toContain('--wz-max-width: 480px');
  });

  it('maps density to gap and vertical padding', () => {
    expect(themeVars(appearance({ layout: { density: 'compact' } }))).toContain('--wz-gap: 10px');
    expect(themeVars(appearance({ layout: { density: 'compact' } }))).toContain('--wz-pad-y: 6px');
    expect(themeVars(appearance({ layout: { density: 'spacious' } }))).toContain('--wz-gap: 20px');
    expect(themeVars(appearance({ layout: { density: 'spacious' } }))).toContain(
      '--wz-pad-y: 11px',
    );
  });

  it('maps button shape to a radius', () => {
    expect(themeVars(appearance({ layout: { buttonShape: 'sharp' } }))).toContain(
      '--wz-btn-radius: 0',
    );
    expect(themeVars(appearance({ layout: { buttonShape: 'pill' } }))).toContain(
      '--wz-btn-radius: 999px',
    );
  });

  it('toggles button alignment for full-width buttons', () => {
    expect(themeVars(appearance({ layout: { fullWidthButton: true } }))).toContain(
      '--wz-btn-align: stretch',
    );
  });

  it('maps buttonAlign to the submit align-self', () => {
    expect(themeVars(appearance({ layout: { buttonAlign: 'left' } }))).toContain(
      '--wz-btn-align: flex-start',
    );
    expect(themeVars(appearance({ layout: { buttonAlign: 'center' } }))).toContain(
      '--wz-btn-align: center',
    );
    expect(themeVars(appearance({ layout: { buttonAlign: 'right' } }))).toContain(
      '--wz-btn-align: flex-end',
    );
  });

  it('lets fullWidthButton override buttonAlign (button spans the column)', () => {
    expect(
      themeVars(appearance({ layout: { fullWidthButton: true, buttonAlign: 'center' } })),
    ).toContain('--wz-btn-align: stretch');
  });

  it('defaults the page background to transparent so the host page shows through (§2)', () => {
    // No appearance at all: transparent, not white gutters.
    expect(themeVars(undefined)).toContain('--wz-page-bg: transparent');
    // A raw partial that omits pageBackground stays transparent — nothing was
    // explicitly chosen for the area around the card.
    expect(themeVars({ colors: { background: '#101010' } } as unknown as FormAppearance)).toContain(
      '--wz-page-bg: transparent',
    );
    // A parsed default appearance (pageBackground === card bg) is also
    // transparent: nothing distinct was chosen.
    expect(themeVars(appearance())).toContain('--wz-page-bg: transparent');
  });

  it('paints only an explicitly chosen distinct solid page background (§2)', () => {
    const css = themeVars(
      appearance({ colors: { background: '#ffffff', pageBackground: '#f2f4f7' } }),
    );
    expect(css).toContain('--wz-bg: #ffffff');
    expect(css).toContain('--wz-page-bg: #f2f4f7');
  });

  it('gives the root block padding only when a backdrop paints (§3)', () => {
    // Transparent default ⇒ no padding, so un-themed embeds stay tight.
    expect(themeVars(undefined)).toContain('--wz-page-pad: 0');
    expect(themeVars(appearance())).toContain('--wz-page-pad: 0');
    // A distinct solid page color paints ⇒ block padding to let it breathe.
    expect(
      themeVars(appearance({ colors: { background: '#ffffff', pageBackground: '#f2f4f7' } })),
    ).toContain('--wz-page-pad: clamp(');
    // A gradient paints ⇒ block padding too.
    expect(
      themeVars(
        appearance({
          background: { type: 'gradient', gradientFrom: '#111111', gradientTo: '#222222' },
        }),
      ),
    ).toContain('--wz-page-pad: clamp(');
    // An image paints ⇒ block padding too.
    expect(
      themeVars(
        appearance({ background: { type: 'image', imageUrl: 'https://cdn.example.com/bg.jpg' } }),
      ),
    ).toContain('--wz-page-pad: clamp(');
  });

  it('resolves a font stack from the family enum', () => {
    const css = themeVars(appearance({ typography: { fontFamily: 'inter' } }));
    expect(css).toContain("--wz-font: 'Inter'");
    const serif = themeVars(appearance({ typography: { fontFamily: 'merriweather' } }));
    expect(serif).toContain("'Merriweather'");
  });

  it('lets a custom Google font win over the preset family, over the system fallback', () => {
    const css = themeVars(
      appearance({ typography: { fontFamily: 'inter', customGoogleFont: 'Figtree' } }),
    );
    expect(css).toContain(
      "--wz-font: 'Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    );
    // The preset family is not used when a custom name is present.
    expect(css).not.toContain("--wz-font: 'Inter'");
  });

  it('leaves the font stack on the enum path when no custom font is set', () => {
    const css = themeVars(appearance({ typography: { fontFamily: 'inter' } }));
    expect(css).toContain("--wz-font: 'Inter'");
  });

  it('emits a darkened primary-hover derived from the primary', () => {
    const css = themeVars(appearance({ colors: { primary: '#123456' } }));
    expect(css).toContain('--wz-primary-hover: color-mix(in srgb, #123456 85%, #000)');
  });

  it('emits --wz-subtle derived from surface and text, not a baked light gray', () => {
    // On a dark preset the old baked #f5f5f5 turned status boxes and the +91
    // chip into light blocks; the derived value tracks surface/text instead.
    const css = themeVars(appearance({ colors: { surface: '#111111', text: '#eeeeee' } }));
    expect(css).toContain('--wz-subtle: color-mix(in srgb, var(--wz-surface) 92%, var(--wz-fg))');
    expect(css).not.toContain('#f5f5f5');
  });

  it('defaults the card to a bordered comfortable-padded surface with a small shadow', () => {
    const css = themeVars(undefined);
    expect(css).toContain('--wz-card-pad: 28px');
    expect(css).toContain('--wz-card-border: 1px solid var(--wz-border)');
    expect(css).toContain('--wz-card-shadow: 0 1px 2px');
  });

  it('maps the shadow enum to a box-shadow', () => {
    expect(themeVars(appearance({ layout: { shadow: 'none' } }))).toContain(
      '--wz-card-shadow: none',
    );
    expect(themeVars(appearance({ layout: { shadow: 'md' } }))).toContain(
      '--wz-card-shadow: 0 4px 6px',
    );
  });

  it('drops the card border when cardBorder is false', () => {
    expect(themeVars(appearance({ layout: { cardBorder: false } }))).toContain(
      '--wz-card-border: none',
    );
  });

  it('scales card padding with density', () => {
    expect(themeVars(appearance({ layout: { density: 'compact' } }))).toContain(
      '--wz-card-pad: 20px',
    );
    expect(themeVars(appearance({ layout: { density: 'spacious' } }))).toContain(
      '--wz-card-pad: 36px',
    );
  });

  it('emits button-size tokens; md reproduces today’s button (§1.5)', () => {
    const md = themeVars(appearance());
    expect(md).toContain('--wz-btn-pad-y: calc(var(--wz-pad-y) + 2px)');
    expect(md).toContain('--wz-btn-font: var(--wz-font-size)');
    const sm = themeVars(appearance({ layout: { buttonSize: 'sm' } }));
    expect(sm).toContain('--wz-btn-pad-y: var(--wz-pad-y)');
    expect(sm).toContain('--wz-btn-font: calc(var(--wz-font-size) - 1px)');
    const lg = themeVars(appearance({ layout: { buttonSize: 'lg' } }));
    expect(lg).toContain('--wz-btn-pad-y: calc(var(--wz-pad-y) + 6px)');
  });

  it('maps inputSize to the font-relative min-height token; md = 40px at the 14px base (§1.9)', () => {
    expect(themeVars(appearance())).toContain('--wz-input-min-h: 2.86em');
    expect(themeVars(appearance({ layout: { inputSize: 'sm' } }))).toContain(
      '--wz-input-min-h: 2.43em',
    );
    expect(themeVars(appearance({ layout: { inputSize: 'lg' } }))).toContain(
      '--wz-input-min-h: 3.43em',
    );
  });

  it('lets explicit fieldGap / inputPadY override the density preset (§1.6)', () => {
    // Density spacious would give gap 20 / padY 11; the explicit values win.
    const css = themeVars(
      appearance({ layout: { density: 'spacious', fieldGap: 8, inputPadY: 5 } }),
    );
    expect(css).toContain('--wz-gap: 8px');
    expect(css).toContain('--wz-pad-y: 5px');
  });

  it('falls back to the density gap / padY when no explicit spacing is set (§1.6)', () => {
    const css = themeVars(appearance({ layout: { density: 'compact' } }));
    expect(css).toContain('--wz-gap: 10px');
    expect(css).toContain('--wz-pad-y: 6px');
  });

  it('emits the focus width token; default 2 reproduces today (§1.7)', () => {
    expect(themeVars(appearance())).toContain('--wz-focus-width: 2px');
    expect(themeVars(appearance({ layout: { focusWidth: 4 } }))).toContain('--wz-focus-width: 4px');
  });

  it('keeps the motion token at 0 by default and lifts it when animations are on (§2.4)', () => {
    // Off by default = today: no transitions. The renderer additionally
    // collapses this under prefers-reduced-motion, so the OS setting wins.
    expect(themeVars(appearance())).toContain('--wz-dur: 0s');
    expect(themeVars(appearance({ layout: { animations: true } }))).toContain('--wz-dur: 0.12s');
  });

  it('emits the motion role tokens (fast < normal < slow); normal mirrors --wz-dur (§1.8)', () => {
    // Off by default = today: every role duration is 0s, like --wz-dur.
    const off = themeVars(appearance());
    expect(off).toContain('--wz-dur-fast: 0s');
    expect(off).toContain('--wz-dur-normal: 0s');
    expect(off).toContain('--wz-dur-slow: 0s');
    // Animations on, default speed: normal reproduces --wz-dur (0.12s), fast is
    // half and slow is double, so fast < normal < slow.
    const on = themeVars(appearance({ layout: { animations: true } }));
    expect(on).toContain('--wz-dur-fast: 0.06s');
    expect(on).toContain('--wz-dur-normal: 0.12s');
    expect(on).toContain('--wz-dur-slow: 0.24s');
    // The chosen motionSpeed scales the whole set: 'fast' halves every role,
    // and --wz-dur-normal still tracks --wz-dur.
    const fast = themeVars(appearance({ layout: { animations: true, motionSpeed: 'fast' } }));
    expect(fast).toContain('--wz-dur: 0.06s');
    expect(fast).toContain('--wz-dur-fast: 0.03s');
    expect(fast).toContain('--wz-dur-normal: 0.06s');
    expect(fast).toContain('--wz-dur-slow: 0.12s');
  });
});

describe('themeVars page background (§1.1)', () => {
  it('solid default emits an inert (no-op) background — today’s flat page', () => {
    const css = themeVars(appearance());
    expect(css).toContain('--wz-page-bg-image: none');
    expect(css).toContain('--wz-page-scrim: transparent');
    expect(css).toContain('--wz-page-bg-size: auto');
    expect(css).toContain('--wz-page-bg-repeat: no-repeat');
  });

  it('composes a linear gradient string from hex + direction (no url)', () => {
    const css = themeVars(
      appearance({
        background: {
          type: 'gradient',
          gradientFrom: '#111111',
          gradientTo: '#222222',
          gradientDir: 'to right',
        },
      }),
    );
    expect(css).toContain('--wz-page-bg-image: linear-gradient(to right, #111111, #222222)');
    expect(css).not.toContain('url(');
  });

  it('composes a radial gradient for the radial direction', () => {
    const css = themeVars(
      appearance({
        background: {
          type: 'gradient',
          gradientFrom: '#111111',
          gradientTo: '#222222',
          gradientDir: 'radial',
        },
      }),
    );
    expect(css).toContain('--wz-page-bg-image: radial-gradient(circle, #111111, #222222)');
  });

  it('falls back to solid when a gradient is missing its colors', () => {
    const css = themeVars(appearance({ background: { type: 'gradient' } }));
    expect(css).toContain('--wz-page-bg-image: none');
  });

  it('builds a re-validated url() for an image and maps fit to size/repeat', () => {
    const css = themeVars(
      appearance({
        background: {
          type: 'image',
          imageUrl: 'https://cdn.example.com/bg.jpg',
          imageFit: 'contain',
        },
      }),
    );
    expect(css).toContain('--wz-page-bg-image: url("https://cdn.example.com/bg.jpg")');
    expect(css).toContain('--wz-page-bg-size: contain');
    expect(css).toContain('--wz-page-bg-repeat: no-repeat');
  });

  it('maps repeat fit to background-repeat', () => {
    const css = themeVars(
      appearance({
        background: {
          type: 'image',
          imageUrl: 'https://cdn.example.com/tile.png',
          imageFit: 'repeat',
        },
      }),
    );
    expect(css).toContain('--wz-page-bg-repeat: repeat');
    expect(css).toContain('--wz-page-bg-size: auto');
  });

  it('clamps the scrim to a contrast floor (0.35) when an image is set', () => {
    const css = themeVars(
      appearance({
        background: { type: 'image', imageUrl: 'https://cdn.example.com/bg.jpg', scrim: 0 },
      }),
    );
    expect(css).toContain('--wz-page-scrim: linear-gradient(rgba(0,0,0,0.35),rgba(0,0,0,0.35))');
  });

  it('honors a higher explicit scrim over an image', () => {
    const css = themeVars(
      appearance({
        background: { type: 'image', imageUrl: 'https://cdn.example.com/bg.jpg', scrim: 0.6 },
      }),
    );
    expect(css).toContain('--wz-page-scrim: linear-gradient(rgba(0,0,0,0.6),rgba(0,0,0,0.6))');
  });
});

describe('darkThemeVars (dark scheme color overrides)', () => {
  it('returns only color declarations, with no :host wrapper (the renderer wraps them)', () => {
    const css = darkThemeVars(appearance());
    expect(css).not.toContain(':host');
    expect(css).not.toContain('{');
    expect(css.trim().startsWith('--wz-primary:')).toBe(true);
  });

  it('falls back to the LIGHT token value for every unset dark token', () => {
    // colorsDark absent entirely ⇒ every dark token mirrors the light color.
    const css = darkThemeVars(
      appearance({
        colors: {
          primary: '#123456',
          background: '#0b0b0b',
          surface: '#151515',
          text: '#eeeeee',
          muted: '#999999',
          border: '#333333',
          error: '#ff8800',
          buttonText: '#ffffff',
        },
      }),
    );
    expect(css).toContain('--wz-primary: #123456');
    expect(css).toContain('--wz-bg: #0b0b0b');
    expect(css).toContain('--wz-surface: #151515');
    expect(css).toContain('--wz-fg: #eeeeee');
    expect(css).toContain('--wz-muted: #999999');
    expect(css).toContain('--wz-border: #333333');
    expect(css).toContain('--wz-error: #ff8800');
    expect(css).toContain('--wz-btn-text: #ffffff');
    // Derived tokens track the (light-sourced) values via the same formulas.
    expect(css).toContain('--wz-primary-hover: color-mix(in srgb, #123456 85%, #000)');
    expect(css).toContain('--wz-focus: #123456');
  });

  it('reproduces today’s baked defaults when no colors are set at all', () => {
    const css = darkThemeVars(undefined);
    expect(css).toContain('--wz-primary: #0fb3a9');
    expect(css).toContain('--wz-bg: #fff');
    expect(css).toContain('--wz-surface: #fff');
    expect(css).toContain('--wz-fg: #1a1a1a');
    expect(css).toContain('--wz-muted: #6b7280');
    expect(css).toContain('--wz-border: #e5e7eb');
    expect(css).toContain('--wz-error: #c0392b');
    expect(css).toContain('--wz-btn-text: #fff');
  });

  it('lets explicit colorsDark tokens win over the light values', () => {
    const css = darkThemeVars(
      appearance({
        colors: { primary: '#0fb3a9', background: '#ffffff', text: '#1a1a1a' },
        colorsDark: { background: '#0b0b0b', text: '#f5f5f5', primary: '#7dd3fc' },
      }),
    );
    expect(css).toContain('--wz-bg: #0b0b0b');
    expect(css).toContain('--wz-fg: #f5f5f5');
    expect(css).toContain('--wz-primary: #7dd3fc');
    // primary-derived tokens follow the dark primary.
    expect(css).toContain('--wz-primary-hover: color-mix(in srgb, #7dd3fc 85%, #000)');
    expect(css).toContain('--wz-focus: #7dd3fc');
  });

  it('mixes per-token: an overridden token uses the dark value, an absent one the light value', () => {
    // Only background is overridden for dark; surface/text stay on the light color.
    const css = darkThemeVars(
      appearance({
        colors: { background: '#ffffff', surface: '#fafafa', text: '#111111' },
        colorsDark: { background: '#101010' },
      }),
    );
    expect(css).toContain('--wz-bg: #101010'); // dark override wins
    expect(css).toContain('--wz-surface: #fafafa'); // falls back to light
    expect(css).toContain('--wz-fg: #111111'); // falls back to light
  });

  it('keeps semantic colors deriving from primary/muted unless overridden for dark', () => {
    const base = darkThemeVars(appearance({ colors: { primary: '#123456', muted: '#999999' } }));
    // success/link default to primary, placeholder to muted (same as light).
    expect(base).toContain('--wz-success: #123456');
    expect(base).toContain('--wz-link: #123456');
    expect(base).toContain('--wz-placeholder: #999999');
    // An explicit dark override for a semantic token wins.
    const over = darkThemeVars(
      appearance({ colors: { primary: '#123456' }, colorsDark: { link: '#7dd3fc' } }),
    );
    expect(over).toContain('--wz-link: #7dd3fc');
  });

  it('recolors only the solid page gutter, mirroring the light §2 rule on the dark colors', () => {
    // A distinct dark pageBackground (≠ dark card bg) paints; otherwise transparent.
    const painted = darkThemeVars(
      appearance({ colorsDark: { background: '#0b0b0b', pageBackground: '#050505' } }),
    );
    expect(painted).toContain('--wz-page-bg: #050505');
    // Equal to the dark card bg ⇒ transparent (nothing distinct chosen).
    const flat = darkThemeVars(
      appearance({ colorsDark: { background: '#0b0b0b', pageBackground: '#0b0b0b' } }),
    );
    expect(flat).toContain('--wz-page-bg: transparent');
  });

  it('only re-declares COLOR tokens — no non-color tokens leak in', () => {
    const css = darkThemeVars(appearance({ layout: { radius: 4, density: 'spacious' } }));
    // Spacing/radius/motion/size tokens must stay inherited from the light block.
    expect(css).not.toContain('--wz-radius');
    expect(css).not.toContain('--wz-gap');
    expect(css).not.toContain('--wz-card-pad');
    expect(css).not.toContain('--wz-dur');
    expect(css).not.toContain('--wz-input-min-h');
    expect(css).not.toContain('--wz-font');
  });
});

describe('safeCssUrl (§1.1 security)', () => {
  it('wraps a clean https asset URL as a CSS url()', () => {
    expect(safeCssUrl('https://cdn.example.com/a.jpg')).toBe(
      'url("https://cdn.example.com/a.jpg")',
    );
  });

  it('rejects non-https, missing, and breakout-character URLs', () => {
    expect(safeCssUrl(undefined)).toBeNull();
    expect(safeCssUrl('http://cdn.example.com/a.jpg')).toBeNull();
    // A closing paren / comma / whitespace / quote could break out of url(...).
    expect(safeCssUrl('https://x/a.jpg)')).toBeNull();
    expect(safeCssUrl('https://x/a,b.jpg')).toBeNull();
    expect(safeCssUrl('https://x/a b.jpg')).toBeNull();
    expect(safeCssUrl('https://x/a".jpg')).toBeNull();
  });
});

describe('token audit', () => {
  // Guards against the class of bug where the renderer references a var(--wz-*)
  // that themeVars never emits, so it silently falls back to the baked light
  // literal on dark/branded presets (the --wz-subtle regression).
  it('emits every var(--wz-*) the renderer references', () => {
    const renderer = readFileSync(resolve(process.cwd(), 'src/ui/form-renderer.ts'), 'utf8');
    const used = new Set([...renderer.matchAll(/var\((--wz-[a-z0-9-]+)/g)].map((m) => m[1]));
    const css = themeVars(appearance());
    const emitted = new Set([...css.matchAll(/(--wz-[a-z0-9-]+):/g)].map((m) => m[1]));
    const missing = [...used].filter((token) => !emitted.has(token));
    expect(missing).toEqual([]);
  });
});

describe('GOOGLE_FONT_HREF', () => {
  it('has an https Google Fonts URL for every non-system family', () => {
    for (const family of FORM_FONT_FAMILIES) {
      if (family === 'system') continue;
      const href = GOOGLE_FONT_HREF[family];
      expect(href).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=/);
    }
  });

  it('does not carry an entry for the system stack', () => {
    expect((GOOGLE_FONT_HREF as Record<string, string>).system).toBeUndefined();
  });
});

describe('customGoogleFontHref', () => {
  it('builds an https Google Fonts URL with spaces encoded as +', () => {
    expect(customGoogleFontHref('Figtree')).toBe(
      'https://fonts.googleapis.com/css2?family=Figtree&display=swap',
    );
    expect(customGoogleFontHref('Source Serif 4')).toBe(
      'https://fonts.googleapis.com/css2?family=Source+Serif+4&display=swap',
    );
  });

  it('re-sanitizes at the SDK layer so no injection survives (defense in depth)', () => {
    // Anything outside [A-Za-z0-9 -] is stripped before the URL is composed.
    expect(customGoogleFontHref('Bad"; url(x)')).toBe(
      'https://fonts.googleapis.com/css2?family=Bad+urlx&display=swap',
    );
    expect(customGoogleFontHref('')).toBeNull();
    expect(customGoogleFontHref(undefined)).toBeNull();
    expect(customGoogleFontHref('"();{}')).toBeNull();
  });
});

describe('sanitizeFontName', () => {
  it('keeps plain names and strips unsafe characters', () => {
    expect(sanitizeFontName('Figtree')).toBe('Figtree');
    expect(sanitizeFontName('PT Sans-Caption')).toBe('PT Sans-Caption');
    expect(sanitizeFontName('Bad"; url(x)')).toBe('Bad urlx');
    expect(sanitizeFontName('  spaced   out  ')).toBe('spaced out');
    expect(sanitizeFontName('')).toBeNull();
    expect(sanitizeFontName('"();{}')).toBeNull();
  });
});

describe('themeVars Batch 5 (visual-payoff theming)', () => {
  it('emits the new tokens at today’s values for an un-themed form', () => {
    const css = themeVars(appearance());
    // Semantic colors default to primary/muted derivations.
    expect(css).toContain('--wz-success: #0fb3a9');
    expect(css).toContain('--wz-success-bg: color-mix(in srgb, #0fb3a9 8%, var(--wz-bg))');
    expect(css).toContain('--wz-link: #0fb3a9');
    expect(css).toContain('--wz-placeholder: #6b7280');
    // Button fill tokens — solid defaults reproduce today.
    expect(css).toContain('--wz-btn-bg: var(--wz-primary)');
    expect(css).toContain('--wz-btn-fg: var(--wz-btn-text)');
    expect(css).toContain('--wz-btn-bw: 0');
    // Type-scale role tokens fall back to today’s additive sizes (base 14).
    expect(css).toContain('--wz-fs-title: 20px');
    expect(css).toContain('--wz-fs-h2: 18px');
    expect(css).toContain('--wz-fs-h3: 16px');
    // Font roles + line-heights default to inherit / normal.
    expect(css).toContain('--wz-font-heading: var(--wz-font)');
    expect(css).toContain('--wz-font-body: var(--wz-font)');
    expect(css).toContain('--wz-lh-body: normal');
    expect(css).toContain('--wz-lh-heading: normal');
    // Focus offset literal (2px) + no-op bg filter.
    expect(css).toContain('--wz-focus-offset: 2px');
    expect(css).toContain('--wz-bg-filter: none');
    // Easing unchanged.
    expect(css).toContain('--wz-ease: cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('maps semantic colors when set', () => {
    const css = themeVars(
      appearance({ colors: { success: '#067647', link: '#2563eb', placeholder: '#9ca3af' } }),
    );
    expect(css).toContain('--wz-success: #067647');
    expect(css).toContain('--wz-link: #2563eb');
    expect(css).toContain('--wz-placeholder: #9ca3af');
  });

  it('wires inputPadX to --wz-pad-x as a font-relative calc; default = 10px at the 14px base', () => {
    expect(themeVars(appearance())).toContain('--wz-pad-x: calc(var(--wz-font-size) * 0.714)');
    expect(themeVars(appearance({ layout: { inputPadX: 16 } }))).toContain(
      '--wz-pad-x: calc(var(--wz-font-size) * 1.143)',
    );
  });

  it('lets an explicit cardPadding override the density preset (fixes the bug)', () => {
    // Density spacious would give 36px; the explicit override must win.
    const css = themeVars(appearance({ layout: { density: 'spacious', cardPadding: 12 } }));
    expect(css).toContain('--wz-card-pad: 12px');
    // Absent ⇒ density still supplies the value.
    expect(themeVars(appearance({ layout: { density: 'spacious' } }))).toContain(
      '--wz-card-pad: 36px',
    );
  });

  it('drops the max-width cap under fluidWidth', () => {
    expect(themeVars(appearance({ layout: { fluidWidth: true } }))).toContain(
      '--wz-max-width: none',
    );
    expect(themeVars(appearance({ layout: { maxWidth: 480 } }))).toContain('--wz-max-width: 480px');
  });

  it('emits a status-max-width that matches the form width with a readable floor (never `none` into min())', () => {
    // Default: the confirmation card matches the form's own width so it doesn't
    // shrink to a narrow column, with a 26rem floor for very narrow forms.
    expect(themeVars(appearance())).toContain('--wz-status-max-width: max(26rem, 640px)');
    expect(themeVars(appearance({ layout: { maxWidth: 480 } }))).toContain(
      '--wz-status-max-width: max(26rem, 480px)',
    );
    // Under fluidWidth --wz-max-width becomes `none`; the status card fills like
    // the form itself (must never emit the invalid min(26rem, none)).
    const fluid = themeVars(appearance({ layout: { fluidWidth: true } }));
    expect(fluid).toContain('--wz-status-max-width: none');
    expect(fluid).not.toContain('--wz-status-max-width: min(26rem, none)');
  });

  it('maps focusOffset to the offset token', () => {
    expect(themeVars(appearance({ layout: { focusOffset: 0 } }))).toContain(
      '--wz-focus-offset: 0px',
    );
    expect(themeVars(appearance({ layout: { focusOffset: 6 } }))).toContain(
      '--wz-focus-offset: 6px',
    );
  });

  it('scales motion duration by speed and maps easing to a fixed curve', () => {
    // Animations off keeps duration at 0 regardless of speed.
    expect(themeVars(appearance({ layout: { motionSpeed: 'fast' } }))).toContain('--wz-dur: 0s');
    expect(themeVars(appearance({ layout: { animations: true, motionSpeed: 'slow' } }))).toContain(
      '--wz-dur: 0.24s',
    );
    expect(themeVars(appearance({ layout: { animations: true, motionSpeed: 'fast' } }))).toContain(
      '--wz-dur: 0.06s',
    );
    expect(themeVars(appearance({ layout: { easing: 'spring' } }))).toContain(
      '--wz-ease: cubic-bezier(0.34, 1.56, 0.64, 1)',
    );
  });

  it('computes the type scale from base·rⁿ when a ratio is set', () => {
    // major-third (1.25) over base 14: h3=17.5→18, h2=21.9→22, title=27.3→27.
    const css = themeVars(appearance({ typography: { scaleRatio: 'major-third' } }));
    expect(css).toContain('--wz-fs-h3: 18px');
    expect(css).toContain('--wz-fs-h2: 22px');
    expect(css).toContain('--wz-fs-title: 27px');
  });

  it('resolves heading/body font roles from the pairing families', () => {
    const css = themeVars(
      appearance({ typography: { headingFont: 'poppins', bodyFont: 'merriweather' } }),
    );
    expect(css).toContain("--wz-font-heading: 'Poppins'");
    expect(css).toContain("--wz-font-body: 'Merriweather'");
  });

  it('composes an image-layer filter from brightness/blur/grayscale', () => {
    const css = themeVars(
      appearance({ background: { imageBrightness: 0.8, imageBlur: 4, imageGrayscale: 0.5 } }),
    );
    expect(css).toContain('--wz-bg-filter: brightness(0.8) blur(4px) grayscale(0.5)');
  });

  it('maps the extended shadow scale (lg/xl)', () => {
    expect(themeVars(appearance({ layout: { shadow: 'lg' } }))).toContain(
      '--wz-card-shadow: 0 10px 15px',
    );
    expect(themeVars(appearance({ layout: { shadow: 'xl' } }))).toContain(
      '--wz-card-shadow: 0 20px 25px',
    );
  });

  // ── Batch 6 branding tokens ──────────────────────────────────
  it('defaults the logo/cover branding tokens to today’s values', () => {
    const css = themeVars(appearance());
    expect(css).toContain('--wz-logo-max-h: 56px');
    expect(css).toContain('--wz-cover-max-h: 180px');
    expect(css).toContain('--wz-cover-overlay: rgba(0, 0, 0, 0)');
    expect(css).toContain('--wz-cover-filter: none');
  });

  it('maps the logo size enum to its max-height (sm/md/lg)', () => {
    expect(themeVars(appearance({ logo: { url: 'https://cdn/x.png', size: 'sm' } }))).toContain(
      '--wz-logo-max-h: 40px',
    );
    expect(themeVars(appearance({ logo: { url: 'https://cdn/x.png', size: 'lg' } }))).toContain(
      '--wz-logo-max-h: 80px',
    );
  });

  it('composes cover height, overlay opacity, and blur from bounded numbers', () => {
    const css = themeVars(
      appearance({
        cover: { url: 'https://cdn/c.jpg', height: 240, overlay: 0.4, blur: 6 },
      }),
    );
    expect(css).toContain('--wz-cover-max-h: 240px');
    expect(css).toContain('--wz-cover-overlay: rgba(0, 0, 0, 0.4)');
    expect(css).toContain('--wz-cover-filter: blur(6px)');
  });
});

describe('per-state color tokens (B3)', () => {
  it('emits the four state tokens at today’s exact color-mix formulas (default)', () => {
    const css = themeVars(appearance());
    // Primary-derived: focus glow ring (55%) + soft selected/hover fill (12%).
    expect(css).toContain('--wz-primary-active: color-mix(in srgb, #0fb3a9 55%, transparent)');
    expect(css).toContain('--wz-primary-soft: color-mix(in srgb, #0fb3a9 12%, transparent)');
    // Error-derived: soft error fill (12%) + invalid ring (22%).
    expect(css).toContain('--wz-error-bg: color-mix(in srgb, #c0392b 12%, transparent)');
    expect(css).toContain('--wz-error-ring: color-mix(in srgb, #c0392b 22%, transparent)');
  });

  it('recomputes the state tokens from a custom primary / error', () => {
    const css = themeVars(appearance({ colors: { primary: '#123456', error: '#990000' } }));
    expect(css).toContain('--wz-primary-active: color-mix(in srgb, #123456 55%, transparent)');
    expect(css).toContain('--wz-primary-soft: color-mix(in srgb, #123456 12%, transparent)');
    expect(css).toContain('--wz-error-bg: color-mix(in srgb, #990000 12%, transparent)');
    expect(css).toContain('--wz-error-ring: color-mix(in srgb, #990000 22%, transparent)');
  });

  it('re-declares the state tokens under the dark scheme so they track the dark hue', () => {
    const css = darkThemeVars(appearance({ colorsDark: { primary: '#7dd3fc', error: '#f87171' } }));
    expect(css).toContain('--wz-primary-active: color-mix(in srgb, #7dd3fc 55%, transparent)');
    expect(css).toContain('--wz-primary-soft: color-mix(in srgb, #7dd3fc 12%, transparent)');
    expect(css).toContain('--wz-error-bg: color-mix(in srgb, #f87171 12%, transparent)');
    expect(css).toContain('--wz-error-ring: color-mix(in srgb, #f87171 22%, transparent)');
  });

  it('the renderer consumes the tokens instead of inline color-mix for these states', () => {
    const renderer = readFileSync(resolve(process.cwd(), 'src/ui/form-renderer.ts'), 'utf8');
    // The error/focus rules now reference the named tokens…
    expect(renderer).toContain('box-shadow: 0 0 0 4px var(--wz-primary-active);');
    expect(renderer).toContain('box-shadow: 0 0 0 3px var(--wz-error-ring);');
    expect(renderer).toContain('background: var(--wz-primary-soft);');
    expect(renderer).toContain('background: var(--wz-error-bg);');
    // …and the hoisted inline mixes are gone from the renderer.
    expect(renderer).not.toContain('color-mix(in srgb, var(--wz-focus) 55%, transparent)');
    expect(renderer).not.toContain('color-mix(in srgb, var(--wz-error) 22%, transparent)');
    expect(renderer).not.toContain('color-mix(in srgb, var(--wz-primary) 12%, transparent)');
    expect(renderer).not.toContain('color-mix(in srgb, var(--wz-error) 12%, transparent)');
  });
});
