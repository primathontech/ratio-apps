// Zod-free consent-token contract, shared by the checkbox schema (which reuses
// the numeric bounds for its zod refinements) and the storefront SDK render
// (which splices the tokens into anchors). Imports NO zod, so pulling this into
// the widget bundle never drags zod along — mirrors `form-adornments.ts`.

/** Max characters in the inline consent sentence (bounded string, cheap DoS guard). */
export const CONSENT_TEXT_MAX_LENGTH = 500;

/** Max policy links a single consent box may carry (bounded array). */
export const CONSENT_MAX_LINKS = 3;

/** Max characters in a single link's visible anchor text. */
export const CONSENT_LINK_TEXT_MAX_LENGTH = 120;

/** A parsed consent segment: a literal run of text, or a reference to links[index]. */
export type ConsentSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'link'; readonly index: number };

// Exactly `{link}` / `{link1}` / `{link2}` / `{link3}` … — `{link}` and
// `{link1}` both map to links[0], `{link2}` to links[1], and so on. Anchored to
// this token shape so no other brace content in the sentence is treated
// specially. Digits are bounded to two so the parser stays trivially linear.
const CONSENT_TOKEN_RE = /\{link([1-9][0-9]?)?\}/g;

/**
 * Split consent text into an ordered list of literal-text and link-reference
 * segments. Pure and linear; the input is already ≤ CONSENT_TEXT_MAX_LENGTH by
 * schema. A token whose 1-based index exceeds the available links (e.g.
 * `{link3}` with two links) still parses to a link segment — the renderer is
 * responsible for dropping references that have no matching link.
 */
export function parseConsentSegments(text: string): ConsentSegment[] {
  const segments: ConsentSegment[] = [];
  let last = 0;
  CONSENT_TOKEN_RE.lastIndex = 0;
  for (let m = CONSENT_TOKEN_RE.exec(text); m !== null; m = CONSENT_TOKEN_RE.exec(text)) {
    if (m.index > last) segments.push({ kind: 'text', value: text.slice(last, m.index) });
    const oneBased = m[1] === undefined ? 1 : Number(m[1]);
    segments.push({ kind: 'link', index: oneBased - 1 });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) });
  return segments;
}
