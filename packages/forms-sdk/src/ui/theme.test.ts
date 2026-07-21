import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appearanceSchema, FORM_FONT_FAMILIES, type FormAppearance } from '@ratio-app/shared';
import { describe, expect, it } from 'vitest';
import { GOOGLE_FONT_HREF, safeCssUrl, themeVars } from './theme';

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
    expect(css).toContain('--wz-pad-x: 10px');
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
    const used = new Set([...renderer.matchAll(/var\((--wz-[a-z-]+)/g)].map((m) => m[1]));
    const css = themeVars(appearance());
    const emitted = new Set([...css.matchAll(/(--wz-[a-z-]+):/g)].map((m) => m[1]));
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
