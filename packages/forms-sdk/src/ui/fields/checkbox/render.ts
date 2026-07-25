import {
  type ConsentSegment,
  parseConsentSegments,
} from '@ratio-app/shared/schemas/fields/checkbox/constants';
import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

/** A single policy link as carried on the field (type-only; no zod in bundle). */
type ConsentLink = { readonly text: string; readonly url: string };

/**
 * Render one policy link as a safe external anchor. `url` is https-only by
 * schema; we re-check `https:` here as defense in depth so a value that somehow
 * bypassed validation degrades to plain text rather than an arbitrary-scheme
 * href (mirrors the shared https-anchor guard used across link-bearing fields).
 */
function consentAnchor(link: ConsentLink): TemplateResult | string {
  if (!link.url.startsWith('https://')) return link.text;
  return html`<a href=${link.url} target="_blank" rel="noopener noreferrer">${link.text}</a>`;
}

/**
 * Render the inline consent sentence: literal text runs verbatim, and each
 * `{link…}` token as the anchor for its positional link. A token that points
 * past the available links is dropped (renders nothing) rather than leaking the
 * raw `{link3}` marker to the shopper.
 */
function renderConsentText(text: string, links: readonly ConsentLink[]): TemplateResult {
  return html`<span class="rf-consent"
    >${parseConsentSegments(text).map((seg: ConsentSegment) => {
      if (seg.kind === 'text') return seg.value;
      const link = links[seg.index];
      return link ? consentAnchor(link) : nothing;
    })}</span
  >`;
}

export function renderCheckbox(
  field: ControlFieldOf<'checkbox'>,
  ctx: FieldRenderCtx,
): TemplateResult {
  const links = (field.links ?? []) as readonly ConsentLink[];
  // Prefer the inline consent sentence when authored; otherwise fall back to the
  // legacy single link so forms published before this enrichment are unchanged.
  const consent: TemplateResult | typeof nothing = field.consentText
    ? renderConsentText(field.consentText, links)
    : field.linkUrl
      ? html`<a href=${field.linkUrl} target="_blank" rel="noopener noreferrer"
          >${field.linkText ?? field.linkUrl}</a
        >`
      : nothing;

  return html`<label class="rf-check">
    <input
      id=${ctx.id}
      type="checkbox"
      name=${field.key}
      aria-label=${field.label}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .checked=${ctx.values[field.key] === true}
      @change=${(e: Event) => ctx.setValue(field.key, (e.target as HTMLInputElement).checked)}
    />${consent}</label>`;
}
