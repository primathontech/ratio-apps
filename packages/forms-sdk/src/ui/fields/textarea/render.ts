import {
  TEXTAREA_DEFAULT_ROWS,
  TEXTAREA_MONOSPACE_FONT_STACK,
  TEXTAREA_ROW_LINE_HEIGHT_EM,
} from '@ratio-app/shared/schemas/fields/textarea/constants';
import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

/**
 * Batch-4 field-depth render. Reflects the display config as native attrs /
 * inline styles only — no host-CSS dependency, so it degrades gracefully:
 *  - `minRows`   → `rows` (initial height; today's static `rows="4"` default).
 *  - `autoGrow`  → `field-sizing: content` between a min/max-rows height clamp.
 *  - `enforceMaxLength` → native `maxlength` (server still hard-enforces).
 *  - `monospace` → inline network-free monospace stack + a `data-mono` hook.
 * `counterUnit` is read by the host's live counter (form-renderer), not here.
 */
export function renderTextarea(
  field: ControlFieldOf<'textarea'>,
  ctx: FieldRenderCtx,
): TemplateResult {
  const display = field.display;
  const minRows = display?.minRows ?? TEXTAREA_DEFAULT_ROWS;
  const maxRows = display?.maxRows;

  const styles: string[] = [];
  if (display?.autoGrow) {
    // Grow with content; clamp the growth window to [minRows, maxRows] rows.
    styles.push('field-sizing:content');
    styles.push(`min-height:${(minRows * TEXTAREA_ROW_LINE_HEIGHT_EM).toFixed(2)}em`);
    if (maxRows !== undefined) {
      styles.push(`max-height:${(maxRows * TEXTAREA_ROW_LINE_HEIGHT_EM).toFixed(2)}em`);
      styles.push('overflow:auto');
    }
  }
  if (display?.monospace) styles.push(`font-family:${TEXTAREA_MONOSPACE_FONT_STACK}`);
  const style = styles.length > 0 ? styles.join(';') : nothing;

  // Native maxlength only when the merchant opted into a hard client cap; the
  // server enforces validation.maxLength regardless of this attribute.
  const max = field.validation?.maxLength;
  const maxlength = display?.enforceMaxLength && typeof max === 'number' ? max : nothing;

  return html`<textarea
    id=${ctx.id}
    name=${field.key}
    rows=${minRows}
    maxlength=${maxlength}
    data-mono=${display?.monospace ? '' : nothing}
    style=${style}
    placeholder=${ctx.ph(field, field.placeholder ?? '')}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    .value=${String(ctx.values[field.key] ?? '')}
    @input=${ctx.onInput}
  ></textarea>`;
}
