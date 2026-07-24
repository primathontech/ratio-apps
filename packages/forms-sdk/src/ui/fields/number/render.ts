import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderNumber(field: ControlFieldOf<'number'>, ctx: FieldRenderCtx): TemplateResult {
  return ctx.adorn(
    field,
    html`<input
      id=${ctx.id}
      name=${field.key}
      type="number"
      inputmode=${field.validation?.integer ? 'numeric' : 'decimal'}
      step=${field.validation?.step ?? (field.validation?.integer ? 1 : 'any')}
      min=${field.validation?.min ?? nothing}
      max=${field.validation?.max ?? nothing}
      placeholder=${ctx.ph(field, field.placeholder ?? '')}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .value=${String(ctx.values[field.key] ?? '')}
      @input=${ctx.onInput}
    />`,
  );
}
