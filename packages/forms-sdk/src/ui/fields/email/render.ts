import {
  EMAIL_MAX_LENGTH_DEFAULT,
  suggestEmailCorrection,
} from '@ratio-app/shared/schemas/fields/email/constants';
import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderEmail(field: ControlFieldOf<'email'>, ctx: FieldRenderCtx): TemplateResult {
  const maxLength = field.validation?.maxLength ?? EMAIL_MAX_LENGTH_DEFAULT;

  const input = html`<input
    id=${ctx.id}
    name=${field.key}
    type="email"
    inputmode="email"
    autocomplete="email"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
    maxlength=${maxLength}
    placeholder=${ctx.ph(field, field.placeholder ?? '')}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    .value=${String(ctx.values[field.key] ?? '')}
    @input=${ctx.onInput}
  />`;

  const control = ctx.adorn(field, input);

  // Client-only, non-blocking "did you mean" hint (no network). Default on;
  // computed from the current value each render. Clicking applies the fix.
  const raw = String(ctx.values[field.key] ?? '');
  const suggestion =
    field.validation?.suggestCorrections === false ? null : suggestEmailCorrection(raw);

  // ALWAYS render the same `.rf-email` wrapper (suggestion or not) so the <input>
  // node is stable across renders: toggling between a bare input and a wrapped
  // one recreates the input element, which drops focus and caret mid-type as the
  // suggestion appears/vanishes keystroke-to-keystroke (e.g. "gmail.co"→".com").
  // The button is `nothing` when there's no suggestion. Descendant/`:has` CSS
  // (adornments, floating label, input variants) still matches the input.
  const suggest =
    suggestion === null
      ? nothing
      : html`<button
          type="button"
          class="rf-email-suggest"
          data-suggest-for=${field.key}
          @click=${() => {
            ctx.setValue(field.key, suggestion);
            ctx.requestUpdate();
          }}
        >
          Did you mean <strong>${suggestion}</strong>?
        </button>`;
  return html`<div class="rf-email">${control}${suggest}</div>`;
}
