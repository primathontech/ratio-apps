import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderMultiSelect(
  field: ControlFieldOf<'multi_select'>,
  ctx: FieldRenderCtx,
): TemplateResult {
  return html`<div class="rf-checks" id=${ctx.id}>
    ${field.options.map((opt) => {
      const current = Array.isArray(ctx.values[field.key])
        ? (ctx.values[field.key] as string[])
        : [];
      return html`<label class="rf-check">
        <input
          type="checkbox"
          name=${field.key}
          value=${opt}
          .checked=${current.includes(opt)}
          @change=${(e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;
            const next = checked ? [...current, opt] : current.filter((v) => v !== opt);
            ctx.setValue(field.key, next);
          }}
        />
        ${opt}
      </label>`;
    })}
  </div>`;
}
