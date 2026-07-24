import type { ControlFieldOf, FieldValidateCtx } from '../types';

export function validateFile(field: ControlFieldOf<'file'>, ctx: FieldValidateCtx): string | null {
  const file = ctx.files[field.key] ?? null;
  if (!file) return field.required ? 'Please attach a file.' : null;
  const allowed = field.validation?.allowedMimeTypes as readonly string[] | undefined;
  if (allowed && !allowed.includes(file.type)) {
    return `Please attach a file of an allowed type: ${allowed.join(', ')}.`;
  }
  const maxBytes = field.validation?.maxBytes ?? 5 * 1024 * 1024;
  if (file.size > maxBytes)
    return `Please attach a file of at most ${Math.floor(maxBytes / 1024)} KB.`;
  return null;
}
