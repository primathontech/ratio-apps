import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';

/** Human-readable byte size for the per-file meta line (e.g. "12.3 KB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * File field. `maxFiles` (default 1) selects the shape:
 *
 *  - `maxFiles <= 1` (or ABSENT, for forms saved before the key existed) renders
 *    exactly the legacy lone `<input type="file">` — byte-identical to the
 *    pre-multi behavior — and stores a single-element (or empty) `File[]`.
 *  - `maxFiles > 1` renders a multi-select dropzone: an `<input multiple>` plus a
 *    list of the chosen files with an image preview / name / size and a per-file
 *    remove control. Re-selecting APPENDS (deduped) up to `maxFiles`, so a
 *    shopper can add files across several picks.
 *
 * The submit path (form-renderer) reads `ctx.files[key]` and uploads each entry,
 * storing a scalar object key for a single-file field and an array for a
 * multi-file field.
 */
export function renderFile(field: ControlFieldOf<'file'>, ctx: FieldRenderCtx): TemplateResult {
  const accept = (field.validation?.allowedMimeTypes ?? []).join(',');
  const maxFiles = field.maxFiles ?? 1;

  if (maxFiles <= 1) {
    // Legacy single-file input — unchanged markup so an existing form is
    // byte-identical. Stored as a one-element File[] (or [] when cleared).
    return html`<input
      id=${ctx.id}
      name=${field.key}
      type="file"
      accept=${accept}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      @change=${(e: Event) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0] ?? null;
        ctx.files[field.key] = file ? [file] : [];
        // Re-render so a previous error clears on reselect.
        ctx.requestUpdate();
      }}
    />`;
  }

  const selected = ctx.files[field.key] ?? [];
  const atLimit = selected.length >= maxFiles;
  return html`<div class="rf-filefield">
    <input
      id=${ctx.id}
      name=${field.key}
      type="file"
      multiple
      accept=${accept}
      ?disabled=${atLimit}
      aria-invalid=${ctx.invalid}
      aria-describedby=${ctx.describedBy}
      @change=${(e: Event) => {
        const input = e.target as HTMLInputElement;
        const picked = Array.from(input.files ?? []);
        // Append, dedupe (by name+size+lastModified), and cap at maxFiles so
        // multiple picks accumulate without exceeding the field's limit.
        const current = ctx.files[field.key] ?? [];
        const seen = new Set(current.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
        const merged = [...current];
        for (const file of picked) {
          const sig = `${file.name}:${file.size}:${file.lastModified}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          merged.push(file);
        }
        ctx.files[field.key] = merged.slice(0, maxFiles);
        // Clear the native input so re-picking the same file still fires change.
        input.value = '';
        ctx.requestUpdate();
      }}
    />
    <p class="rf-file-hint">${selected.length}/${maxFiles} selected</p>
    ${
      selected.length > 0
        ? html`<ul class="rf-files">
            ${selected.map((file, i) => renderFileRow(field.key, file, i, ctx))}
          </ul>`
        : nothing
    }
  </div>`;
}

/** One chosen-file row: image preview (or a generic chip), name, size, remove. */
function renderFileRow(
  key: string,
  file: File,
  index: number,
  ctx: FieldRenderCtx,
): TemplateResult {
  const isImage = file.type.startsWith('image/');
  // Object URLs are cheap and the form is short-lived; a thumbnail only for
  // images, a text chip otherwise.
  const preview = isImage
    ? html`<img class="rf-file-thumb" src=${URL.createObjectURL(file)} alt="" />`
    : html`<span class="rf-file-thumb rf-file-thumb-doc" aria-hidden="true">FILE</span>`;
  return html`<li class="rf-file">
    ${preview}
    <span class="rf-file-meta">
      <span class="rf-file-name">${file.name}</span>
      <span class="rf-file-size">${formatBytes(file.size)}</span>
    </span>
    <button
      type="button"
      class="rf-file-remove"
      aria-label=${`Remove ${file.name}`}
      @click=${() => {
        const next = (ctx.files[key] ?? []).slice();
        next.splice(index, 1);
        ctx.files[key] = next;
        ctx.requestUpdate();
      }}
    >
      &times;
    </button>
  </li>`;
}
