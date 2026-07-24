import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeliverySweeperService,
  FORMS_SWEEP_CLAIM_LEASE_MS,
  FORMS_SWEEP_MERCHANT_BATCH_CAP,
} from '../../../../src/modules/forms/delivery/delivery-sweeper.service';
import { type FakeHandle, makeFakeHandle, type Row } from './fixtures/fake-db';
import { FakeQueueService } from './fixtures/fakes';
import { configRow, deliveryRow, emailLogRow, MERCHANT_ID } from './fixtures/forms';

const NOW = new Date('2026-02-01T12:00:00Z');
const PAST = new Date('2026-02-01T11:00:00Z');
const FUTURE = new Date('2026-02-01T13:00:00Z');

const savedEnv = {
  webhooks: process.env.FORMS_WEBHOOK_WORKER_ENABLED,
  emails: process.env.FORMS_EMAIL_WORKER_ENABLED,
  webhookQueue: process.env.FORMS_WEBHOOK_QUEUE_URL,
  emailQueue: process.env.FORMS_EMAIL_QUEUE_URL,
};

function setup(seed: Record<string, Row[]>): {
  sweeper: DeliverySweeperService;
  queue: FakeQueueService;
  fake: FakeHandle;
} {
  const fake = makeFakeHandle(seed);
  const queue = new FakeQueueService();
  const sweeper = new DeliverySweeperService(fake.handle, queue.asQueueService());
  return { sweeper, queue, fake };
}

describe('DeliverySweeperService (TRD §1 — the DB is the scheduler)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.FORMS_WEBHOOK_WORKER_ENABLED = 'true';
    process.env.FORMS_EMAIL_WORKER_ENABLED = 'true';
    delete process.env.FORMS_WEBHOOK_QUEUE_URL;
    delete process.env.FORMS_EMAIL_QUEUE_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const [key, value] of [
      ['FORMS_WEBHOOK_WORKER_ENABLED', savedEnv.webhooks],
      ['FORMS_EMAIL_WORKER_ENABLED', savedEnv.emails],
      ['FORMS_WEBHOOK_QUEUE_URL', savedEnv.webhookQueue],
      ['FORMS_EMAIL_QUEUE_URL', savedEnv.emailQueue],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('enqueues only pending rows with next_retry_at <= now — both pipelines', async () => {
    const { sweeper, queue } = setup({
      forms_configs: [configRow()],
      form_webhook_deliveries: [
        deliveryRow({ id: 1, nextRetryAt: PAST }),
        deliveryRow({ id: 2, nextRetryAt: FUTURE }), // not due
        deliveryRow({ id: 3, status: 'delivered', nextRetryAt: PAST }), // settled
      ],
      form_email_log: [
        emailLogRow({ id: 10, nextRetryAt: PAST }),
        emailLogRow({ id: 11, status: 'failed', nextRetryAt: PAST }),
      ],
    });

    const result = await sweeper.sweepOnce();
    expect(result).toEqual({ webhooks: 1, emails: 1 });
    expect(queue.sent).toEqual([
      { name: 'forms-webhook-delivery', payloads: [{ deliveryId: 1 }] },
      { name: 'forms-email-notification', payloads: [{ emailLogId: 10 }] },
    ]);
  });

  it('claims each enqueued row: next_retry_at pushed +2 min so a double-fire cannot re-enqueue', async () => {
    const { sweeper, queue, fake } = setup({
      forms_configs: [configRow()],
      form_webhook_deliveries: [deliveryRow({ id: 1, nextRetryAt: PAST })],
    });

    await sweeper.sweepOnce();
    expect(fake.tables.form_webhook_deliveries?.[0]?.nextRetryAt).toEqual(
      new Date(NOW.getTime() + FORMS_SWEEP_CLAIM_LEASE_MS),
    );
    expect(FORMS_SWEEP_CLAIM_LEASE_MS).toBe(2 * 60_000);

    // Immediate double-fire: the row is leased — nothing new enqueued.
    const second = await sweeper.sweepOnce();
    expect(second).toEqual({ webhooks: 0, emails: 0 });
    expect(queue.sent).toHaveLength(1);
  });

  it('does nothing when both worker flags are off (self-gating)', async () => {
    process.env.FORMS_WEBHOOK_WORKER_ENABLED = 'false';
    process.env.FORMS_EMAIL_WORKER_ENABLED = 'false';
    const { sweeper, queue } = setup({
      forms_configs: [configRow()],
      form_webhook_deliveries: [deliveryRow({ nextRetryAt: PAST })],
      form_email_log: [emailLogRow({ nextRetryAt: PAST })],
    });
    expect(await sweeper.sweepOnce()).toEqual({ webhooks: 0, emails: 0 });
    expect(queue.sent).toHaveLength(0);
  });

  it('sweeps each pipeline only under its own flag', async () => {
    process.env.FORMS_EMAIL_WORKER_ENABLED = 'false';
    const { sweeper, queue } = setup({
      forms_configs: [configRow()],
      form_webhook_deliveries: [deliveryRow({ nextRetryAt: PAST })],
      form_email_log: [emailLogRow({ nextRetryAt: PAST })],
    });
    expect(await sweeper.sweepOnce()).toEqual({ webhooks: 1, emails: 0 });
    expect(queue.sent.map((s) => s.name)).toEqual(['forms-webhook-delivery']);
  });

  it('kill switch pauses per merchant: rows wait as pending and DRAIN on re-enable (AC11)', async () => {
    const { sweeper, queue, fake } = setup({
      forms_configs: [configRow({ formsEnabled: false }), configRow({ merchantId: 'm_on' })],
      form_webhook_deliveries: [
        deliveryRow({ id: 1, merchantId: MERCHANT_ID, nextRetryAt: PAST }),
        deliveryRow({ id: 2, merchantId: 'm_on', nextRetryAt: PAST }),
      ],
    });

    // Kill-switched merchant skipped; the enabled one flows.
    expect((await sweeper.sweepOnce()).webhooks).toBe(1);
    expect(queue.sent[0]?.payloads).toEqual([{ deliveryId: 2 }]);
    // The skipped row is untouched — NOT claimed, still due.
    const row = fake.tables.form_webhook_deliveries?.find((r) => r.id === 1);
    expect(row?.status).toBe('pending');
    expect(row?.nextRetryAt).toEqual(PAST);

    // Merchant re-enables → previously-pending row drains on the next sweep.
    const config = fake.tables.forms_configs?.find((c) => c.merchantId === MERCHANT_ID);
    if (config) config.formsEnabled = true;
    expect((await sweeper.sweepOnce()).webhooks).toBe(1);
    expect(queue.sent.at(-1)?.payloads).toEqual([{ deliveryId: 1 }]);
  });

  it('caps the fan-out at 100 rows per merchant per sweep (PRD watch-out)', async () => {
    const rows = Array.from({ length: FORMS_SWEEP_MERCHANT_BATCH_CAP + 1 }, (_, i) =>
      deliveryRow({ id: i + 1, nextRetryAt: PAST }),
    );
    const { sweeper, queue } = setup({
      forms_configs: [configRow()],
      form_webhook_deliveries: rows,
    });
    expect((await sweeper.sweepOnce()).webhooks).toBe(FORMS_SWEEP_MERCHANT_BATCH_CAP);
    expect(queue.sent[0]?.payloads).toHaveLength(FORMS_SWEEP_MERCHANT_BATCH_CAP);
    // The 101st row is left due for the next minute's sweep.
    expect((await sweeper.sweepOnce()).webhooks).toBe(1);
  });

  it('honors the FORMS_*_QUEUE_URL env identities', async () => {
    process.env.FORMS_WEBHOOK_QUEUE_URL = 'forms-webhooks-prod';
    process.env.FORMS_EMAIL_QUEUE_URL =
      'https://sqs.ap-south-1.amazonaws.com/123/forms-emails-prod';
    const { sweeper, queue } = setup({
      forms_configs: [configRow()],
      form_webhook_deliveries: [deliveryRow({ nextRetryAt: PAST })],
      form_email_log: [emailLogRow({ nextRetryAt: PAST })],
    });
    await sweeper.sweepOnce();
    expect(queue.sent.map((s) => s.name)).toEqual(['forms-webhooks-prod', 'forms-emails-prod']);
  });
});
