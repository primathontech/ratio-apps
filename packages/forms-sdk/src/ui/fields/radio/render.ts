import {
  FORM_SELECT_OTHER_DEFAULT_LABEL,
  FORM_SELECT_OTHER_MAX_LENGTH,
  FORM_SELECT_OTHER_SENTINEL,
} from '@ratio-app/shared/schemas/fields/_shared/select-constants';
import { html, nothing, type TemplateResult } from 'lit';
import { type ControlFieldOf, type FieldRenderCtx, selectUiState } from '../types';

export function renderRadio(field: ControlFieldOf<'radio'>, ctx: FieldRenderCtx): TemplateResult {
  const current =
    typeof ctx.values[field.key] === 'string' ? (ctx.values[field.key] as string) : '';
  const inOptions = field.options.some((o) => o.value === current);
  const allowOther = field.allowOther === true;
  const otherLabel = field.otherLabel ?? FORM_SELECT_OTHER_DEFAULT_LABEL;
  const ui = selectUiState(ctx, field.key);
  const otherActive = allowOther && (ui.otherActive === true || (current !== '' && !inOptions));

  const layout = field.layout ?? 'vertical';
  const variant = field.variant ?? 'list';
  const gridColumns = field.gridColumns ?? 2;
  // `gridColumns` is a schema-bounded integer (2–4), so inlining it into a
  // grid-template is safe — no user string reaches CSS.
  const gridStyle =
    layout === 'grid'
      ? `display:grid;grid-template-columns:repeat(${gridColumns},minmax(0,1fr));gap:6px;`
      : nothing;

  const choose = (value: string) => {
    ui.otherActive = false;
    ctx.setValue(field.key, value);
  };
  const chooseOther = () => {
    ui.otherActive = true;
    ctx.setValue(field.key, otherActive ? current : '');
    ctx.requestUpdate();
  };

  return html`<div
    class="rf-checks"
    id=${ctx.id}
    role="radiogroup"
    aria-labelledby=${`rf-label-${field.key}`}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    data-layout=${layout !== 'vertical' ? layout : nothing}
    data-variant=${variant !== 'list' ? variant : nothing}
    style=${gridStyle}
  >
    ${field.options.map(
      (opt) =>
        html`<label class="rf-check">
          <input
            type="radio"
            name=${field.key}
            value=${opt.value}
            .checked=${!otherActive && current === opt.value}
            @change=${(e: Event) => choose((e.target as HTMLInputElement).value)}
          />
          <span class="rf-check-text">${opt.label}</span>
        </label>`,
    )}
    ${
      allowOther
        ? html`<label class="rf-check">
            <input
              type="radio"
              name=${field.key}
              value=${FORM_SELECT_OTHER_SENTINEL}
              .checked=${otherActive}
              @change=${chooseOther}
            />
            <span class="rf-check-text">${otherLabel}</span>
          </label>`
        : nothing
    }
    ${
      otherActive
        ? html`<input
            class="rf-other-input"
            type="text"
            aria-label=${`${field.label} — ${otherLabel}`}
            maxlength=${FORM_SELECT_OTHER_MAX_LENGTH}
            placeholder=${otherLabel}
            .value=${current}
            @input=${(e: Event) => ctx.setValue(field.key, (e.target as HTMLInputElement).value)}
          />`
        : nothing
    }
  </div>`;
}
