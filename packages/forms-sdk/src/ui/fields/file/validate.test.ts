import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { fileRejection, validateFile } from './validate';

const field = (overrides: Partial<ControlFieldOf<'file'>> = {}): ControlFieldOf<'file'> =>
  ({
    key: 'doc',
    type: 'file',
    label: 'Attachment',
    required: false,
    validation: { allowedMimeTypes: ['application/pdf'], maxBytes: 1024 },
    ...overrides,
  }) as ControlFieldOf<'file'>;

const ctx = (files: File[]): FieldValidateCtx => ({ values: {}, files: { doc: files } });

const file = (name: string, type: string, size: number): File => {
  const f = new File(['x'], name, { type });
  // File.size is read-only; force it so we can exercise the byte-cap branch.
  Object.defineProperty(f, 'size', { value: size, configurable: true });
  return f;
};

describe('fileRejection', () => {
  it('passes a file within the mime allowlist and byte cap', () => {
    expect(fileRejection(field(), file('cv.pdf', 'application/pdf', 512))).toBeNull();
  });

  it('flags a wrong mime with the "allowed type" phrasing', () => {
    const reason = fileRejection(field(), file('note.txt', 'text/plain', 10));
    expect(reason).toContain('allowed type');
    expect(reason).toContain('application/pdf');
  });

  it('flags an oversize file with the "at most" phrasing', () => {
    expect(fileRejection(field(), file('big.pdf', 'application/pdf', 4096))).toContain('at most');
  });

  it('checks mime before size (wrong-and-oversize reports the type)', () => {
    expect(fileRejection(field(), file('big.txt', 'text/plain', 4096))).toContain('allowed type');
  });

  it('skips the mime check when no allowlist is configured', () => {
    const f = field({ validation: { maxBytes: 1024 } as never });
    expect(fileRejection(f, file('anything.bin', 'application/octet-stream', 10))).toBeNull();
  });
});

describe('validateFile', () => {
  it('honors required vs optional on empty', () => {
    expect(validateFile(field({ required: true }), ctx([]))).toBe('Please attach a file.');
    expect(validateFile(field({ required: false }), ctx([]))).toBeNull();
  });

  it('accepts a valid single file', () => {
    expect(validateFile(field(), ctx([file('cv.pdf', 'application/pdf', 512)]))).toBeNull();
  });

  it('enforces the maxFiles count', () => {
    const two = [file('a.pdf', 'application/pdf', 10), file('b.pdf', 'application/pdf', 10)];
    expect(validateFile(field(), ctx(two))).toBe('Please attach a single file.');
    expect(validateFile(field({ maxFiles: 1 }), ctx(two))).toBe('Please attach a single file.');
    expect(validateFile(field({ maxFiles: 2 }), ctx(two))).toBeNull();
  });

  it('NAMES the single offending file', () => {
    const msg = validateFile(field(), ctx([file('resume.txt', 'text/plain', 10)]));
    expect(msg).toContain('resume.txt');
    expect(msg).toContain('allowed type');
  });

  it('NAMES every offending file when several are bad', () => {
    const bad = [file('a.txt', 'text/plain', 10), file('big.pdf', 'application/pdf', 4096)];
    const msg = validateFile(field({ maxFiles: 2 }), ctx(bad));
    expect(msg).toContain('a.txt');
    expect(msg).toContain('big.pdf');
    expect(msg).toContain('these files');
  });
});
