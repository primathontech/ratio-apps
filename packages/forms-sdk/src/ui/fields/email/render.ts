import {
  EMAIL_MAX_LENGTH_DEFAULT,
  suggestEmailCorrection,
} from '@ratio-app/shared/schemas/fields/email/constants';
import { html, type TemplateResult } from 'lit';
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

  // No suggestion ⇒ return the control unchanged (byte-identical to the prior
  // renderer). With a suggestion, wrap control + hint in a static container:
  // a template made solely of nested-template interpolations doesn't render, so
  // the wrapper element gives the parts a static root. Descendant/`:has` CSS
  // (adornments, floating label, input variants) still matches the input.
  if (suggestion === null) return control;
  return html`<div class="rf-email">
    ${control}
    <button
      type="button"
      class="rf-email-suggest"
      data-suggest-for=${field.key}
      @click=${() => {
        ctx.setValue(field.key, suggestion);
        ctx.requestUpdate();
      }}
    >
      Did you mean <strong>${suggestion}</strong>?
    </button>
  </div>`;
}
