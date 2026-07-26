import type { ControlFieldOf, FieldValidateCtx } from '../types';

/**
 * Client-side file validation. Files are stored as a `File[]` per field
 * (single-file fields carry 0..1 entries, multi-file fields 0..maxFiles). Every
 * chosen file is checked against the field's mime allowlist + byte cap, and the
 * count against `maxFiles` (default 1 — including forms saved before the key
 * existed). Mirrors the server's `validateFiles` so client and server agree.
 */
export function validateFile(field: ControlFieldOf<'file'>, ctx: FieldValidateCtx): string | null {
  const files = ctx.files[field.key] ?? [];
  if (files.length === 0) return field.required ? 'Please attach a file.' : null;

  const maxFiles = field.maxFiles ?? 1;
  if (files.length > maxFiles) {
    return maxFiles === 1
      ? 'Please attach a single file.'
      : `Please attach at most ${maxFiles} files.`;
  }

  const allowed = field.validation?.allowedMimeTypes as readonly string[] | undefined;
  const maxBytes = field.validation?.maxBytes ?? 5 * 1024 * 1024;
  for (const file of files) {
    if (allowed && !allowed.includes(file.type)) {
      return `Please attach a file of an allowed type: ${allowed.join(', ')}.`;
    }
    if (file.size > maxBytes) {
      return `Please attach a file of at most ${Math.floor(maxBytes / 1024)} KB.`;
    }
  }
  return null;
}
