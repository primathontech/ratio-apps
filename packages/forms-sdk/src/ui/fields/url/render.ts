import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderUrl(field: ControlFieldOf<'url'>, ctx: FieldRenderCtx): TemplateResult {
  return ctx.adorn(
    field,
    html`<input
      id=${ctx.id}
      name=${field.key}
      type="url"
      inputmode="url"
      placeholder=${ctx.ph(field, field.placeholder ?? 'https://')}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .value=${String(ctx.values[field.key] ?? '')}
      @input=${ctx.onInput}
    />`,
  );
}
