import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateFileExists } from '../../../../src/modules/forms/submissions/fields/file/validate';
import { FormsS3Service } from '../../../../src/modules/forms/uploads/s3.service';
import { FakeS3Service } from './fixtures/fakes';

const savedEnv = { bucket: process.env.FORMS_S3_BUCKET, region: process.env.FORMS_S3_REGION };
beforeEach(() => {
  process.env.FORMS_S3_BUCKET = 'ratio-forms-uploads';
  process.env.FORMS_S3_REGION = 'ap-south-1';
});
afterEach(() => {
  if (savedEnv.bucket === undefined) delete process.env.FORMS_S3_BUCKET;
  else process.env.FORMS_S3_BUCKET = savedEnv.bucket;
  if (savedEnv.region === undefined) delete process.env.FORMS_S3_REGION;
  else process.env.FORMS_S3_REGION = savedEnv.region;
});

describe('FormsS3Service.exists (P2-2)', () => {
  it('passes bucket/key through to a single core HEAD and returns its verdict', async () => {
    const core = new FakeS3Service();
    core.headResult = true;
    const s3 = new FormsS3Service(core.asS3Service());
    await expect(s3.exists('m_1/form_x/draft_a/resume')).resolves.toBe(true);
    expect(core.heads).toHaveLength(1);
    expect(core.heads[0]).toEqual({
      bucket: 'ratio-forms-uploads',
      key: 'm_1/form_x/draft_a/resume',
    });
  });

  it('returns false when the object is absent', async () => {
    const core = new FakeS3Service();
    core.headResult = false;
    const s3 = new FormsS3Service(core.asS3Service());
    await expect(s3.exists('m_1/form_x/draft_a/resume')).resolves.toBe(false);
  });
});

describe('validateFileExists (P2-2)', () => {
  it('accepts a key that resolves to a real object', async () => {
    const s3 = { exists: vi.fn(async () => true) };
    await expect(validateFileExists('m_1/form_x/draft_a/resume', s3)).resolves.toBeNull();
  });

  it('rejects a fabricated (well-formed but non-existent) key', async () => {
    const s3 = { exists: vi.fn(async () => false) };
    await expect(validateFileExists('m_1/form_x/draft_a/resume', s3)).resolves.toBe(
      'The uploaded file could not be found.',
    );
  });

  it('performs exactly one existence check per key', async () => {
    const exists = vi.fn(async () => true);
    await validateFileExists('m_1/form_x/draft_a/resume', { exists });
    expect(exists).toHaveBeenCalledTimes(1);
  });
});
