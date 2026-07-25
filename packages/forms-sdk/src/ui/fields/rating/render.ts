import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderRating(field: ControlFieldOf<'rating'>, ctx: FieldRenderCtx): TemplateResult {
  const glyph = field.icon === 'heart' ? '♥' : '★';
  // display absent ⇒ 'stars' (today's behavior); 'numbers' ⇒ numbered buttons.
  const numbered = field.display === 'numbers';
  // min absent ⇒ 1 (1-based); 0 enables a 0-based scale (e.g. 0–10 NPS).
  const min = field.min ?? 1;
  const current = Number(ctx.values[field.key] ?? 0);
  const hasLabels = field.lowLabel !== undefined || field.highLabel !== undefined;
  return html`<div
    class="rf-rating"
    id=${ctx.id}
    role="radiogroup"
    aria-labelledby=${`rf-label-${field.key}`}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
  >
    ${Array.from({ length: field.max - min + 1 }, (_, i) => min + i).map(
      (n) =>
        html`<label
          class=${numbered ? 'rf-rating-num' : 'rf-star'}
          data-on=${numbered ? current === n : n <= current}
        >
          <input
            type="radio"
            name=${field.key}
            value=${n}
            .checked=${current === n}
            @change=${() => ctx.setValue(field.key, n)}
          />
          <span aria-hidden="true">${numbered ? n : glyph}</span>
          <span class="rf-sr">${field.label} ${n}</span>
        </label>`,
    )}
    ${
      hasLabels
        ? html`<div class="rf-rating-labels" aria-hidden="true">
          <span class="rf-rating-low">${field.lowLabel ?? ''}</span>
          <span class="rf-rating-high">${field.highLabel ?? ''}</span>
        </div>`
        : nothing
    }
  </div>`;
}
