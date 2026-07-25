import { z } from 'zod';
import { baseFieldShape, httpsAssetUrl } from '../_shared/base';
import {
  CONSENT_LINK_TEXT_MAX_LENGTH,
  CONSENT_MAX_LINKS,
  CONSENT_TEXT_MAX_LENGTH,
} from './constants';

/**
 * One policy link, referenced from `consentText` by a `{link}`/`{link2}`/…
 * token. `text` is the visible anchor label; `url` is https-only (same posture
 * as every other asset/link URL) so nothing dynamic reaches an `<a href>`.
 */
export const consentLinkSchema = z.object({
  text: z.string().min(1, { message: 'link text is required' }).max(CONSENT_LINK_TEXT_MAX_LENGTH),
  url: httpsAssetUrl,
});
export type ConsentLink = z.infer<typeof consentLinkSchema>;

/** checkbox: single consent box; optional inline consent sentence + policy links. */
export const checkboxFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('checkbox'),
  // Inline consent sentence rendered beside the box. May embed positional
  // `{link}`/`{link2}`/`{link3}` tokens that the SDK splices into anchors from
  // `links`. Plain text only (bounded) — the SDK renders it as text nodes plus
  // the spliced anchors, never as HTML.
  consentText: z.string().max(CONSENT_TEXT_MAX_LENGTH).optional(),
  // Bounded set of https-only policy links, referenced positionally by the
  // `consentText` tokens. Absent ⇒ no links.
  links: z.array(consentLinkSchema).max(CONSENT_MAX_LINKS).optional(),
  // Legacy single consent link (pre-`consentText`). Kept optional so forms
  // published before this enrichment stay valid and keep rendering; superseded
  // by `consentText` + `links` when those are set.
  linkUrl: z
    .string()
    .url({ message: 'linkUrl must be a valid URL' })
    .max(2048)
    .refine((url) => url.startsWith('https://'), { message: 'linkUrl must use https://' })
    .optional(),
  linkText: z.string().min(1).max(255).optional(),
});
