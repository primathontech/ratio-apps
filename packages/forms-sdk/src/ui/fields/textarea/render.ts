import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderTextarea(
  field: ControlFieldOf<'textarea'>,
  ctx: FieldRenderCtx,
): TemplateResult {
  return html`<textarea
    id=${ctx.id}
    name=${field.key}
    rows="4"
    placeholder=${ctx.ph(field, field.placeholder ?? '')}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    .value=${String(ctx.values[field.key] ?? '')}
    @input=${ctx.onInput}
  ></textarea>`;
}
