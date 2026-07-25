import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderRadio(field: ControlFieldOf<'radio'>, ctx: FieldRenderCtx): TemplateResult {
  return html`<div
    class="rf-checks"
    id=${ctx.id}
    role="radiogroup"
    aria-labelledby=${`rf-label-${field.key}`}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
  >
    ${field.options.map(
      (opt) =>
        html`<label class="rf-check">
          <input
            type="radio"
            name=${field.key}
            value=${opt.value}
            .checked=${ctx.values[field.key] === opt.value}
            @change=${(e: Event) => ctx.setValue(field.key, (e.target as HTMLInputElement).value)}
          />
          ${opt.label}
        </label>`,
    )}
  </div>`;
}
