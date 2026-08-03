import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

/** Local calendar date as YYYY-MM-DD (matches the native <input type="date"> value). */
export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export function renderDate(field: ControlFieldOf<'date'>, ctx: FieldRenderCtx): TemplateResult {
  // Client-only default: seed today's date when configured and no value is present.
  // The server never fabricates a value from `defaultTo`.
  const prefill = field.validation?.defaultTo === 'today' ? todayISO() : '';
  return html`<input
    id=${ctx.id}
    name=${field.key}
    type="date"
    min=${field.validation?.min ?? nothing}
    max=${field.validation?.max ?? nothing}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    .value=${String(ctx.values[field.key] ?? prefill)}
    @input=${ctx.onInput}
  />`;
}
