import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderText(field: ControlFieldOf<'text'>, ctx: FieldRenderCtx): TemplateResult {
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
