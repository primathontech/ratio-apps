import type { ControlFieldOf, FieldValidateCtx } from '../types';

/**
 * The reason a single chosen file fails the field's mime allowlist / byte cap,
 * or `null` when it passes. Shared with `render.ts` so add-time rejection and
 * submit-time validation apply the exact same rules. The wording is kept short
 * (it is embedded per-file into a named message) yet still carries the "allowed
 * type" / "at most" phrasing the field-level copy relies on. Mime is checked
 * before size to match the server's `validateFiles` ordering.
 */
export function fileRejection(field: ControlFieldOf<'file'>, file: File): string | null {
  const allowed = field.validation?.allowedMimeTypes as readonly string[] | undefined;
  const maxBytes = field.validation?.maxBytes ?? 5 * 1024 * 1024;
  if (allowed && !allowed.includes(file.type)) {
    return `not an allowed type — need ${allowed.join(', ')}`;
  }
  if (file.size > maxBytes) {
    return `at most ${Math.floor(maxBytes / 1024)} KB`;
  }
  return null;
}

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

  // Collect and NAME every offending file so the shopper sees WHICH attachment
  // is the problem, instead of a single anonymous "wrong type / too big" line.
  const offenders: string[] = [];
  for (const file of files) {
    const reason = fileRejection(field, file);
    if (reason) offenders.push(`"${file.name}" — ${reason}`);
  }
  if (offenders.length > 0) {
    return offenders.length === 1
      ? `Please fix ${offenders[0]}.`
      : `Please fix these files: ${offenders.join('; ')}.`;
  }
  return null;
}
