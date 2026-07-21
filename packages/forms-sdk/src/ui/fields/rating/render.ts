import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderRating(field: ControlFieldOf<'rating'>, ctx: FieldRenderCtx): TemplateResult {
  const glyph = field.icon === 'heart' ? '♥' : '★';
  const current = Number(ctx.values[field.key] ?? 0);
  return html`<div
    class="rf-rating"
    id=${ctx.id}
    role="radiogroup"
    aria-labelledby=${`rf-label-${field.key}`}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
  >
    ${Array.from({ length: field.max }, (_, i) => i + 1).map(
      (n) =>
        html`<label class="rf-star" data-on=${n <= current}>
          <input
            type="radio"
            name=${field.key}
            value=${n}
            .checked=${current === n}
            @change=${() => ctx.setValue(field.key, n)}
          />
          <span aria-hidden="true">${glyph}</span>
          <span class="rf-sr">${field.label} ${n}</span>
        </label>`,
    )}
  </div>`;
}
