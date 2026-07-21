import type { ControlFieldOf, FieldValidateCtx } from '../types';

export function validateFile(field: ControlFieldOf<'file'>, ctx: FieldValidateCtx): string | null {
  const file = ctx.files[field.key] ?? null;
  if (!file) return field.required ? 'a file is required' : null;
  const allowed = field.validation?.allowedMimeTypes as readonly string[] | undefined;
  if (allowed && !allowed.includes(file.type)) {
    return `allowed types: ${allowed.join(', ')}`;
  }
  const maxBytes = field.validation?.maxBytes ?? 5 * 1024 * 1024;
  if (file.size > maxBytes) return `file must be at most ${Math.floor(maxBytes / 1024)} KB`;
  return null;
}
