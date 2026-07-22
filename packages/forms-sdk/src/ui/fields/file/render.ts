import { html, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

export function renderFile(field: ControlFieldOf<'file'>, ctx: FieldRenderCtx): TemplateResult {
  return html`<input
    id=${ctx.id}
    name=${field.key}
    type="file"
    accept=${(field.validation?.allowedMimeTypes ?? []).join(',')}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    @change=${(e: Event) => {
      const input = e.target as HTMLInputElement;
      ctx.files[field.key] = input.files?.[0] ?? null;
      // Re-render so a previous error clears on reselect.
      ctx.requestUpdate();
    }}
  />`;
}
