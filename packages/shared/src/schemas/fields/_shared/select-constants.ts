/**
 * Zod-free constants + pure helpers for the SELECT FAMILY (dropdown / radio /
 * multi_select). The storefront SDK (which must stay Zod-free) and the backend
 * submission validators import these at RUNTIME, so this module must NOT import
 * Zod — mirrors `text/constants.ts` and `form-adornments.ts`. The field
 * `schema.ts` modules re-import them for their Zod shapes/refinements.
 */

/**
 * Upper bound on a free-text "Other" submission value (the bounded-string
 * security envelope). Reused by the SDK and the backend validators so the
 * client and server can't drift; aligned with the option value/label cap.
 */
export const FORM_SELECT_OTHER_MAX_LENGTH = 255;

/** Fallback label for the appended "Other" choice when the merchant sets none. */
export const FORM_SELECT_OTHER_DEFAULT_LABEL = 'Other';

/**
 * A stable sentinel the SDK uses as the `<option>`/radio value for the "Other"
 * choice. It never reaches a submission — selecting it flips the field into
 * free-text mode; the SUBMITTED value is the typed string. Chosen to be
 * vanishingly unlikely to collide with a merchant option value.
 */
export const FORM_SELECT_OTHER_SENTINEL = '__rf_other__';

/** radio layout — how the choices flow. `vertical` = today's stacked list. */
export const RADIO_LAYOUTS = ['vertical', 'horizontal', 'grid'] as const;
export type RadioLayout = (typeof RADIO_LAYOUTS)[number];

/** radio visual variant — plain list / segmented buttons / bordered cards. */
export const RADIO_VARIANTS = ['list', 'button', 'card'] as const;
export type RadioVariant = (typeof RADIO_VARIANTS)[number];

/** Grid-column bounds, used only when `layout === 'grid'`. Bounded so the SDK
 * inlines `repeat(N, …)` from a trusted integer, never a user string. */
export const RADIO_MIN_GRID_COLUMNS = 2;
export const RADIO_MAX_GRID_COLUMNS = 4;

/**
 * Is `value` acceptable as a free-text "Other" submission — a non-empty string
 * within the bounded envelope? Shared by the SDK and backend validators so the
 * client and server "Other" verdicts stay identical (client↔server parity).
 */
export function isValidOtherValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= FORM_SELECT_OTHER_MAX_LENGTH
  );
}
