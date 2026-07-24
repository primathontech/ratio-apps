import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

/**
 * Hidden fields have no visible DOM — `renderField` returns `nothing` before
 * ever reaching the control dispatch, so this is unreachable. It mirrors the
 * text input (the old switch `default` covered hidden) to keep the registry
 * type-complete over every control field type.
 */
export function renderHidden(field: ControlFieldOf<'hidden'>, ctx: FieldRenderCtx): TemplateResult {
  return ctx.adorn(
    field,
    html`<input
      id=${ctx.id}
      name=${field.key}
      type="text"
      placeholder=${ctx.ph(field, field.placeholder ?? '')}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .value=${String(ctx.values[field.key] ?? '')}
      @input=${ctx.onInput}
    />`,
  );
}
