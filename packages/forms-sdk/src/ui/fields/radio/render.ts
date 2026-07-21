import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderRadio(field: ControlFieldOf<'radio'>, ctx: FieldRenderCtx): TemplateResult {
  return html`<div class="rf-checks" id=${ctx.id} role="radiogroup">
    ${field.options.map(
      (opt) =>
        html`<label class="rf-check">
          <input
            type="radio"
            name=${field.key}
            value=${opt}
            .checked=${ctx.values[field.key] === opt}
            @change=${(e: Event) => ctx.setValue(field.key, (e.target as HTMLInputElement).value)}
          />
          ${opt}
        </label>`,
    )}
  </div>`;
}
