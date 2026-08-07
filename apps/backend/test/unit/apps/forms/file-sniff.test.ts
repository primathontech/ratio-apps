import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FILE_SNIFF_BYTES,
  sniffContentType,
  validateFileType,
} from '../../../../src/modules/forms/submissions/fields/file/sniff';
import { FormsS3Service } from '../../../../src/modules/forms/uploads/s3.service';
import { FakeS3Service } from './fixtures/fakes';

/** Genuine head bytes for each accepted type (magic number + a little padding). */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = new Uint8Array([
  0x52,
  0x49,
  0x46,
  0x46, // "RIFF"
  0x24,
  0x00,
  0x00,
  0x00, // chunk size (skipped)
  0x57,
  0x45,
  0x42,
  0x50, // "WEBP"
]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"

describe('sniffContentType (P2-3 magic bytes)', () => {
  it('identifies each accepted type from its magic bytes', () => {
    expect(sniffContentType(JPEG)).toBe('image/jpeg');
    expect(sniffContentType(PNG)).toBe('image/png');
    expect(sniffContentType(WEBP)).toBe('image/webp');
    expect(sniffContentType(PDF)).toBe('application/pdf');
  });

  it('does not mistake a RIFF container that is not WEBP (e.g. WAV) for an image', () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]); // "RIFF"…"WAVE"
    expect(sniffContentType(wav)).toBeNull();
  });

  it('returns null for random / unknown / empty bytes', () => {
    expect(sniffContentType(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
    expect(sniffContentType(new Uint8Array(0))).toBeNull();
  });

  it('needs the full signature — a truncated PNG header does not match', () => {
    expect(sniffContentType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
  });
});

describe('validateFileType (P2-3 allowlist enforcement)', () => {
  const allowAll = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

  it('accepts a genuine file whose bytes match an allowed type', () => {
    expect(validateFileType(allowAll, PNG)).toBeNull();
    expect(validateFileType(['application/pdf'], PDF)).toBeNull();
  });

  it('REJECTS a spoofed upload: declared image/png but the bytes are a PDF', () => {
    // The field only allows image/png; the stored object is really a PDF.
    expect(validateFileType(['image/png'], PDF)).toBe('This file type is not allowed.');
  });

  it('REJECTS random/executable-looking bytes that match no known signature', () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]); // ELF header
    expect(validateFileType(allowAll, elf)).toBe('This file type is not allowed.');
  });

  it('REJECTS a real type that is not in THIS field allowlist (PNG where only PDF is allowed)', () => {
    expect(validateFileType(['application/pdf'], PNG)).toBe('This file type is not allowed.');
  });

  it('fails closed on empty bytes (unreadable object)', () => {
    expect(validateFileType(allowAll, new Uint8Array(0))).toBe('This file type is not allowed.');
  });
});

const savedBucket = process.env.S3_BUCKET;
beforeEach(() => {
  process.env.S3_BUCKET = 'ratio-forms-uploads';
});
afterEach(() => {
  if (savedBucket === undefined) delete process.env.S3_BUCKET;
  else process.env.S3_BUCKET = savedBucket;
});

describe('FormsS3Service.readHeadBytes (P2-3)', () => {
  it('ranged-GETs the head bytes of the object through the core seam', async () => {
    const core = new FakeS3Service();
    core.bytesByKey.set('m_1/form_x/draft_a/resume', PNG);
    const s3 = new FormsS3Service(core.asS3Service());

    const bytes = await s3.readHeadBytes('m_1/form_x/draft_a/resume', FILE_SNIFF_BYTES);

    expect(sniffContentType(bytes)).toBe('image/png');
    expect(core.rangeGets).toEqual([
      { bucket: 'ratio-forms-uploads', key: 'm_1/form_x/draft_a/resume', length: FILE_SNIFF_BYTES },
    ]);
  });
});
