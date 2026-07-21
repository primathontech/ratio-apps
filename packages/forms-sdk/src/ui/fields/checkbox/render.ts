import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderCheckbox(
  field: ControlFieldOf<'checkbox'>,
  ctx: FieldRenderCtx,
): TemplateResult {
  return html`<label class="rf-check">
    <input
      id=${ctx.id}
      type="checkbox"
      name=${field.key}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .checked=${ctx.values[field.key] === true}
      @change=${(e: Event) => ctx.setValue(field.key, (e.target as HTMLInputElement).checked)}
    />
    ${
      field.linkUrl
        ? html`<a href=${field.linkUrl} target="_blank" rel="noopener noreferrer"
            >${field.linkText ?? field.linkUrl}</a
          >`
        : nothing
    }
  </label>`;
}
