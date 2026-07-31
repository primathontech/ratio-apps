import { nothing, render } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { renderFile } from './render';

const field = (overrides: Partial<ControlFieldOf<'file'>> = {}): ControlFieldOf<'file'> =>
  ({
    key: 'doc',
    type: 'file',
    label: 'Attachment',
    required: false,
    validation: { allowedMimeTypes: ['application/pdf', 'image/png'], maxBytes: 1024 },
    ...overrides,
  }) as ControlFieldOf<'file'>;

/** A self-re-rendering harness: `requestUpdate` re-runs the template into host.
 * `uploading` seeds the in-flight state and can be flipped on the returned ctx
 * (then re-render via `ctx.requestUpdate()`) to exercise the upload bar. */
function harness(
  f: ControlFieldOf<'file'>,
  uploading = false,
): { host: HTMLElement; ctx: FieldRenderCtx } {
  const host = document.createElement('div');
  const files: Record<string, File[]> = {};
  const ctx: FieldRenderCtx = {
    id: 'rf-doc',
    invalid: nothing,
    describedBy: nothing,
    values: {},
    files,
    uploading,
    onInput: () => {},
    setValue: () => {},
    ph: (_f, fallback) => fallback,
    adorn: (_f, control) => control,
    requestUpdate: () => render(renderFile(f, ctx), host),
    numberFocus: new Set<string>(),
    selectUi: new Map(),
  };
  render(renderFile(f, ctx), host);
  return { host, ctx };
}

/** Simulate a native pick: stamp `input.files` then fire change. */
function pick(host: HTMLElement, chosen: File[]): void {
  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: chosen, configurable: true });
  input.dispatchEvent(new Event('change'));
}

const png = (name: string): File => new File(['x'], name, { type: 'image/png' });
const pdf = (name: string): File => new File(['x'], name, { type: 'application/pdf' });
const txt = (name: string): File => new File(['x'], name, { type: 'text/plain' });

describe('renderFile single-file (legacy) shape', () => {
  it('renders a bare file input with no dropzone wrapper', () => {
    const { host } = harness(field());
    expect(host.querySelector('.rf-filefield')).toBeNull();
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.hasAttribute('multiple')).toBe(false);
  });
});

describe('renderFile thumbnail object URLs', () => {
  it('memoizes the thumbnail url so re-renders reuse it (no flicker, no leak)', () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    const { host, ctx } = harness(field({ maxFiles: 3 }));
    pick(host, [png('a.png')]);
    expect(create).toHaveBeenCalledTimes(1);
    // Two unrelated re-renders must not decode the blob again.
    ctx.requestUpdate();
    ctx.requestUpdate();
    expect(create).toHaveBeenCalledTimes(1);
    expect(host.querySelector('img.rf-file-thumb')?.getAttribute('src')).toMatch(/^blob:/);
    create.mockRestore();
  });

  it('revokes the object url when its row is removed', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { host } = harness(field({ maxFiles: 3 }));
    pick(host, [png('a.png')]);
    (host.querySelector('.rf-file-remove') as HTMLButtonElement).click();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.rf-file')).toHaveLength(0);
    revoke.mockRestore();
  });
});

describe('renderFile over-limit feedback', () => {
  it('warns and truncates when more than maxFiles are picked', () => {
    const { host } = harness(field({ maxFiles: 2 }));
    pick(host, [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);
    expect(host.querySelectorAll('.rf-file')).toHaveLength(2);
    expect(host.querySelector('.rf-file-notice')?.textContent).toContain('Only 2 files allowed');
  });

  it('shows no notice when the pick fits under the limit', () => {
    const { host } = harness(field({ maxFiles: 3 }));
    pick(host, [pdf('a.pdf')]);
    expect(host.querySelector('.rf-file-notice')).toBeNull();
    expect(host.querySelector('.rf-file-hint')?.textContent).toContain('1/3 selected');
  });
});

describe('renderFile add-time rejection', () => {
  it('rejects a wrong-type file at add time, keeps the good one, and names the bad one', () => {
    const { host } = harness(field({ maxFiles: 3 }));
    pick(host, [pdf('ok.pdf'), txt('bad.txt')]);
    // Only the valid file is added — the rejected one never appears "accepted".
    expect(host.querySelectorAll('.rf-file')).toHaveLength(1);
    expect(host.querySelector('.rf-file-name')?.textContent).toBe('ok.pdf');
    const notice = host.querySelector('.rf-file-notice');
    expect(notice?.textContent).toContain("Couldn't add");
    expect(notice?.textContent).toContain('bad.txt');
    expect(notice?.textContent).toContain('allowed type');
  });
});

describe('renderFile upload progress bar (B7)', () => {
  it('shows no bar while idle (not uploading), even with files selected', () => {
    const { host } = harness(field({ maxFiles: 3 }));
    pick(host, [pdf('a.pdf')]);
    expect(host.querySelector('.rf-file-progress')).toBeNull();
    // The counter is still present — the bar is additive, not a replacement.
    expect(host.querySelector('.rf-file-hint')?.textContent).toContain('1/3 selected');
  });

  it('shows no bar while uploading when nothing is selected yet', () => {
    const { host } = harness(field({ maxFiles: 3 }), true);
    expect(host.querySelector('.rf-file-progress')).toBeNull();
  });

  it('shows an indeterminate progressbar while uploading selected files', () => {
    const { host } = harness(field({ maxFiles: 3 }), true);
    pick(host, [pdf('a.pdf'), png('b.png')]);
    const bar = host.querySelector('.rf-file-progress');
    expect(bar).not.toBeNull();
    // Indeterminate: role=progressbar with aria-busy and NO aria-valuenow (fetch
    // uploads emit no byte progress, so no faked percentage is claimed).
    expect(bar?.getAttribute('role')).toBe('progressbar');
    expect(bar?.getAttribute('aria-busy')).toBe('true');
    expect(bar?.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar?.querySelector('.rf-file-progress-fill')).not.toBeNull();
    // Counter stays alongside the bar.
    expect(host.querySelector('.rf-file-hint')?.textContent).toContain('2/3 selected');
  });

  it('clears the bar when uploading ends (done/error re-render)', () => {
    const { host, ctx } = harness(field({ maxFiles: 3 }), true);
    pick(host, [pdf('a.pdf')]);
    expect(host.querySelector('.rf-file-progress')).not.toBeNull();
    // Upload finished: the form leaves the submitting phase.
    ctx.uploading = false;
    ctx.requestUpdate();
    expect(host.querySelector('.rf-file-progress')).toBeNull();
  });
});
