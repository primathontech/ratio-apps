import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderDropdown(
  field: ControlFieldOf<'dropdown'>,
  ctx: FieldRenderCtx,
): TemplateResult {
  return html`<select
    id=${ctx.id}
    name=${field.key}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    @change=${(e: Event) => ctx.setValue(field.key, (e.target as HTMLSelectElement).value)}
  >
    <option value="">${field.placeholder ?? 'Select...'}</option>
    ${field.options.map(
      (opt) =>
        html`<option value=${opt} ?selected=${ctx.values[field.key] === opt}>${opt}</option>`,
    )}
  </select>`;
}
