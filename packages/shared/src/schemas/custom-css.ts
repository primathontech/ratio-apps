import * as csstree from 'css-tree';
import { MAX_FIELD_CSS_LENGTH } from './fields/_shared/base';

export { MAX_FIELD_CSS_LENGTH };

/**
 * Per-field custom CSS sanitizer (the deferred "raw custom CSS — AST allowlist"
 * feature). Merchants author CSS to make a field resemble their storefront; this
 * turns that untrusted string into something safe to inject into the form's
 * shadow root.
 *
 * Defense in depth — the shadow root already isolates the form from the merchant
 * page; this layer additionally guarantees the CSS cannot escape the FIELD:
 *   1. every selector is re-scoped under the field's `[data-field="<key>"]`
 *      wrapper, so it can only touch that field's own subtree (never the submit
 *      button, honeypot, form chrome, `:host`, or the page);
 *   2. the network/exfiltration + shadow-escape vectors are stripped:
 *      `url()` / `@import` / `@font-face` (no external requests), `position:
 *      fixed|sticky` (visually escapes the shadow → clickjack), host/page
 *      selectors, and legacy script vectors (`expression()`, `behavior`,
 *      `-moz-binding`);
 *   3. declarations are allow-listed to visual properties only.
 *
 * NOT imported by the storefront widget — it runs server-side on the embed read
 * path (authoritative) and in the admin for live preview. Keeps `css-tree` out
 * of the widget bundle; the widget only ever injects the already-sanitized text.
 */

// Visual properties a field may set. Deny-by-default: anything not here is
// dropped. `url()`/expression values are stripped separately, so shorthands
// like `background` are safe to allow (a `url()` inside them removes the decl).
const ALLOWED_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'background-attachment',
  'opacity',
  'visibility',
  'display',
  'overflow',
  'overflow-x',
  'overflow-y',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'outline',
  'outline-width',
  'outline-style',
  'outline-color',
  'outline-offset',
  'box-shadow',
  'box-sizing',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-transform',
  'text-indent',
  'text-shadow',
  'text-overflow',
  'white-space',
  'vertical-align',
  'list-style',
  'list-style-type',
  'list-style-position',
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-self',
  'align-content',
  'order',
  'gap',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'transform',
  'transform-origin',
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'transition-delay',
  'filter',
  'backdrop-filter',
  'cursor',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'inset',
  'appearance',
  '-webkit-appearance',
]);

// Value-level functions that reach the network or execute — drop the whole
// declaration if any appears (catches `background:url()`, `filter:url(#x)`, the
// legacy IE `expression()`, `image-set()`/`-webkit-image-set()`, `element()`).
const FORBIDDEN_VALUE_FUNCS = new Set([
  'url',
  'expression',
  'image-set',
  '-webkit-image-set',
  'image',
  'element',
  'cross-fade',
  '-webkit-cross-fade',
  'paint',
]);

// Pseudo-classes/elements that pierce the shadow or target the host/page.
const FORBIDDEN_PSEUDOS = new Set(['host', 'host-context', 'part', 'slotted', 'root']);

// Type selectors that target the page document, not the field.
const FORBIDDEN_TYPES = new Set(['html', 'body', ':root']);

// `position` values that stay contained within the field's box.
const ALLOWED_POSITIONS = new Set([
  'static',
  'relative',
  'absolute',
  'inherit',
  'initial',
  'unset',
  'revert',
]);

export interface CssSanitizeResult {
  /** Sanitized, field-scoped CSS — safe to inject into the shadow root. */
  css: string;
  /** Human-readable notes on what was dropped, for the admin editor. */
  removed: string[];
}

/**
 * css-tree preserves CSS escape sequences VERBATIM in identifier/function/keyword
 * names, but browsers DECODE them (`\75 rl`→`url`, `\66 ixed`→`fixed`,
 * `\68 ost`→`host`). Rather than trust a decoder, we treat any backslash escape
 * in a serialized name/value/selector as hostile — legitimate visual field CSS
 * never needs one. (Closes the whole escape-bypass red-team class at once.)
 */
function hasEscape(generated: string): boolean {
  return generated.includes('\\');
}

/** True if a node's subtree reaches the network or a script vector. */
function nodeHasNetworkVector(node: csstree.CssNode): boolean {
  let bad = false;
  csstree.walk(node, (n) => {
    if (n.type === 'Url') bad = true;
    if (n.type === 'Function' && FORBIDDEN_VALUE_FUNCS.has(n.name.toLowerCase())) bad = true;
    // `Raw` means css-tree couldn't parse it — treat as untrusted.
    if (n.type === 'Raw') bad = true;
  });
  return bad;
}

/** True if a selector pierces the shadow, targets the page, or escapes the field scope. */
function selectorIsForbidden(selector: csstree.CssNode): boolean {
  // Escaped names (`:\68 ost`, `\62 ody`) decode to host/page selectors in-browser.
  if (hasEscape(csstree.generate(selector))) return true;
  // A LEADING combinator (~ + >) would apply relative to the field wrapper once
  // we prefix the scope — `~ .submit` → `[data-field] ~ .submit` reaches the
  // submit button / honeypot / sibling fields OUTSIDE this field. Descendant
  // scoping (a space) is the only safe join.
  if (selector.type === 'Selector') {
    const first = selector.children.first;
    if (first && first.type === 'Combinator') return true;
  }
  let forbidden = false;
  csstree.walk(selector, (node) => {
    // `&` (nesting) resolves back to the scope in ways that can widen it.
    if (node.type === 'NestingSelector') forbidden = true;
    if (
      (node.type === 'PseudoClassSelector' || node.type === 'PseudoElementSelector') &&
      FORBIDDEN_PSEUDOS.has(node.name.toLowerCase())
    ) {
      forbidden = true;
    }
    if (node.type === 'TypeSelector' && FORBIDDEN_TYPES.has(node.name.toLowerCase())) {
      forbidden = true;
    }
  });
  return forbidden;
}

/** True if a declaration's value contains a network/script-reaching or escaped construct. */
function valueIsForbidden(value: csstree.CssNode): boolean {
  if (hasEscape(csstree.generate(value))) return true;
  return nodeHasNetworkVector(value);
}

/** Keep only allow-listed, safe declarations from a rule block. */
function filterDeclarations(block: csstree.Block, removed: string[]): csstree.Declaration[] {
  const kept: csstree.Declaration[] = [];
  block.children.forEach((node) => {
    if (node.type !== 'Declaration') return;
    const prop = node.property.toLowerCase();
    if (!ALLOWED_PROPERTIES.has(prop)) {
      removed.push(`property "${prop}" is not allowed`);
      return;
    }
    if (valueIsForbidden(node.value)) {
      removed.push(`"${prop}" value uses url()/expression() and was dropped`);
      return;
    }
    // `position` is allow-listed by value (fixed/sticky visually escape the
    // shadow root → clickjack). An allow-list is future-proof vs. new keywords;
    // escaped forms (`\66 ixed`) are already caught by valueIsForbidden above.
    if (prop === 'position') {
      const v = csstree.generate(node.value).trim().toLowerCase();
      if (!ALLOWED_POSITIONS.has(v)) {
        removed.push(`position: ${v} is not allowed`);
        return;
      }
    }
    kept.push(node);
  });
  return kept;
}

/** Re-scope a rule's selectors under `scope`, dropping any forbidden selector. */
function scopeSelectors(
  prelude: csstree.Raw | csstree.SelectorList,
  scope: string,
  removed: string[],
): string[] {
  if (prelude.type !== 'SelectorList') return [];
  const scoped: string[] = [];
  prelude.children.forEach((selector) => {
    if (selectorIsForbidden(selector)) {
      removed.push('a selector targeting the host/page was dropped');
      return;
    }
    scoped.push(`${scope} ${csstree.generate(selector)}`);
  });
  return scoped;
}

/**
 * Sanitize `rawCss` and scope every rule under `scope` (e.g.
 * `[data-field="email"]`). Returns safe CSS + a list of what was removed.
 */
export function sanitizeFieldCss(rawCss: string, scope: string): CssSanitizeResult {
  const removed: string[] = [];
  if (!rawCss || !rawCss.trim()) return { css: '', removed };
  if (rawCss.length > MAX_FIELD_CSS_LENGTH) {
    return { css: '', removed: [`CSS exceeds ${MAX_FIELD_CSS_LENGTH} characters`] };
  }

  let ast: csstree.CssNode;
  try {
    // parseValue/parseRulePrelude on so selectors & values are real nodes, not Raw.
    ast = csstree.parse(rawCss, { parseCustomProperty: false });
  } catch {
    return { css: '', removed: ['CSS could not be parsed'] };
  }

  const out: string[] = [];

  const handleRule = (rule: csstree.Rule) => {
    const selectors = scopeSelectors(rule.prelude, scope, removed);
    if (!selectors.length) return;
    const decls = filterDeclarations(rule.block, removed);
    if (!decls.length) return;
    const body = decls.map((d) => `  ${csstree.generate(d)};`).join('\n');
    out.push(`${selectors.join(',\n')} {\n${body}\n}`);
  };

  if (ast.type !== 'StyleSheet') return { css: '', removed: ['CSS could not be parsed'] };
  ast.children.forEach((node) => {
    if (node.type === 'Rule') {
      handleRule(node);
    } else if (node.type === 'Atrule') {
      // Allow only @media (responsive); scope the rules inside it.
      if (node.name.toLowerCase() !== 'media' || !node.block) {
        removed.push(`@${node.name} is not allowed`);
        return;
      }
      // The media PRELUDE is re-emitted verbatim, so it must be validated too —
      // `@media (min-width: url(https://evil))` would otherwise leak a live
      // request through the query itself. css-tree parses media preludes into a
      // different node shape, so also string-check the generated text for any
      // value-function call (a media query never legitimately contains one).
      const preludeText = node.prelude ? csstree.generate(node.prelude) : '';
      if (
        hasEscape(preludeText) ||
        nodeHasNetworkVector(node.prelude ?? { type: 'Raw', value: '' }) ||
        /\b(url|expression|image-set|-webkit-image-set|image|element|paint|cross-fade)\s*\(/i.test(
          preludeText,
        )
      ) {
        removed.push('@media query contains a disallowed construct');
        return;
      }
      const inner: string[] = [];
      node.block.children.forEach((child) => {
        if (child.type !== 'Rule') return;
        const selectors = scopeSelectors(child.prelude, scope, removed);
        if (!selectors.length) return;
        const decls = filterDeclarations(child.block, removed);
        if (!decls.length) return;
        const body = decls.map((d) => `    ${csstree.generate(d)};`).join('\n');
        inner.push(`  ${selectors.join(',\n  ')} {\n${body}\n  }`);
      });
      if (inner.length) {
        out.push(
          `@media ${csstree.generate(node.prelude ?? { type: 'Raw', value: 'all' })} {\n${inner.join('\n')}\n}`,
        );
      }
    } else {
      removed.push('an unsupported CSS construct was dropped');
    }
  });

  return { css: out.join('\n\n'), removed: [...new Set(removed)] };
}
