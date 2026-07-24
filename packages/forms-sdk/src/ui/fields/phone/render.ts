import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderPhone(field: ControlFieldOf<'phone'>, ctx: FieldRenderCtx): TemplateResult {
  return html`<div class="rf-phone">
    <span class="rf-phone-prefix">+91</span>
    <input
      id=${ctx.id}
      name=${field.key}
      type="tel"
      inputmode="numeric"
      maxlength="10"
      placeholder=${ctx.ph(field, field.placeholder ?? '10-digit number')}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .value=${String(ctx.values[field.key] ?? '')}
      @input=${ctx.onInput}
    />
  </div>`;
}
