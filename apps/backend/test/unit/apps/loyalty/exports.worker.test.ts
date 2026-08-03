import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailService } from '../../../../src/core/email/email.service';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import type { S3Service } from '../../../../src/core/storage/s3.service';
import { LOYALTY_QUEUE_NAMES } from '../../../../src/modules/loyalty/bulk/loyalty-queues';
import { ExportsWorker } from '../../../../src/modules/loyalty/exports/exports.worker';
import {
  FakeCustomerQuery,
  type FakeLoyaltyDb,
  makeFakeLoyaltyHandle,
} from './helpers/fake-loyalty-db';
import { FakeEmail, FakeQueue, FakeS3, MERCHANT_ID, mkCustomer } from './helpers/fakes';

const EXPORT_ID = '01JEXPORT0000000000000000A';
const BUCKET = 'loyalty-bucket';

const HEADER =
  'customer_id,phone_number,email,name,coins_balance,lifetime_earned,' +
  'lifetime_redeemed,lifetime_spend,lifetime_orders,last_order_date';

describe('ExportsWorker', () => {
  let fake: FakeLoyaltyDb;
  let queue: FakeQueue;
  let s3: FakeS3;
  let email: FakeEmail;
  let query: FakeCustomerQuery;
  let worker: ExportsWorker;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    delete process.env.LOYALTY_WORKER_ENABLED;
    process.env.LOYALTY_EXPORT_S3_BUCKET = BUCKET;
    const made = makeFakeLoyaltyHandle();
    fake = made.fake;
    queue = new FakeQueue();
    s3 = new FakeS3();
    email = new FakeEmail();
    query = new FakeCustomerQuery();
    worker = new ExportsWorker(
      made.handle,
      queue as unknown as QueueService,
      s3 as unknown as S3Service,
      email as unknown as EmailService,
      query,
    );
  });

  afterEach(() => {
    worker.onModuleDestroy();
    process.env = savedEnv;
  });

  function seedExport(overrides: Record<string, unknown> = {}) {
    fake.table('loyalty_exports').push({
      id: EXPORT_ID,
      merchantId: MERCHANT_ID,
      filters: JSON.stringify([]),
      status: 'pending',
      rowCount: null,
      s3Key: null,
      email: null,
      emailedAt: null,
      createdBy: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    void queue.sendBatch(LOYALTY_QUEUE_NAMES.exports, [
      { exportId: EXPORT_ID, merchantId: MERCHANT_ID },
    ]);
  }

  it('#disabled-without-flag: onModuleInit does not consume without LOYALTY_WORKER_ENABLED=true', async () => {
    const receive = vi.spyOn(queue, 'receive');
    worker.onModuleInit();
    await new Promise((r) => setTimeout(r, 20));
    expect(receive).not.toHaveBeenCalled();
  });

  it('#uploads-gzip-csv-to-s3 with the exact header and CSV-escaped values', async () => {
    query.rows = [
      mkCustomer({
        phone: '+919876543210',
        name: 'Priya, "The Great"',
        email: 'priya@example.com',
        pointsBalance: 120,
        lifetimeEarned: 500,
        lifetimeRedeemed: 380,
        lifetimeSpend: '1234.50',
        lifetimeOrders: 7,
        lastOrderAt: new Date('2026-06-01T10:00:00Z'),
      }),
      mkCustomer({ phone: '+919876543211', name: null, email: null, lastOrderAt: null }),
    ];
    seedExport();

    await worker.drainOnce();

    expect(s3.puts).toHaveLength(1);
    const put = s3.puts[0];
    expect(put.bucket).toBe(BUCKET);
    expect(put.key).toBe(`loyalty/exports/${MERCHANT_ID}/${EXPORT_ID}.csv.gz`);
    expect(put.contentType).toBe('text/csv');

    const csv = gunzipSync(put.body).toString('utf8');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe(
      '+919876543210,+919876543210,priya@example.com,"Priya, ""The Great""",' +
        '120,500,380,1234.50,7,2026-06-01',
    );
    expect(lines[2]).toBe('+919876543211,+919876543211,,,0,0,0,0.00,0,');

    const row = fake.table('loyalty_exports')[0];
    expect(row).toMatchObject({
      status: 'done',
      rowCount: 2,
      s3Key: `loyalty/exports/${MERCHANT_ID}/${EXPORT_ID}.csv.gz`,
    });
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(queue.acked.get(LOYALTY_QUEUE_NAMES.exports)).toHaveLength(1);
  });

  it('#emails-presigned-link-when-email-set (7-day link, emailed_at stamped)', async () => {
    query.rows = [mkCustomer()];
    seedExport({ email: 'ops@example.com' });

    await worker.drainOnce();

    expect(email.sends).toHaveLength(1);
    const sent = email.sends[0];
    expect(sent.to).toBe('ops@example.com');
    expect(sent.subject).toContain('1');
    const presigned = `https://s3.fake/${BUCKET}/loyalty/exports/${MERCHANT_ID}/${EXPORT_ID}.csv.gz?expires=${7 * 24 * 3600}`;
    expect(sent.html).toContain(presigned);
    expect(fake.table('loyalty_exports')[0].emailedAt).toBeInstanceOf(Date);
  });

  it('sends no email (and stamps nothing) when the export has no email', async () => {
    query.rows = [mkCustomer()];
    seedExport();

    await worker.drainOnce();

    expect(email.sends).toHaveLength(0);
    expect(fake.table('loyalty_exports')[0].emailedAt).toBeNull();
  });

  it('an email failure does not fail the export', async () => {
    query.rows = [mkCustomer()];
    seedExport({ email: 'ops@example.com' });
    vi.spyOn(email, 'send').mockRejectedValueOnce(new Error('ses down'));

    await worker.drainOnce();

    const row = fake.table('loyalty_exports')[0];
    expect(row.status).toBe('done');
    expect(row.emailedAt).toBeNull();
    expect(queue.acked.get(LOYALTY_QUEUE_NAMES.exports)).toHaveLength(1);
  });

  it('missing LOYALTY_EXPORT_S3_BUCKET → export failed, message acked (permanent config error)', async () => {
    delete process.env.LOYALTY_EXPORT_S3_BUCKET;
    query.rows = [mkCustomer()];
    seedExport();

    await worker.drainOnce();

    expect(s3.puts).toHaveLength(0);
    expect(fake.table('loyalty_exports')[0].status).toBe('failed');
    expect(queue.acked.get(LOYALTY_QUEUE_NAMES.exports)).toHaveLength(1);
  });

  it('S3 failure → export failed, message NOT acked (redelivery)', async () => {
    query.rows = [mkCustomer()];
    seedExport();
    s3.failNext = new Error('s3 down');

    await worker.drainOnce();

    expect(fake.table('loyalty_exports')[0].status).toBe('failed');
    expect(queue.acked.get(LOYALTY_QUEUE_NAMES.exports) ?? []).toHaveLength(0);
  });

  it('a redelivered message reprocesses a failed export to done', async () => {
    query.rows = [mkCustomer()];
    seedExport({ status: 'failed' });

    await worker.drainOnce();

    expect(fake.table('loyalty_exports')[0].status).toBe('done');
    expect(s3.puts).toHaveLength(1);
  });

  it('skips a missing or already-done export (still acked)', async () => {
    seedExport({ status: 'done' });
    void queue.sendBatch(LOYALTY_QUEUE_NAMES.exports, [
      { exportId: 'missing', merchantId: MERCHANT_ID },
    ]);

    await worker.drainOnce();

    expect(s3.puts).toHaveLength(0);
    expect(queue.acked.get(LOYALTY_QUEUE_NAMES.exports)).toHaveLength(2);
  });
});
