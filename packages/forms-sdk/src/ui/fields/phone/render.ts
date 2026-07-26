import {
  composePhoneValue,
  PHONE_COUNTRY_META,
  resolvePhoneCountries,
  splitPhoneValue,
} from '@ratio-app/shared/schemas/fields/phone/constants';
import { html, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderPhone(field: ControlFieldOf<'phone'>, ctx: FieldRenderCtx): TemplateResult {
  const { codes, defaultCode } = resolvePhoneCountries(
    field.countries?.allowed,
    field.countries?.default,
  );

  // Single country ⇒ static dial chip (v1 layout; +91-only forms unchanged).
  // onInput stores the raw national number; the server composes/normalizes to
  // E.164 for the field's one country.
  if (codes.length === 1) {
    // resolvePhoneCountries guarantees defaultCode === codes[0] when single.
    const meta = PHONE_COUNTRY_META[defaultCode];
    return html`<div class="rf-phone">
      <span class="rf-phone-prefix">${meta.dial}</span>
      <input
        id=${ctx.id}
        name=${field.key}
        type="tel"
        inputmode="numeric"
        maxlength=${meta.maxLength}
        placeholder=${ctx.ph(field, field.placeholder ?? meta.placeholder)}
        aria-invalid=${ctx.invalid}
        aria-describedby=${ctx.describedBy}
        .value=${String(ctx.values[field.key] ?? '')}
        @input=${ctx.onInput}
      />
    </div>`;
  }

  // Multi country ⇒ dial-code <select> + number input. The stored value is the
  // composed E.164 string (`+<dial><national>`); the selected country and the
  // national digits shown are derived back from it each render.
  const { code: selected, national } = splitPhoneValue(ctx.values[field.key], codes, defaultCode);
  const meta = PHONE_COUNTRY_META[selected];

  const onCountryChange = (e: Event) => {
    const code = (e.target as HTMLSelectElement).value as (typeof codes)[number];
    // Preserve the digits already typed; store bare dial when empty so the
    // chosen country persists across the re-render without tripping "required".
    ctx.setValue(
      field.key,
      national ? composePhoneValue(code, national) : PHONE_COUNTRY_META[code].dial,
    );
  };
  const onNumberInput = (e: Event) => {
    const digits = (e.target as HTMLInputElement).value.replace(/\D/g, '');
    ctx.setValue(
      field.key,
      digits ? composePhoneValue(selected, digits) : PHONE_COUNTRY_META[selected].dial,
    );
  };

  return html`<div class="rf-phone rf-phone-multi">
    <select
      class="rf-phone-country"
      aria-label="Country code"
      .value=${live(selected)}
      @change=${onCountryChange}
    >
      ${codes.map(
        (c) =>
          html`<option value=${c}>${PHONE_COUNTRY_META[c].flag} ${PHONE_COUNTRY_META[c].dial}</option>`,
      )}
    </select>
    <input
      id=${ctx.id}
      name=${field.key}
      type="tel"
      inputmode="numeric"
      maxlength=${meta.maxLength}
      placeholder=${ctx.ph(field, field.placeholder ?? meta.placeholder)}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .value=${national}
      @input=${onNumberInput}
    />
  </div>`;
}
