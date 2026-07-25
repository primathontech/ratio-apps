import {
  applyTextTransform,
  FORM_TEXT_HARD_MAX_LENGTH,
  textFormatPattern,
} from '@ratio-app/shared/schemas/fields/text/constants';
import { html, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderText(field: ControlFieldOf<'text'>, ctx: FieldRenderCtx): TemplateResult {
  const v = field.validation;
  // Reflect native length attrs. maxlength is always the hard ceiling (capped by
  // an explicit maxLength when smaller) — the client can never type past it.
  const maxlength =
    v?.maxLength !== undefined
      ? Math.min(v.maxLength, FORM_TEXT_HARD_MAX_LENGTH)
      : FORM_TEXT_HARD_MAX_LENGTH;
  // Native pattern hint (preset source or the merchant regex); the div-based
  // form does no native constraint validation, so this is a semantic mirror only.
  const pattern = textFormatPattern(v?.format) ?? v?.pattern;

  // UX mirror of the server-authoritative transform: normalize on blur so the
  // shopper sees the canonical value the server will store.
  const onBlur = (e: Event): void => {
    const el = e.target as HTMLInputElement;
    const canonical = applyTextTransform(el.value, v?.transform);
    if (canonical !== el.value) {
      el.value = canonical;
      ctx.setValue(field.key, canonical);
    }
  };

  return ctx.adorn(
    field,
    html`<input
      id=${ctx.id}
      name=${field.key}
      type="text"
      placeholder=${ctx.ph(field, field.placeholder ?? '')}
      maxlength=${maxlength}
      minlength=${ifDefined(v?.minLength)}
      pattern=${ifDefined(pattern)}
      autocomplete=${ifDefined(field.autocomplete)}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .value=${String(ctx.values[field.key] ?? '')}
      @input=${ctx.onInput}
      @blur=${onBlur}
    />`,
  );
}
