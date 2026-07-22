import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderDate(field: ControlFieldOf<'date'>, ctx: FieldRenderCtx): TemplateResult {
  return html`<input
    id=${ctx.id}
    name=${field.key}
    type="date"
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    .value=${String(ctx.values[field.key] ?? '')}
    @input=${ctx.onInput}
  />`;
}
