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
  { type: 'heading' | 'divider' | 'paragraph' | 'image' }
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
  files: Record<string, File | null>;
  onInput: (e: Event) => void;
  setValue: (key: string, value: unknown) => void;
  ph: (field: FormField, fallback: string) => string;
  adorn: (field: ControlField, control: TemplateResult) => TemplateResult;
  requestUpdate: () => void;
}

/** State a client validate fn reads. */
export interface FieldValidateCtx {
  values: Record<string, unknown>;
  files: Record<string, File | null>;
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

/** Empty-value gate shared by the value-bearing control validators. */
export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}
