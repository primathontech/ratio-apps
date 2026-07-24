import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsvExportService } from '../../../../src/modules/forms/submissions/csv-export.service';
import { FormsExportWorker } from '../../../../src/modules/forms/submissions/forms-export.worker';
import { SubmissionsService } from '../../../../src/modules/forms/submissions/submissions.service';
import { FormsS3Service } from '../../../../src/modules/forms/uploads/s3.service';
import { makeFakeHandle, type Row } from './fixtures/fake-db';
import { FakeQueueService, FakeS3Presigner, FakeS3Uploader } from './fixtures/fakes';
import { contactForm, MERCHANT_ID, submissionRow } from './fixtures/forms';

function setup(seed: Record<string, Row[]>) {
  const fake = makeFakeHandle(seed);
  const submissions = new SubmissionsService(
    fake.handle,
    // biome-ignore lint/suspicious/noExplicitAny: only requireOwnForm is used
    ...([{}, {}, {}, {}, {}] as any[]),
  );
  const csv = new CsvExportService(fake.handle, submissions);
  const uploader = new FakeS3Uploader();
  const s3 = new FormsS3Service(new FakeS3Presigner(), uploader);
  const queue = new FakeQueueService();
  const worker = new FormsExportWorker(queue.asQueueService(), csv, s3, fake.handle);
  return { worker, queue, fake, uploader };
}

const pendingJob = (overrides: Row = {}): Row => ({
  id: 'exp_1',
  formId: 'form_contact',
  merchantId: MERCHANT_ID,
  status: 'pending',
  s3Key: null,
  rowCount: null,
  error: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
  updatedAt: new Date('2026-03-01T00:00:00Z'),
  ...overrides,
});

const twoSubmissions = () => [
  submissionRow({ id: 'sub_1', idempotencyKey: 'k1', createdAt: new Date('2026-02-01T10:00:00Z') }),
  submissionRow({
    id: 'sub_2',
    idempotencyKey: 'k2',
    dataJson: JSON.stringify({ name: 'Ravi', email: 'ravi@example.com', message: 'Yo' }),
    createdAt: new Date('2026-02-01T11:00:00Z'),
  }),
];

describe('FormsExportWorker — SQS drain → S3 stream', () => {
  const savedEnabled = process.env.FORMS_EXPORT_WORKER_ENABLED;
  const savedQueue = process.env.FORMS_EXPORT_QUEUE_URL;
  const savedBucket = process.env.FORMS_S3_BUCKET;
  const savedRegion = process.env.FORMS_S3_REGION;

  beforeEach(() => {
    delete process.env.FORMS_EXPORT_QUEUE_URL;
    process.env.FORMS_S3_BUCKET = 'ratio-forms-uploads';
    process.env.FORMS_S3_REGION = 'ap-south-1';
  });

  afterEach(() => {
    for (const [key, val] of [
      ['FORMS_EXPORT_WORKER_ENABLED', savedEnabled],
      ['FORMS_EXPORT_QUEUE_URL', savedQueue],
      ['FORMS_S3_BUCKET', savedBucket],
      ['FORMS_S3_REGION', savedRegion],
    ] as const) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    vi.restoreAllMocks();
  });

  it('stays idle unless FORMS_EXPORT_WORKER_ENABLED=true (self-gating)', () => {
    process.env.FORMS_EXPORT_WORKER_ENABLED = 'false';
    const { worker, queue } = setup({});
    worker.onModuleInit();
    // biome-ignore lint/suspicious/noExplicitAny: peeking the gate flag
    expect((worker as any).running).toBe(false);
    expect(queue.toReceive).toHaveLength(0);
  });

  it('processing → ready: streams to the right S3 key, records row_count, acks', async () => {
    const { worker, queue, fake, uploader } = setup({
      forms: [contactForm()],
      form_submissions: twoSubmissions(),
      form_export_jobs: [pendingJob()],
    });
    queue.toReceive.push([{ body: { jobId: 'exp_1' }, receiptHandle: 'r1' }]);

    await worker.drainOnce();

    const job = fake.tables.form_export_jobs?.[0];
    expect(job).toMatchObject({
      status: 'ready',
      s3Key: 'm_1/form_contact/exports/exp_1.csv',
      rowCount: 2,
    });
    // Exactly one object uploaded, at the deterministic key, CSV content type.
    expect(uploader.uploads).toHaveLength(1);
    expect(uploader.uploads[0]).toMatchObject({
      key: 'm_1/form_contact/exports/exp_1.csv',
      contentType: 'text/csv; charset=utf-8',
    });
    // Body is the streamed CSV: header + one line per submission.
    const lines = uploader.uploads[0]?.body.trimEnd().split('\n') ?? [];
    expect(lines[0]).toBe('name,email,message,submitted_at');
    expect(lines).toHaveLength(3);
    // Settled → acked.
    expect(queue.acked).toEqual([{ name: 'forms-export', receiptHandles: ['r1'] }]);
  });

  it('failure → failed with a short error, and the message is still acked (terminal)', async () => {
    const { worker, queue, fake, uploader } = setup({
      forms: [contactForm()],
      form_submissions: twoSubmissions(),
      form_export_jobs: [pendingJob()],
    });
    uploader.fail = true;
    queue.toReceive.push([{ body: { jobId: 'exp_1' }, receiptHandle: 'r1' }]);

    await worker.drainOnce();

    const job = fake.tables.form_export_jobs?.[0];
    expect(job?.status).toBe('failed');
    expect(typeof job?.error).toBe('string');
    expect((job?.error as string).length).toBeLessThanOrEqual(512);
    expect(uploader.uploads).toHaveLength(0);
    // Terminal outcome lives in the row → the message is acked, not redelivered.
    expect(queue.acked).toEqual([{ name: 'forms-export', receiptHandles: ['r1'] }]);
  });

  it('skips (but acks) a job that is no longer pending — redelivery is idempotent', async () => {
    const { worker, queue, fake, uploader } = setup({
      forms: [contactForm()],
      form_submissions: twoSubmissions(),
      form_export_jobs: [pendingJob({ status: 'ready', s3Key: 'x', rowCount: 2 })],
    });
    queue.toReceive.push([{ body: { jobId: 'exp_1' }, receiptHandle: 'r1' }]);
    await worker.drainOnce();
    expect(uploader.uploads).toHaveLength(0);
    expect(fake.tables.form_export_jobs?.[0]?.status).toBe('ready'); // untouched
    expect(queue.acked).toHaveLength(1);
  });

  it('acks and drops a message whose job row has vanished', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { worker, queue, uploader } = setup({ form_export_jobs: [] });
    queue.toReceive.push([{ body: { jobId: 'gone' }, receiptHandle: 'r9' }]);
    await worker.drainOnce();
    expect(uploader.uploads).toHaveLength(0);
    expect(queue.acked).toHaveLength(1);
  });

  it('honors FORMS_EXPORT_QUEUE_URL for the queue identity', async () => {
    process.env.FORMS_EXPORT_QUEUE_URL =
      'https://sqs.ap-south-1.amazonaws.com/123/forms-export-prod';
    const { worker, queue } = setup({
      forms: [contactForm()],
      form_submissions: twoSubmissions(),
      form_export_jobs: [pendingJob()],
    });
    queue.toReceive.push([{ body: { jobId: 'exp_1' }, receiptHandle: 'r1' }]);
    await worker.drainOnce();
    expect(queue.acked[0]?.name).toBe('forms-export-prod');
  });

  it('never logs submission PII (ids/counts/status only)', async () => {
    const logged: unknown[] = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    // Success path.
    const ok = setup({
      forms: [contactForm()],
      form_submissions: twoSubmissions(),
      form_export_jobs: [pendingJob()],
    });
    ok.queue.toReceive.push([{ body: { jobId: 'exp_1' }, receiptHandle: 'r1' }]);
    await ok.worker.drainOnce();
    // Failure path.
    const bad = setup({
      forms: [contactForm()],
      form_submissions: twoSubmissions(),
      form_export_jobs: [pendingJob()],
    });
    bad.uploader.fail = true;
    bad.queue.toReceive.push([{ body: { jobId: 'exp_1' }, receiptHandle: 'r1' }]);
    await bad.worker.drainOnce();

    const allLogs = JSON.stringify(logged);
    expect(allLogs).not.toContain('asha@example.com');
    expect(allLogs).not.toContain('Asha');
    expect(allLogs).not.toContain('ravi@example.com');
  });
});
