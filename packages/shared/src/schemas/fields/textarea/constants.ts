/**
 * Zod-free textarea render/validation constants (Batch-4 field depth).
 *
 * Deliberately Zod-free — mirrors `form-adornments.ts`: the storefront SDK
 * render (`packages/forms-sdk/.../textarea/render.ts`) imports these at runtime
 * and must not pull Zod into the widget bundle. The field `schema.ts` re-imports
 * them for its Zod refinements so the bounds live in exactly one place.
 */

/** Row-count bounds for the auto-grow / min-max-rows display controls. */
export const TEXTAREA_ROW_MIN = 1;
export const TEXTAREA_ROW_MAX = 40;
/** Initial rows when no `minRows` is configured — today's static `rows="4"`. */
export const TEXTAREA_DEFAULT_ROWS = 4;

/** Live-counter unit: character count (today) or word count. */
export const TEXTAREA_COUNTER_UNITS = ['characters', 'words'] as const;
export type TextareaCounterUnit = (typeof TEXTAREA_COUNTER_UNITS)[number];

/**
 * Network-free monospace stack — only system/preinstalled faces, no `@font-face`
 * and no remote URL, so enabling monospace never issues a font request from the
 * storefront (CSP-safe, zero extra bytes). Applied inline by the SDK render.
 */
export const TEXTAREA_MONOSPACE_FONT_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";

/** Approx. line advance (em) used to translate a max-rows clamp into a
 * `max-height` for the auto-grow textarea (graceful, host-CSS-free). */
export const TEXTAREA_ROW_LINE_HEIGHT_EM = 1.6;
