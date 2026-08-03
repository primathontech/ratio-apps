import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { canonicalizeNumber } from './format';

// Focus tracking (blur-format / focus-raw display) lives on `ctx.numberFocus`,
// a per-RatioForm-instance Set keyed by `field.key`. Per-instance (not
// module-global) so display state never leaks across concurrent form embeds or
// lingers when a field is hidden without a blur — the host clears it on
// disconnect. A focused input shows the raw canonical value (the shopper edits
// a plain number); on blur we canonicalize the stored value and swap to the
// `Intl.NumberFormat` string. `live()` forces the swap into the DOM across the
// widget's re-render-on-every-keystroke cycle.

/**
 * Grouped / currency / percent display of a canonical number via the browser
 * `Intl` global (zero shared runtime constant, zero Zod). Value stays a number;
 * this is presentation only. `percent` divides by 100 so entering `50` shows
 * `50%` while the submitted value remains `50`. Any Intl failure (unknown
 * currency/locale — bounded by the schema enums, but defensive) falls back to
 * the raw string so the input never renders blank.
 */
function formatNumber(raw: string, format: ControlFieldOf<'number'>['format']): string {
  if (!format || raw.trim() === '') return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  try {
    const opts: Intl.NumberFormatOptions = { useGrouping: format.grouping };
    if (format.style === 'currency') {
      opts.style = 'currency';
      opts.currency = format.currency;
    } else if (format.style === 'percent') {
      opts.style = 'percent';
    } else {
      opts.style = 'decimal';
    }
    if (format.decimalPlaces !== undefined) {
      opts.minimumFractionDigits = format.decimalPlaces;
      opts.maximumFractionDigits = format.decimalPlaces;
    }
    const value = format.style === 'percent' ? n / 100 : n;
    return new Intl.NumberFormat(format.locale, opts).format(value);
  } catch {
    return raw;
  }
}

export function renderNumber(field: ControlFieldOf<'number'>, ctx: FieldRenderCtx): TemplateResult {
  const raw = String(ctx.values[field.key] ?? '');

  // No display formatting configured ⇒ today's native numeric input, unchanged.
  if (!field.format) {
    return ctx.adorn(
      field,
      html`<input
        id=${ctx.id}
        name=${field.key}
        type="number"
        inputmode=${field.validation?.integer ? 'numeric' : 'decimal'}
        step=${field.validation?.step ?? (field.validation?.integer ? 1 : 'any')}
        min=${field.validation?.min ?? nothing}
        max=${field.validation?.max ?? nothing}
        placeholder=${ctx.ph(field, field.placeholder ?? '')}
        aria-invalid=${ctx.invalid}
        aria-describedby=${ctx.describedBy}
        .value=${raw}
        @input=${ctx.onInput}
      />`,
    );
  }

  // Formatted display: a text input so the grouped/currency/percent string can
  // show. inputmode still surfaces the numeric keypad. Focused ⇒ raw canonical
  // (editable); blurred ⇒ the Intl string. onNumberInput keeps the stored value
  // to numeric chars; onBlur canonicalizes it so display==submit.
  const focused = ctx.numberFocus.has(field.key);
  const display = focused ? raw : formatNumber(raw, field.format);
  const onFocus = () => {
    ctx.numberFocus.add(field.key);
    ctx.requestUpdate();
  };
  // Formatted variant is type=text, so — unlike a native number input — letters
  // would otherwise stick until submit. Strip to digits/sign/decimal/grouping
  // chars (whitespace + '.'/',') on every keystroke so it behaves numerically;
  // live(display) reflects the stripped value, dropping any typed letter.
  const onNumberInput = (e: Event) => {
    const cleaned = (e.target as HTMLInputElement).value.replace(/[^0-9+\-.,\s]/gu, '');
    ctx.setValue(field.key, cleaned);
  };
  const onBlur = (e: Event) => {
    ctx.numberFocus.delete(field.key);
    // Canonicalize so the STORED value matches the formatted string shown: a
    // grouped/locale-decimal entry becomes a plain ASCII number (rounded to
    // decimalPlaces), fixing "1,234"→NaN and the "$1,235" submitted-as-1234.56.
    const canonical = canonicalizeNumber((e.target as HTMLInputElement).value, field.format);
    if (canonical !== raw) ctx.setValue(field.key, canonical);
    ctx.requestUpdate();
  };
  return ctx.adorn(
    field,
    html`<input
      id=${ctx.id}
      name=${field.key}
      type="text"
      inputmode=${field.validation?.integer ? 'numeric' : 'decimal'}
      placeholder=${ctx.ph(field, field.placeholder ?? '')}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      style="font-variant-numeric: tabular-nums;"
      .value=${live(display)}
      @input=${onNumberInput}
      @focus=${onFocus}
      @blur=${onBlur}
    />`,
  );
}
