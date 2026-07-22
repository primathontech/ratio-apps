import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderEmail(field: ControlFieldOf<'email'>, ctx: FieldRenderCtx): TemplateResult {
  return ctx.adorn(
    field,
    html`<input
      id=${ctx.id}
      name=${field.key}
      type="email"
      placeholder=${ctx.ph(field, field.placeholder ?? '')}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .value=${String(ctx.values[field.key] ?? '')}
      @input=${ctx.onInput}
    />`,
  );
}
