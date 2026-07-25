import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

/**
 * Field keys currently focused (blur-format / focus-raw display, Batch-4 number
 * display formatting). Module-scoped rather than component state because the
 * per-field render module is stateless; keyed by `field.key`. A focused input
 * shows the raw canonical value (so the shopper edits a plain number); on blur
 * we swap to the `Intl.NumberFormat` string. `live()` forces the swap into the
 * DOM across the widget's re-render-on-every-keystroke cycle without fighting
 * typing (the focused branch always renders raw = what the shopper typed).
 */
const focusedNumberKeys = new Set<string>();

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
  // (editable); blurred ⇒ the Intl string. onInput keeps ctx.values canonical.
  const focused = focusedNumberKeys.has(field.key);
  const display = focused ? raw : formatNumber(raw, field.format);
  const onFocus = () => {
    focusedNumberKeys.add(field.key);
    ctx.requestUpdate();
  };
  const onBlur = () => {
    focusedNumberKeys.delete(field.key);
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
      @input=${ctx.onInput}
      @focus=${onFocus}
      @blur=${onBlur}
    />`,
  );
}
