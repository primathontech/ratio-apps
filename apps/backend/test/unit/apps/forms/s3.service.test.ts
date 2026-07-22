import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitRateLimitService } from '../../../../src/modules/forms/spam/submit-rate-limit.service';
import type { SubmissionsService } from '../../../../src/modules/forms/submissions/submissions.service';
import {
  FORMS_SIGNED_GET_EXPIRY_SECONDS,
  FORMS_UPLOAD_PUT_EXPIRY_SECONDS,
  FormsS3Service,
} from '../../../../src/modules/forms/uploads/s3.service';
import { UploadsController } from '../../../../src/modules/forms/uploads/uploads.controller';
import { FakeS3Presigner } from './fixtures/fakes';
import { KITCHEN_SINK_FIELDS, kitchenSinkForm, MERCHANT_ID } from './fixtures/forms';

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

describe('FormsS3Service (TDD §3.6)', () => {
  it('presigned PUT carries bucket/region from env, the draft-scoped key, content type + length, 15-min expiry', async () => {
    const presigner = new FakeS3Presigner();
    const service = new FormsS3Service(presigner);
    const { uploadUrl, objectKey } = await service.createUpload({
      merchantId: MERCHANT_ID,
      formId: 'form_sink',
      fieldKey: 'resume',
      contentType: 'application/pdf',
      size: 1024,
    });

    expect(objectKey).toMatch(/^m_1\/form_sink\/draft_[A-Za-z0-9_-]+\/resume$/);
    expect(uploadUrl).toContain(objectKey);
    expect(presigner.puts).toHaveLength(1);
    expect(presigner.puts[0]).toMatchObject({
      bucket: 'ratio-forms-uploads',
      region: 'ap-south-1',
      contentType: 'application/pdf',
      contentLength: 1024,
      expiresInSeconds: FORMS_UPLOAD_PUT_EXPIRY_SECONDS,
    });
  });

  it('signed GET expiry is 7 days', async () => {
    const presigner = new FakeS3Presigner();
    const service = new FormsS3Service(presigner);
    await service.signedGetUrl('m_1/form_sink/draft_x/resume');
    expect(presigner.gets[0]?.expiresInSeconds).toBe(FORMS_SIGNED_GET_EXPIRY_SECONDS);
    expect(FORMS_SIGNED_GET_EXPIRY_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('signed GET forces attachment content-disposition (P2-3 XSS-on-download guard)', async () => {
    const presigner = new FakeS3Presigner();
    const service = new FormsS3Service(presigner);
    await service.signedGetUrl('m_1/form_sink/draft_x/resume');
    expect(presigner.gets[0]?.responseContentDisposition).toBe('attachment');
  });

  it('mints a fresh draft id per upload (no key reuse)', async () => {
    const presigner = new FakeS3Presigner();
    const service = new FormsS3Service(presigner);
    const params = {
      merchantId: MERCHANT_ID,
      formId: 'form_sink',
      fieldKey: 'resume',
      contentType: 'application/pdf',
      size: 1,
    };
    const a = await service.createUpload(params);
    const b = await service.createUpload(params);
    expect(a.objectKey).not.toBe(b.objectKey);
  });

  it('is disabled when FORMS_S3_BUCKET is unset', () => {
    delete process.env.FORMS_S3_BUCKET;
    expect(new FormsS3Service(new FakeS3Presigner()).enabled).toBe(false);
  });
});

describe('UploadsController — public presign endpoint (AC7/F2/F3)', () => {
  function setup(overrides: { s3?: FormsS3Service } = {}) {
    const presigner = new FakeS3Presigner();
    const s3 = overrides.s3 ?? new FormsS3Service(presigner);
    const rateLimit = { allow: vi.fn(async () => true) };
    const submissions = {
      loadActiveForm: vi.fn(async () => ({
        form: kitchenSinkForm(),
        config: {},
        schema: KITCHEN_SINK_FIELDS,
      })),
    };
    const controller = new UploadsController(
      s3,
      submissions as unknown as SubmissionsService,
      rateLimit as unknown as SubmitRateLimitService,
    );
    const req = { ip: '203.0.113.9' } as never;
    return { controller, presigner, rateLimit, submissions, req };
  }

  const validBody = { fieldKey: 'resume', contentType: 'application/pdf', size: 1024 };

  async function expectStatus(promise: Promise<unknown>, status: number, code?: string) {
    try {
      await promise;
      expect.unreachable(`expected HTTP ${status}`);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(status);
      if (code) {
        expect(((err as HttpException).getResponse() as { error_code?: string }).error_code).toBe(
          code,
        );
      }
    }
  }

  it('presigns a valid request for a file field', async () => {
    const { controller, req } = setup();
    const result = await controller.createUpload('form_sink', validBody, req);
    expect(result.uploadUrl).toContain(result.objectKey);
    expect(result.objectKey.startsWith(`${MERCHANT_ID}/form_sink/`)).toBe(true);
  });

  it('503 uploads_unavailable when no bucket is configured (local dev no-op)', async () => {
    delete process.env.FORMS_S3_BUCKET;
    const { controller, req, submissions } = setup();
    await expectStatus(
      controller.createUpload('form_sink', validBody, req),
      503,
      'uploads_unavailable',
    );
    expect(submissions.loadActiveForm).not.toHaveBeenCalled();
  });

  it('429 when the app-level (form, IP) limiter rejects — before touching the form', async () => {
    const { controller, req, rateLimit, submissions } = setup();
    rateLimit.allow.mockResolvedValueOnce(false);
    await expectStatus(controller.createUpload('form_sink', validBody, req), 429);
    expect(submissions.loadActiveForm).not.toHaveBeenCalled();
  });

  it('422 for a non-file / unknown field key', async () => {
    const { controller, req } = setup();
    await expectStatus(
      controller.createUpload('form_sink', { ...validBody, fieldKey: 'name' }, req),
      422,
    );
    await expectStatus(
      controller.createUpload('form_sink', { ...validBody, fieldKey: 'ghost' }, req),
      422,
    );
  });

  it('422 for a content type outside the field/platform allowlist (F2)', async () => {
    const { controller, req } = setup();
    // image/png is platform-allowed but NOT in the resume field's allowlist.
    await expectStatus(
      controller.createUpload('form_sink', { ...validBody, contentType: 'image/png' }, req),
      422,
    );
    await expectStatus(
      controller.createUpload(
        'form_sink',
        { ...validBody, contentType: 'application/x-msdownload' },
        req,
      ),
      422,
    );
  });

  it('413 for a size above min(field maxBytes, 5MB) (F3)', async () => {
    const { controller, req } = setup();
    // resume field caps at 1 MB.
    await expectStatus(
      controller.createUpload('form_sink', { ...validBody, size: 1024 * 1024 + 1 }, req),
      413,
    );
  });
});
