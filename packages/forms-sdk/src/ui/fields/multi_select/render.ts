import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

// Visually-hidden but focusable — keeps the native checkbox reachable by
// keyboard in `chips` mode while the label pill carries the visible state.
const SR_ONLY =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';

export function renderMultiSelect(
  field: ControlFieldOf<'multi_select'>,
  ctx: FieldRenderCtx,
): TemplateResult {
  const current = Array.isArray(ctx.values[field.key]) ? (ctx.values[field.key] as string[]) : [];
  const isChips = field.display === 'chips';
  // `columns` is a schema-bounded integer (1–3), so inlining it into a
  // grid-template is safe — no user string reaches CSS.
  const columns = field.columns ?? 1;
  const min = field.selection?.min;
  const max = field.selection?.max;

  const toggle = (value: string, checked: boolean) => {
    const next = checked ? [...current, value] : current.filter((v) => v !== value);
    ctx.setValue(field.key, next);
  };

  // Select-all/clear-all is misleading once a max cap is set, so hide it then.
  const showSelectAll = field.showSelectAll === true && max === undefined;
  const allValues = field.options.map((o) => o.value);
  const allChecked = allValues.length > 0 && allValues.every((v) => current.includes(v));

  const containerStyle = isChips
    ? // explicit row direction: the widget's `.rf-checks` CSS is a column stack.
      'display:flex;flex-direction:row;flex-wrap:wrap;gap:6px;'
    : columns > 1
      ? `display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:6px;`
      : '';

  return html`<div
    class="rf-checks"
    id=${ctx.id}
    role="group"
    aria-labelledby=${`rf-label-${field.key}`}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    data-display=${isChips ? 'chips' : 'checklist'}
    style=${containerStyle || nothing}
  >
    ${
      showSelectAll
        ? html`<button
            type="button"
            class="rf-linkbtn"
            aria-pressed=${allChecked}
            @click=${() => ctx.setValue(field.key, allChecked ? [] : [...allValues])}
          >
            ${allChecked ? 'Clear all' : 'Select all'}
          </button>`
        : nothing
    }
    ${field.options.map((opt) => {
      const checked = current.includes(opt.value);
      // Chips carry their own inline pill styling (the widget CSS has no
      // `.rf-chip` rule); the checklist keeps the themed `.rf-check` class.
      const chipStyle = `display:inline-flex;align-items:center;gap:6px;border:1px solid ${
        checked ? 'var(--wz-primary, #16a34a)' : 'var(--wz-border, #d0d5dd)'
      };border-radius:999px;padding:4px 12px;cursor:pointer;font-size:var(--wz-font-size);${
        checked ? 'background:var(--wz-subtle, #f0fdf4);' : ''
      }`;
      return html`<label
        class=${isChips ? 'rf-chip' : 'rf-check'}
        data-checked=${checked || nothing}
        style=${isChips ? chipStyle : nothing}
      >
        <input
          type="checkbox"
          name=${field.key}
          value=${opt.value}
          style=${isChips ? SR_ONLY : nothing}
          .checked=${checked}
          @change=${(e: Event) => toggle(opt.value, (e.target as HTMLInputElement).checked)}
        />
        ${opt.label}
      </label>`;
    })}
    ${
      min !== undefined || max !== undefined
        ? html`<div class="rf-selcount" aria-live="polite">
            ${current.length}${max !== undefined ? ` of ${max}` : ''} selected${
              min !== undefined && current.length < min ? ` — choose at least ${min}` : ''
            }
          </div>`
        : nothing
    }
  </div>`;
}
