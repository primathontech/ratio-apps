/**
 * XSS-safe serializer for JSON payloads inlined into `<script>` blocks (e.g.
 * the SDK prelude `window.__TEMPLATE_RATIO_CONFIG__ = {...}`).
 *
 * Standard `JSON.stringify` is NOT safe inside `<script>` because:
 *   1. `</script>` inside a string literal terminates the script tag.
 *   2. U+2028 / U+2029 are valid JSON whitespace but illegal in JavaScript
 *      string literals — they break parsing in older engines / linters.
 *   3. HTML-ambiguous characters (`<`, `>`, `&`) can be exploited to inject
 *      HTML if the surrounding template ever stops escaping.
 *
 * This helper escapes those characters into `\uXXXX` sequences so the output
 * is safe in both `<script>` blocks and inline `text/javascript`. Reused by
 * the _template SDK service in Phase D.
 */
// Escape: `<`, `>`, `&`, U+2028 (LINE SEPARATOR), U+2029 (PARAGRAPH SEPARATOR).
// Constructed via `new RegExp` so the unicode escapes survive — raw codepoints
// in a regex literal would be parsed as line terminators by the grammar.
const ESCAPE_RE = /[<>&\u2028\u2029]/g;

export function safeInlineJson(payload: unknown): string {
  return JSON.stringify(payload).replace(
    ESCAPE_RE,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
