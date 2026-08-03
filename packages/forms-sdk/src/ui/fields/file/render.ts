import { html, nothing, type TemplateResult } from 'lit';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { fileRejection } from './validate';

/** Human-readable byte size for the per-file meta line (e.g. "12.3 KB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

// One object URL per File, memoized so repeated renders (e.g. a keystroke in an
// unrelated field re-runs the template) reuse the SAME url instead of decoding a
// fresh blob every time — that re-decode is the visible thumbnail flicker, and
// each discarded url was a leak. The Remove handler revokes + evicts its entry.
const objectUrls = new WeakMap<File, string>();

function objectUrlFor(file: File): string {
  let url = objectUrls.get(file);
  if (url === undefined) {
    url = URL.createObjectURL(file);
    objectUrls.set(file, url);
  }
  return url;
}

function revokeObjectUrl(file: File): void {
  const url = objectUrls.get(file);
  if (url !== undefined) {
    URL.revokeObjectURL(url);
    objectUrls.delete(file);
  }
}

// Transient hint-line feedback (files dropped for the limit, or files rejected
// for mime/size at add time). Scoped to the form instance via its `files` record
// so notices never bleed between concurrently-mounted forms, and auto-dismissed
// on a short timer so the hint returns to the plain "N/M selected" state.
interface Notice {
  msg: string;
  timer: ReturnType<typeof setTimeout>;
}
const noticeState = new WeakMap<Record<string, File[]>, Map<string, Notice>>();
const NOTICE_MS = 6000;

function fileNotice(ctx: FieldRenderCtx, key: string): string | undefined {
  return noticeState.get(ctx.files)?.get(key)?.msg;
}

function setFileNotice(ctx: FieldRenderCtx, key: string, msg: string): void {
  let byKey = noticeState.get(ctx.files);
  if (byKey === undefined) {
    byKey = new Map();
    noticeState.set(ctx.files, byKey);
  }
  const prev = byKey.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    byKey?.delete(key);
    ctx.requestUpdate();
  }, NOTICE_MS);
  byKey.set(key, { msg, timer });
}

function clearFileNotice(ctx: FieldRenderCtx, key: string): void {
  const byKey = noticeState.get(ctx.files);
  const prev = byKey?.get(key);
  if (prev) {
    clearTimeout(prev.timer);
    byKey?.delete(key);
  }
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
  const notice = fileNotice(ctx, field.key);
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
        // Reject wrong-mime / oversize files at ADD time (rather than letting
        // them sit in the list looking accepted until a blur/submit surfaces an
        // anonymous field-level error): keep the good ones, name the bad ones.
        const rejected: string[] = [];
        const okPicked: File[] = [];
        for (const file of picked) {
          const reason = fileRejection(field, file);
          if (reason) rejected.push(`"${file.name}" (${reason})`);
          else okPicked.push(file);
        }
        // Append, dedupe (by name+size+lastModified), and cap at maxFiles so
        // multiple picks accumulate without exceeding the field's limit.
        const current = ctx.files[field.key] ?? [];
        const seen = new Set(current.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
        const merged = [...current];
        for (const file of okPicked) {
          const sig = `${file.name}:${file.size}:${file.lastModified}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          merged.push(file);
        }
        const capped = merged.slice(0, maxFiles);
        // How many accepted-but-new files the maxFiles cap actually dropped.
        const droppedForLimit = merged.length - capped.length;
        ctx.files[field.key] = capped;
        // Clear the native input so re-picking the same file still fires change.
        input.value = '';

        // Surface a transient hint-line message when files silently vanished —
        // either dropped for the limit or rejected for type/size.
        const notes: string[] = [];
        if (droppedForLimit > 0) {
          notes.push(`Only ${maxFiles} files allowed — extra files weren't added.`);
        }
        if (rejected.length > 0) {
          notes.push(`Couldn't add ${rejected.join(', ')}.`);
        }
        if (notes.length > 0) setFileNotice(ctx, field.key, notes.join(' '));
        else clearFileNotice(ctx, field.key);

        ctx.requestUpdate();
      }}
    />
    <p class="rf-file-hint">${selected.length}/${maxFiles} selected</p>
    ${
      // Upload progress (B7): the presigned PUT flow uses fetch(), which emits no
      // byte-progress events — so this is an INDETERMINATE "Uploading…" bar shown
      // while the form is in-flight, not a faked percentage. It appears only when
      // there are files to upload and clears when uploading ends (done/error).
      ctx.uploading && selected.length > 0
        ? html`<div class="rf-file-progress" role="progressbar" aria-label="Uploading files" aria-busy="true">
            <span class="rf-file-progress-fill"></span>
          </div>`
        : nothing
    }
    ${notice !== undefined ? html`<p class="rf-file-notice" role="status">${notice}</p>` : nothing}
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
  // A memoized object URL thumbnail for images (see `objectUrlFor`), a text chip
  // otherwise.
  const preview = isImage
    ? html`<img class="rf-file-thumb" src=${objectUrlFor(file)} alt="" />`
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
        // Revoke the memoized thumbnail url so removing a file frees its blob.
        revokeObjectUrl(file);
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
