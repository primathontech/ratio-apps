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
  // The server composes/normalizes the stored national digits to E.164.
  if (codes.length === 1) {
    // resolvePhoneCountries guarantees defaultCode === codes[0] when single.
    const meta = PHONE_COUNTRY_META[defaultCode];
    // Digit-normalize on input (mirror the multi-country national input): strip
    // separators the shopper types/pastes so the stored value is bare digits and
    // live() clears them from view. No char-count `maxlength` — it counted the
    // separators too, so a spaced "98765 43210" truncated to 9 digits and was
    // rejected; the real per-country digit bound is enforced in canonicalizePhone.
    const onDigitInput = (e: Event) => {
      ctx.setValue(field.key, (e.target as HTMLInputElement).value.replace(/\D/g, ''));
    };
    return html`<div class="rf-phone">
      <span class="rf-phone-prefix">${meta.dial}</span>
      <input
        id=${ctx.id}
        name=${field.key}
        type="tel"
        inputmode="numeric"
        placeholder=${ctx.ph(field, field.placeholder ?? meta.placeholder)}
        aria-invalid=${ctx.invalid}
        aria-describedby=${ctx.describedBy}
        .value=${live(String(ctx.values[field.key] ?? ''))}
        @input=${onDigitInput}
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
    const raw = (e.target as HTMLInputElement).value;
    // Pasting a full international number (leading '+') into the NATIONAL input:
    // derive BOTH the country and the national digits from it and switch the
    // selected country, instead of stripping the '+dial' into the national part.
    if (raw.trimStart().startsWith('+')) {
      const parsed = splitPhoneValue(raw, codes, defaultCode);
      ctx.setValue(
        field.key,
        parsed.national
          ? composePhoneValue(parsed.code, parsed.national)
          : PHONE_COUNTRY_META[parsed.code].dial,
      );
      return;
    }
    const digits = raw.replace(/\D/g, '');
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
        // name + dial so same-dial countries (US/CA both +1) are distinguishable.
        // Limitation: the stored value is pure E.164, so it can't round-trip WHICH
        // shared-dial ISO was picked — splitPhoneValue re-derives the country by
        // longest/among-fitting dial match, so a +1 pick may resolve back to US on
        // re-render. Distinct labels are the achievable fix without a second field.
        (c) =>
          html`<option value=${c}>
            ${PHONE_COUNTRY_META[c].flag} ${PHONE_COUNTRY_META[c].name} (${PHONE_COUNTRY_META[c].dial})
          </option>`,
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
      .value=${live(national)}
      @input=${onNumberInput}
    />
  </div>`;
}
