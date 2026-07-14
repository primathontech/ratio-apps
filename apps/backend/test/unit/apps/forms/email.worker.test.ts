import { Logger } from '@nestjs/common';
import { FORMS_EMAIL_RETRY_DELAY_MS } from '@ratio-app/shared/constants/forms-events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormEmailLogRow } from '../../../../src/modules/forms/db/types';
import { createDefaultEmailClient } from '../../../../src/modules/forms/delivery/email.client';
import { FormsEmailService } from '../../../../src/modules/forms/delivery/email.service';
import { FormsEmailWorker } from '../../../../src/modules/forms/delivery/email.worker';
import { makeFakeHandle, type Row } from './fixtures/fake-db';
import { FakeEmailClient, FakeQueueService } from './fixtures/fakes';
import { configRow, contactForm, emailLogRow, MERCHANT_ID, submissionRow } from './fixtures/forms';

const seedRows = (log: Row = emailLogRow()): Record<string, Row[]> => ({
  forms: [contactForm()],
  form_submissions: [submissionRow()],
  form_email_log: [log],
  forms_configs: [configRow()],
});

function setup(seed: Record<string, Row[]>, script: Array<'ok' | 'fail'> = ['ok']) {
  const fake = makeFakeHandle(seed);
  const client = new FakeEmailClient();
  client.script = script;
  const executor = new FormsEmailService(fake.handle, client);
  return { fake, client, executor };
}

describe('FormsEmailService — the notification state machine (AC9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('success → sent; message carries recipient, form name, and the submitted values', async () => {
    const { fake, client, executor } = setup(seedRows());
    await executor.execute(fake.tables.form_email_log?.[0] as FormEmailLogRow);

    expect(fake.tables.form_email_log?.[0]).toMatchObject({ status: 'sent', attempts: 1 });
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]?.to).toBe('owner@merchant.example');
    expect(client.sent[0]?.subject).toContain('Contact us');
    expect(client.sent[0]?.text).toContain('asha@example.com');
  });

  it('first provider failure → pending with next retry +10 min (exactly one retry)', async () => {
    const { fake, executor } = setup(seedRows(), ['fail']);
    await executor.execute(fake.tables.form_email_log?.[0] as FormEmailLogRow);

    const row = fake.tables.form_email_log?.[0];
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row?.nextRetryAt).toEqual(
      new Date(new Date('2026-02-01T12:00:00Z').getTime() + FORMS_EMAIL_RETRY_DELAY_MS),
    );
    expect(FORMS_EMAIL_RETRY_DELAY_MS).toBe(10 * 60_000);
  });

  it('second failure → failed (no further retries)', async () => {
    const { fake, executor } = setup(seedRows(emailLogRow({ attempts: 1 })), ['fail']);
    await executor.execute(fake.tables.form_email_log?.[0] as FormEmailLogRow);
    const row = fake.tables.form_email_log?.[0];
    expect(row).toMatchObject({ status: 'failed', attempts: 2 });
    expect(row?.nextRetryAt).toBeNull();
  });

  it('markBounced flips undelivered rows to bounced and raises the merchant config flag (AC9)', async () => {
    const { fake, executor } = setup(seedRows(emailLogRow({ status: 'sent', nextRetryAt: null })));
    await executor.markBounced(MERCHANT_ID, 'owner@merchant.example');

    expect(fake.tables.form_email_log?.[0]?.status).toBe('bounced');
    expect(fake.tables.forms_configs?.[0]?.emailBounced).toBe(true);
  });

  it('never logs recipient addresses or submission values (PII redaction spy)', async () => {
    const logged: unknown[] = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    const success = setup(seedRows());
    await success.executor.execute(success.fake.tables.form_email_log?.[0] as FormEmailLogRow);
    const failure = setup(seedRows(emailLogRow({ attempts: 1 })), ['fail']);
    await failure.executor.execute(failure.fake.tables.form_email_log?.[0] as FormEmailLogRow);
    await failure.executor.markBounced(MERCHANT_ID, 'owner@merchant.example');

    const allLogs = JSON.stringify(logged);
    expect(allLogs).not.toContain('owner@merchant.example');
    expect(allLogs).not.toContain('asha@example.com');
  });
});

describe('createDefaultEmailClient — provider resolution', () => {
  const savedFrom = process.env.FORMS_EMAIL_FROM;

  afterEach(() => {
    if (savedFrom === undefined) delete process.env.FORMS_EMAIL_FROM;
    else process.env.FORMS_EMAIL_FROM = savedFrom;
  });

  it('FORMS_EMAIL_FROM unset → no-op client that warns exactly once', async () => {
    delete process.env.FORMS_EMAIL_FROM;
    const warn = vi.fn();
    const client = createDefaultEmailClient({ warn } as never);
    await client.send({ to: 'a@b.c', from: 'x@y.z', subject: 's', text: 't' });
    await client.send({ to: 'a@b.c', from: 'x@y.z', subject: 's', text: 't' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('no-op default still lets the executor mark rows sent (local dev)', async () => {
    delete process.env.FORMS_EMAIL_FROM;
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const fake = makeFakeHandle(seedRows());
    const executor = new FormsEmailService(fake.handle); // no injected client
    await executor.execute(fake.tables.form_email_log?.[0] as FormEmailLogRow);
    expect(fake.tables.form_email_log?.[0]?.status).toBe('sent');
  });
});

describe('FormsEmailWorker — SQS drain (TDD §3.7)', () => {
  const savedEnabled = process.env.FORMS_EMAIL_WORKER_ENABLED;
  const savedQueue = process.env.FORMS_EMAIL_QUEUE_URL;

  beforeEach(() => {
    delete process.env.FORMS_EMAIL_QUEUE_URL;
  });

  afterEach(() => {
    if (savedEnabled === undefined) delete process.env.FORMS_EMAIL_WORKER_ENABLED;
    else process.env.FORMS_EMAIL_WORKER_ENABLED = savedEnabled;
    if (savedQueue === undefined) delete process.env.FORMS_EMAIL_QUEUE_URL;
    else process.env.FORMS_EMAIL_QUEUE_URL = savedQueue;
    vi.restoreAllMocks();
  });

  function makeWorker(seed: Record<string, Row[]>, script: Array<'ok' | 'fail'> = ['ok']) {
    const fake = makeFakeHandle(seed);
    const queue = new FakeQueueService();
    const client = new FakeEmailClient();
    client.script = script;
    const executor = new FormsEmailService(fake.handle, client);
    const worker = new FormsEmailWorker(queue.asQueueService(), executor, fake.handle);
    return { worker, queue, fake, client };
  }

  it('stays idle unless FORMS_EMAIL_WORKER_ENABLED=true (self-gating)', () => {
    process.env.FORMS_EMAIL_WORKER_ENABLED = 'false';
    const { worker } = makeWorker(seedRows());
    worker.onModuleInit();
    // biome-ignore lint/suspicious/noExplicitAny: peeking the gate flag
    expect((worker as any).running).toBe(false);
  });

  it('processes a message: loads the row, sends, acks (default queue name)', async () => {
    const { worker, queue, fake, client } = makeWorker(seedRows());
    queue.toReceive.push([{ body: { emailLogId: 1 }, receiptHandle: 'r1' }]);
    await worker.drainOnce();

    expect(fake.tables.form_email_log?.[0]?.status).toBe('sent');
    expect(client.sent).toHaveLength(1);
    expect(queue.acked).toEqual([{ name: 'forms-email-notification', receiptHandles: ['r1'] }]);
  });

  it('skips (but acks) settled rows — redelivery is idempotent', async () => {
    const { worker, queue, client } = makeWorker(seedRows(emailLogRow({ status: 'sent' })));
    queue.toReceive.push([{ body: { emailLogId: 1 }, receiptHandle: 'r1' }]);
    await worker.drainOnce();
    expect(client.sent).toHaveLength(0);
    expect(queue.acked).toHaveLength(1);
  });
});
