// Type-only shapes of the shared form-schema contract (no Zod in the bundle).
import type { FormField } from '@ratio-app/shared';
import type { nothing, TemplateResult } from 'lit';

/**
 * Per-field SDK module contracts (Phase 0 refactor). Each field type owns its
 * `render.ts` (a `renderControl` case) and `validate.ts` (a `validateField`
 * branch) under `./<type>/`; the registry in `./registry.ts` maps type →
 * `{ render, validate }` and `form-renderer.ts` dispatches through it. Behavior
 * is unchanged — this is a pure extraction of the two switch statements.
 */

/** Content blocks (§1.3): display-only, submit no value, carry no label. */
export type ContentBlockField = Extract<
  FormField,
  { type: 'heading' | 'divider' | 'paragraph' | 'image' | 'html' }
>;

/** Every non-content-block (interactive control) field — what renderControl handles. */
export type ControlField = Exclude<FormField, ContentBlockField>;

/** The narrowed member for a single control field type. */
export type ControlFieldOf<K extends ControlField['type']> = Extract<ControlField, { type: K }>;

/**
 * State + bound helpers a control render fn needs, computed per field by
 * `form-renderer.ts` before dispatch. Mirrors the locals the old inline
 * `renderControl` switch closed over.
 */
export interface FieldRenderCtx {
  id: string;
  invalid: string | typeof nothing;
  describedBy: string | typeof nothing;
  values: Record<string, unknown>;
  files: Record<string, File[]>;
  onInput: (e: Event) => void;
  setValue: (key: string, value: unknown) => void;
  ph: (field: FormField, fallback: string) => string;
  adorn: (field: ControlField, control: TemplateResult) => TemplateResult;
  requestUpdate: () => void;
  /** Per-form-instance focus registry for the number field's blur-format /
   * focus-raw display swap (keyed by field.key). Owned by RatioForm so display
   * state can't leak across embeds and is cleared on disconnect. */
  numberFocus: Set<string>;
  /** Per-form-instance ephemeral UI state for the select family (dropdown
   * combobox open/filter state; dropdown/radio/multi_select "Other" free-text
   * mode). Owned by RatioForm (cleared on disconnect) so it never leaks across
   * embeds; keyed by field.key. */
  selectUi: Map<string, SelectUiState>;
}

/**
 * Ephemeral, client-only UI state for a single select-family field. None of it
 * is submitted — it only drives what the widget shows (the SUBMITTED value is
 * always the option value or the typed "Other" text, held in `values`).
 */
export interface SelectUiState {
  /** dropdown combobox: option list is open. */
  open?: boolean;
  /** dropdown combobox: current filter query text. */
  query?: string;
  /** dropdown combobox: highlighted item index in the filtered list. */
  activeIndex?: number;
  /** "Other" free-text mode is active (a value may not be typed yet). */
  otherActive?: boolean;
}

/** Get (creating if absent) the ephemeral select UI state for `key`. */
export function selectUiState(ctx: FieldRenderCtx, key: string): SelectUiState {
  let state = ctx.selectUi.get(key);
  if (!state) {
    state = {};
    ctx.selectUi.set(key, state);
  }
  return state;
}

/** State a client validate fn reads. */
export interface FieldValidateCtx {
  values: Record<string, unknown>;
  files: Record<string, File[]>;
}

export type FieldRenderFn<K extends ControlField['type']> = (
  field: ControlFieldOf<K>,
  ctx: FieldRenderCtx,
) => TemplateResult;

export type FieldValidateFn<K extends ControlField['type']> = (
  field: ControlFieldOf<K>,
  ctx: FieldValidateCtx,
) => string | null;

export interface FieldControlModule<K extends ControlField['type']> {
  render: FieldRenderFn<K>;
  validate: FieldValidateFn<K>;
}

/** Empty-value gate shared by the value-bearing control validators. Re-exported
 * from the Zod-free shared module so the SDK and the backend agree on "empty". */
export { isEmpty } from '@ratio-app/shared/schemas/fields/_shared/empty-constants';
