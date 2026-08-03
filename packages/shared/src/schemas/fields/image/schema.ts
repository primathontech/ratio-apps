import { z } from 'zod';
import { contentBlockBaseShape, FORM_BLOCK_ALIGNMENTS, httpsAssetUrl } from '../_shared/base';

/** Max-width cap for the image block (§4.15). Absent ⇒ today's full-width
 * (max-width:100%) rendering; sm/md/lg map to a fixed cap in the SDK CSS. */
export const FORM_IMAGE_SIZES = ['sm', 'md', 'lg'] as const;

export type FormImageSize = (typeof FORM_IMAGE_SIZES)[number];

/** image: a display image; reuses the audited https-only asset flow. */
export const imageFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('image'),
  url: httpsAssetUrl,
  alt: z.string().max(255).optional(),
  // §4.15 appearance — all optional so an existing image is unchanged.
  // align: left/center/right via auto margins on the figure. 'left' = today.
  align: z.enum(FORM_BLOCK_ALIGNMENTS).default('left'),
  // size: a max-width cap; absent ⇒ today's full-width rendering.
  size: z.enum(FORM_IMAGE_SIZES).optional(),
  // caption: rendered under the image in a <figcaption> (text node only).
  caption: z.string().max(200).optional(),
  // linkUrl: when set, the image is wrapped in an https-only <a> — the same
  // audited asset-URL posture, re-checked in the SDK before it reaches href.
  linkUrl: httpsAssetUrl.optional(),
});
