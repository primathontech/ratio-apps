import { describe, expect, it } from 'vitest';
import { safeInlineJson } from '../../../../src/core/common/safe-inline-json';

/**
 * The Template SDK prelude is inlined into a `<script>` block via:
 *   window.__TEMPLATE_RATIO_CONFIG__ = ${safeInlineJson(payload)};
 *
 * If the merchant ever puts hostile bytes into one of the prelude fields
 * (apiKey, host, …), the unsafe `</script>` sequence would break out of the
 * tag, U+2028/U+2029 would corrupt the script body, and `<`/`>`/`&` would be
 * HTML-ambiguous in an inline-script context. These golden-file tests pin
 * the escaping contract.
 */
describe('safeInlineJson — XSS golden-file', () => {
  it('escapes `</script>` so it cannot terminate the script tag', () => {
    const out = safeInlineJson({ apiKey: '</script><img src=x>' });
    expect(out).not.toContain('</script>');
    // The `<`, `>`, and `/` (inside a `<`) must all be escaped to \uXXXX.
    expect(out).toContain('\\u003c'); // <
    expect(out).toContain('\\u003e'); // >
    // The raw `<img` payload must not appear unescaped either.
    expect(out).not.toMatch(/<img/);
  });

  it('escapes U+2028 / U+2029 so the inline script is valid JS', () => {
    const payload = { line: 'foo bar', para: 'baz qux' };
    const out = safeInlineJson(payload);
    expect(out).not.toContain(' ');
    expect(out).not.toContain(' ');
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    // Round-trip: the escape sequences are valid JSON → still decodes.
    expect(JSON.parse(out)).toEqual(payload);
  });

  it('escapes raw `&` so the inline script cannot HTML-inject', () => {
    const out = safeInlineJson({ host: 'https://x.com/?a=1&b=2' });
    // No raw ampersand survives — would otherwise allow `&amp;`-style
    // confusion if the surrounding template ever stopped escaping.
    expect(out).not.toContain('&');
    expect(out).toContain('\\u0026');
    // Round-trip still works.
    expect(JSON.parse(out).host).toBe('https://x.com/?a=1&b=2');
  });
});
