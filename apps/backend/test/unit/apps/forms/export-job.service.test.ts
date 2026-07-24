import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExportJobService } from '../../../../src/modules/forms/submissions/export-job.service';
import { SubmissionsService } from '../../../../src/modules/forms/submissions/submissions.service';
import {
  FORMS_EXPORT_GET_EXPIRY_SECONDS,
  FormsS3Service,
} from '../../../../src/modules/forms/uploads/s3.service';
import { makeFakeHandle, type Row } from './fixtures/fake-db';
import { FakeQueueService, FakeS3Presigner } from './fixtures/fakes';
import { contactForm, MERCHANT_ID, OTHER_MERCHANT_ID } from './fixtures/forms';

function setup(seed: Record<string, Row[]>) {
  const fake = makeFakeHandle(seed);
  const submissions = new SubmissionsService(
    fake.handle,
    // biome-ignore lint/suspicious/noExplicitAny: only requireOwnForm is used
    ...([{}, {}, {}, {}, {}] as any[]),
  );
  const queue = new FakeQueueService();
  const presigner = new FakeS3Presigner();
  const s3 = new FormsS3Service(presigner);
  const service = new ExportJobService(fake.handle, submissions, queue.asQueueService(), s3);
  return { service, fake, queue, presigner };
}

const savedEnv = {
  bucket: process.env.FORMS_S3_BUCKET,
  region: process.env.FORMS_S3_REGION,
  queue: process.env.FORMS_EXPORT_QUEUE_URL,
};

beforeEach(() => {
  process.env.FORMS_S3_BUCKET = 'ratio-forms-uploads';
  process.env.FORMS_S3_REGION = 'ap-south-1';
  process.env.FORMS_EXPORT_QUEUE_URL = 'forms-export';
});

afterEach(() => {
  for (const [key, val] of [
    ['FORMS_S3_BUCKET', savedEnv.bucket],
    ['FORMS_S3_REGION', savedEnv.region],
    ['FORMS_EXPORT_QUEUE_URL', savedEnv.queue],
  ] as const) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

describe('ExportJobService — async CSV export orchestration', () => {
  it('createJob inserts a pending row and enqueues the job id', async () => {
    const { service, fake, queue } = setup({ forms: [contactForm()] });
    const job = await service.createJob(MERCHANT_ID, 'form_contact');

    expect(job.id).toMatch(/^exp_[A-Za-z0-9_-]+$/);
    expect(job.status).toBe('pending');
    // Row persisted.
    const rows = fake.tables.form_export_jobs ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: job.id,
      formId: 'form_contact',
      merchantId: MERCHANT_ID,
      status: 'pending',
    });
    // Exactly one message enqueued, carrying only the job id.
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0]).toEqual({ name: 'forms-export', payloads: [{ jobId: job.id }] });
  });

  it('createJob → 404 for a form the merchant does not own (before any enqueue)', async () => {
    const { service, queue } = setup({ forms: [contactForm()] });
    await expect(service.createJob(OTHER_MERCHANT_ID, 'form_contact')).rejects.toSatisfy(
      (err: unknown) => (err as HttpException).getStatus() === 404,
    );
    expect(queue.sent).toHaveLength(0);
  });

  it('createJob → 503 exports_unavailable when the bucket is unset', async () => {
    delete process.env.FORMS_S3_BUCKET;
    const { service, fake, queue } = setup({ forms: [contactForm()] });
    await expect(service.createJob(MERCHANT_ID, 'form_contact')).rejects.toSatisfy(
      (err: unknown) =>
        (err as HttpException).getStatus() === 503 &&
        ((err as HttpException).getResponse() as { error_code?: string }).error_code ===
          'exports_unavailable',
    );
    expect(fake.tables.form_export_jobs ?? []).toHaveLength(0);
    expect(queue.sent).toHaveLength(0);
  });

  it('createJob → 503 exports_unavailable when the queue URL is unset', async () => {
    delete process.env.FORMS_EXPORT_QUEUE_URL;
    const { service } = setup({ forms: [contactForm()] });
    await expect(service.createJob(MERCHANT_ID, 'form_contact')).rejects.toSatisfy(
      (err: unknown) => (err as HttpException).getStatus() === 503,
    );
  });

  it('getJob returns status only while pending/processing (no download URL)', async () => {
    const { service, presigner } = setup({
      form_export_jobs: [
        { id: 'exp_1', formId: 'form_contact', merchantId: MERCHANT_ID, status: 'processing' },
      ],
    });
    const view = await service.getJob(MERCHANT_ID, 'form_contact', 'exp_1');
    expect(view).toEqual({ status: 'processing' });
    expect(presigner.gets).toHaveLength(0);
  });

  it('getJob on a ready job mints a 1-hour signed download URL from the s3_key', async () => {
    const { service, presigner } = setup({
      form_export_jobs: [
        {
          id: 'exp_1',
          formId: 'form_contact',
          merchantId: MERCHANT_ID,
          status: 'ready',
          s3Key: 'm_1/form_contact/exports/exp_1.csv',
          rowCount: 42,
        },
      ],
    });
    const view = await service.getJob(MERCHANT_ID, 'form_contact', 'exp_1');
    expect(view.status).toBe('ready');
    expect(view.rowCount).toBe(42);
    expect(view.downloadUrl).toBe('https://fake-s3/m_1/form_contact/exports/exp_1.csv?sig=get');
    expect(presigner.gets[0]).toMatchObject({
      key: 'm_1/form_contact/exports/exp_1.csv',
      expiresInSeconds: FORMS_EXPORT_GET_EXPIRY_SECONDS,
    });
  });

  it('getJob is merchant-scoped: another merchant’s job → 404', async () => {
    const { service } = setup({
      form_export_jobs: [
        {
          id: 'exp_1',
          formId: 'form_contact',
          merchantId: MERCHANT_ID,
          status: 'ready',
          s3Key: 'm_1/form_contact/exports/exp_1.csv',
        },
      ],
    });
    await expect(service.getJob(OTHER_MERCHANT_ID, 'form_contact', 'exp_1')).rejects.toSatisfy(
      (err: unknown) => (err as HttpException).getStatus() === 404,
    );
  });
});
