import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderUrl(field: ControlFieldOf<'url'>, ctx: FieldRenderCtx): TemplateResult {
  // Trim on blur (mirror text/render.ts): a pasted URL with surrounding
  // whitespace would otherwise be rejected invisibly. Store the trimmed value.
  const onBlur = (e: Event): void => {
    const el = e.target as HTMLInputElement;
    const trimmed = el.value.trim();
    if (trimmed !== el.value) {
      el.value = trimmed;
      ctx.setValue(field.key, trimmed);
    }
  };
  return ctx.adorn(
    field,
    html`<input
      id=${ctx.id}
      name=${field.key}
      type="url"
      inputmode="url"
      maxlength=${field.validation?.maxLength ?? nothing}
      placeholder=${ctx.ph(field, field.placeholder ?? 'https://')}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      .value=${String(ctx.values[field.key] ?? '')}
      @input=${ctx.onInput}
      @blur=${onBlur}
    />`,
  );
}
