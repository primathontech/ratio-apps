import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException, Logger } from '@nestjs/common';
import { formSubmittedPayloadSchema } from '@ratio-app/shared/constants/forms-events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormWebhookDeliveryRow } from '../../../../src/modules/forms/db/types';
import { WebhookDeliveryService } from '../../../../src/modules/forms/delivery/webhook-delivery.service';
import { WebhookDeliveryWorker } from '../../../../src/modules/forms/delivery/webhook-delivery.worker';
import type { FormsS3Service } from '../../../../src/modules/forms/uploads/s3.service';
import { makeFakeHandle, type Row } from './fixtures/fake-db';
import { FakeQueueService, fakeDeliveryFetch } from './fixtures/fakes';
import { contactForm, deliveryRow, kitchenSinkForm, submissionRow } from './fixtures/forms';

const GOLDEN_PAYLOAD = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/webhook-payload.json'), 'utf8'),
);

const fakeS3 = {
  signedGetUrl: async (key: string) => `https://fake-s3/${key}?sig=get`,
} as unknown as FormsS3Service;

function setup(seed: Record<string, Row[]>, script: Array<number | 'network-error'>) {
  const fake = makeFakeHandle(seed);
  const { fetch, calls } = fakeDeliveryFetch(script);
  const executor = new WebhookDeliveryService(fake.handle, fakeS3, fetch);
  return { fake, executor, calls };
}

const seedWithSubmission = (delivery: Row = deliveryRow()): Record<string, Row[]> => ({
  forms: [contactForm()],
  form_submissions: [
    submissionRow({
      filesJson: JSON.stringify({ resume: 'm_1/form_contact/draft_abc/resume' }),
    }),
  ],
  form_webhook_deliveries: [delivery],
});

describe('WebhookDeliveryService — the retry state machine (AC10)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('POSTs the golden form.submitted payload (contract incl. schema_version, file fields as signed URLs)', async () => {
    const { executor, calls, fake } = setup(seedWithSubmission(), [200]);
    await executor.execute(fake.tables.form_webhook_deliveries?.[0] as FormWebhookDeliveryRow);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://hooks.merchant.example/forms');
    const payload = JSON.parse(calls[0]?.body ?? '{}');
    expect(payload).toEqual(GOLDEN_PAYLOAD);
    // The golden fixture itself satisfies the shared contract.
    expect(() => formSubmittedPayloadSchema.parse(payload)).not.toThrow();
  });

  it('2xx → delivered with last_status_code stored', async () => {
    const { executor, fake } = setup(seedWithSubmission(), [204]);
    await executor.execute(fake.tables.form_webhook_deliveries?.[0] as FormWebhookDeliveryRow);
    const row = fake.tables.form_webhook_deliveries?.[0];
    expect(row).toMatchObject({ status: 'delivered', attempts: 1, lastStatusCode: 204 });
    expect(row?.nextRetryAt).toBeNull();
  });

  it('non-2xx: attempt 1 → pending +5m, attempt 2 → pending +20m, attempt 3 → failed (ladder 5m/20m/1h)', async () => {
    const base = new Date('2026-02-01T12:00:00Z').getTime();

    const first = setup(seedWithSubmission(deliveryRow({ attempts: 0 })), [500]);
    await first.executor.execute(
      first.fake.tables.form_webhook_deliveries?.[0] as FormWebhookDeliveryRow,
    );
    expect(first.fake.tables.form_webhook_deliveries?.[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatusCode: 500,
    });
    expect(first.fake.tables.form_webhook_deliveries?.[0]?.nextRetryAt).toEqual(
      new Date(base + 5 * 60_000),
    );

    const second = setup(seedWithSubmission(deliveryRow({ attempts: 1 })), [502]);
    await second.executor.execute(
      second.fake.tables.form_webhook_deliveries?.[0] as FormWebhookDeliveryRow,
    );
    expect(second.fake.tables.form_webhook_deliveries?.[0]).toMatchObject({
      status: 'pending',
      attempts: 2,
      lastStatusCode: 502,
    });
    expect(second.fake.tables.form_webhook_deliveries?.[0]?.nextRetryAt).toEqual(
      new Date(base + 20 * 60_000),
    );

    const third = setup(seedWithSubmission(deliveryRow({ attempts: 2 })), [503]);
    await third.executor.execute(
      third.fake.tables.form_webhook_deliveries?.[0] as FormWebhookDeliveryRow,
    );
    expect(third.fake.tables.form_webhook_deliveries?.[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastStatusCode: 503,
    });
    expect(third.fake.tables.form_webhook_deliveries?.[0]?.nextRetryAt).toBeNull();
  });

  it('network error / timeout → retry scheduled with null status code', async () => {
    const { executor, fake } = setup(seedWithSubmission(), ['network-error']);
    await executor.execute(fake.tables.form_webhook_deliveries?.[0] as FormWebhookDeliveryRow);
    expect(fake.tables.form_webhook_deliveries?.[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatusCode: null,
    });
  });

  it('never logs payload bodies (PII redaction spy)', async () => {
    const logged: unknown[] = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    const success = setup(seedWithSubmission(), [200]);
    await success.executor.execute(
      success.fake.tables.form_webhook_deliveries?.[0] as FormWebhookDeliveryRow,
    );
    const failure = setup(seedWithSubmission(deliveryRow({ attempts: 2 })), [500]);
    await failure.executor.execute(
      failure.fake.tables.form_webhook_deliveries?.[0] as FormWebhookDeliveryRow,
    );

    const allLogs = JSON.stringify(logged);
    expect(allLogs).not.toContain('asha@example.com');
    expect(allLogs).not.toContain('Asha');
    expect(allLogs).not.toContain('fake-s3');
  });

  describe('sendTest — the admin "Send test payload" probe (AC10)', () => {
    it('POSTs a schema-valid dummy payload and returns the response code', async () => {
      const { executor, calls } = setup({ forms: [kitchenSinkForm()] }, [201]);
      const result = await executor.sendTest('m_1', 'form_sink');
      expect(result).toEqual({ statusCode: 201 });
      const payload = JSON.parse(calls[0]?.body ?? '{}');
      expect(() => formSubmittedPayloadSchema.parse(payload)).not.toThrow();
      // Dummy values for every schema field.
      expect(Object.keys(payload.fields)).toEqual(
        expect.arrayContaining(['name', 'email', 'phone', 'topic', 'resume']),
      );
    });

    it('returns null when the endpoint is unreachable', async () => {
      const { executor } = setup({ forms: [kitchenSinkForm()] }, ['network-error']);
      expect(await executor.sendTest('m_1', 'form_sink')).toEqual({ statusCode: null });
    });

    it('400 when the form has no webhook URL; 404 cross-merchant', async () => {
      const { executor } = setup({ forms: [contactForm()] }, []);
      await expect(executor.sendTest('m_1', 'form_contact')).rejects.toSatisfy(
        (err: unknown) => (err as HttpException).getStatus() === 400,
      );
      await expect(executor.sendTest('m_other', 'form_contact')).rejects.toSatisfy(
        (err: unknown) => (err as HttpException).getStatus() === 404,
      );
    });
  });
});

describe('WebhookDeliveryWorker — SQS drain (TDD §3.7)', () => {
  const savedEnabled = process.env.FORMS_WEBHOOK_WORKER_ENABLED;
  const savedQueue = process.env.FORMS_WEBHOOK_QUEUE_URL;

  beforeEach(() => {
    delete process.env.FORMS_WEBHOOK_QUEUE_URL;
  });

  afterEach(() => {
    if (savedEnabled === undefined) delete process.env.FORMS_WEBHOOK_WORKER_ENABLED;
    else process.env.FORMS_WEBHOOK_WORKER_ENABLED = savedEnabled;
    if (savedQueue === undefined) delete process.env.FORMS_WEBHOOK_QUEUE_URL;
    else process.env.FORMS_WEBHOOK_QUEUE_URL = savedQueue;
    vi.restoreAllMocks();
  });

  function makeWorker(seed: Record<string, Row[]>, script: Array<number | 'network-error'>) {
    const fake = makeFakeHandle(seed);
    const queue = new FakeQueueService();
    const { fetch, calls } = fakeDeliveryFetch(script);
    const executor = new WebhookDeliveryService(fake.handle, fakeS3, fetch);
    const worker = new WebhookDeliveryWorker(queue.asQueueService(), executor, fake.handle);
    return { worker, queue, fake, calls };
  }

  it('stays idle unless FORMS_WEBHOOK_WORKER_ENABLED=true (self-gating)', () => {
    process.env.FORMS_WEBHOOK_WORKER_ENABLED = 'false';
    const { worker, queue } = makeWorker({}, []);
    worker.onModuleInit();
    // biome-ignore lint/suspicious/noExplicitAny: peeking the gate flag
    expect((worker as any).running).toBe(false);
    expect(queue.toReceive).toHaveLength(0);
  });

  it('processes a message: loads the row, executes the attempt, acks', async () => {
    const { worker, queue, fake } = makeWorker(seedWithSubmission(), [200]);
    queue.toReceive.push([{ body: { deliveryId: 1 }, receiptHandle: 'r1' }]);

    await worker.drainOnce();

    expect(fake.tables.form_webhook_deliveries?.[0]?.status).toBe('delivered');
    expect(queue.acked).toEqual([{ name: 'forms-webhook-delivery', receiptHandles: ['r1'] }]);
  });

  it('skips (but acks) settled rows — redelivery/double-fire is idempotent', async () => {
    const { worker, queue, calls } = makeWorker(
      seedWithSubmission(deliveryRow({ status: 'delivered' })),
      [],
    );
    queue.toReceive.push([{ body: { deliveryId: 1 }, receiptHandle: 'r1' }]);
    await worker.drainOnce();
    expect(calls).toHaveLength(0); // no POST fired
    expect(queue.acked).toHaveLength(1);
  });

  it('acks and drops messages whose row has vanished', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { worker, queue, calls } = makeWorker({}, []);
    queue.toReceive.push([{ body: { deliveryId: 99 }, receiptHandle: 'r9' }]);
    await worker.drainOnce();
    expect(calls).toHaveLength(0);
    expect(queue.acked).toHaveLength(1);
  });

  it('honors FORMS_WEBHOOK_QUEUE_URL for the queue identity', async () => {
    process.env.FORMS_WEBHOOK_QUEUE_URL =
      'https://sqs.ap-south-1.amazonaws.com/123/forms-webhooks-prod';
    const { worker, queue } = makeWorker(seedWithSubmission(), [200]);
    queue.toReceive.push([{ body: { deliveryId: 1 }, receiptHandle: 'r1' }]);
    await worker.drainOnce();
    expect(queue.acked[0]?.name).toBe('forms-webhooks-prod');
  });
});
