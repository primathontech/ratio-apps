import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import { BulkWorker } from '../../../../src/modules/loyalty/bulk/bulk.worker';
import { LOYALTY_QUEUE_NAMES } from '../../../../src/modules/loyalty/bulk/loyalty-queues';
import type { CoreLoyaltyClient } from '../../../../src/modules/loyalty/core-client/core-loyalty.client';
import { CoreLoyaltyError } from '../../../../src/modules/loyalty/core-client/core-loyalty.client';
import { type FakeLoyaltyDb, makeFakeLoyaltyHandle } from './helpers/fake-loyalty-db';
import { FakeCoreLoyalty, FakeQueue, MERCHANT_ID } from './helpers/fakes';

const OP_ID = '01JBULKOP0000000000000000A';

interface SeedRow {
  id: number;
  rowNumber: number;
  phone: string;
  points: number;
  status?: 'pending' | 'success' | 'failed' | 'skipped';
  reason?: string | null;
}

function seed(
  fake: FakeLoyaltyDb,
  opts: { type?: 'credit' | 'debit'; status?: string; rows: SeedRow[] },
) {
  fake.table('loyalty_bulk_operations').push({
    id: OP_ID,
    merchantId: MERCHANT_ID,
    type: opts.type ?? 'credit',
    status: opts.status ?? 'processing',
    fileName: null,
    totalRows: opts.rows.length,
    validRows: opts.rows.filter((r) => (r.status ?? 'pending') === 'pending').length,
    invalidRows: 0,
    processedRows: opts.rows.filter((r) => r.status === 'success' || r.status === 'failed').length,
    successCount: opts.rows.filter((r) => r.status === 'success').length,
    failureCount: opts.rows.filter((r) => r.status === 'failed').length,
    totalPoints: 0,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  for (const r of opts.rows) {
    fake.table('loyalty_bulk_operation_rows').push({
      id: r.id,
      operationId: OP_ID,
      rowNumber: r.rowNumber,
      phone: r.phone,
      points: r.points,
      reason: r.reason ?? null,
      status: r.status ?? 'pending',
      errorReason: null,
      coreTransactionId: null,
      processedAt: null,
    });
  }
}

function enqueue(queue: FakeQueue, rowIds: number[]) {
  void queue.sendBatch(LOYALTY_QUEUE_NAMES.bulkOps, [
    { opId: OP_ID, merchantId: MERCHANT_ID, rowIds },
  ]);
}

describe('BulkWorker', () => {
  let fake: FakeLoyaltyDb;
  let queue: FakeQueue;
  let core: FakeCoreLoyalty;
  let worker: BulkWorker;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    delete process.env.LOYALTY_WORKER_ENABLED;
    const made = makeFakeLoyaltyHandle();
    fake = made.fake;
    queue = new FakeQueue();
    core = new FakeCoreLoyalty();
    worker = new BulkWorker(
      made.handle,
      queue as unknown as QueueService,
      core as unknown as CoreLoyaltyClient,
    );
  });

  afterEach(() => {
    worker.onModuleDestroy();
    process.env = savedEnv;
  });

  it('#disabled-without-flag: onModuleInit does not consume without LOYALTY_WORKER_ENABLED=true', async () => {
    const receive = vi.spyOn(queue, 'receive');

    worker.onModuleInit();
    await new Promise((r) => setTimeout(r, 20));

    expect(receive).not.toHaveBeenCalled();
  });

  it('#processes-rows-with-bulk-opid-rowno-keys', async () => {
    seed(fake, {
      rows: [
        { id: 1, rowNumber: 1, phone: '+919876543210', points: 100, reason: 'gift' },
        { id: 2, rowNumber: 2, phone: '+919876543211', points: 50 },
      ],
    });
    enqueue(queue, [1, 2]);

    await worker.drainOnce();

    expect(core.calls.map((c) => c.idempotencyKey).sort()).toEqual([
      `bulk:${OP_ID}:1`,
      `bulk:${OP_ID}:2`,
    ]);
    const byKey = new Map(core.calls.map((c) => [c.idempotencyKey, c]));
    expect(byKey.get(`bulk:${OP_ID}:1`)).toMatchObject({
      op: 'credit',
      merchantId: MERCHANT_ID,
      phone: '+919876543210',
      points: 100,
      description: 'gift',
      metadata: { source: 'bulk_upload', operation_id: OP_ID },
    });
    expect(byKey.get(`bulk:${OP_ID}:2`)?.description).toBe('Bulk credit');

    const rows = fake.table('loyalty_bulk_operation_rows');
    expect(rows.every((r) => r.status === 'success')).toBe(true);
    expect(rows[0].coreTransactionId).toMatch(/^txn-/);
    expect(rows[0].processedAt).toBeInstanceOf(Date);

    const op = fake.table('loyalty_bulk_operations')[0];
    expect(op).toMatchObject({ processedRows: 2, successCount: 2, failureCount: 0 });
    expect(queue.acked.get(LOYALTY_QUEUE_NAMES.bulkOps)).toHaveLength(1);
  });

  it('#rerun-same-op-is-noop: the Core ledger dedupes by idempotency key', async () => {
    seed(fake, {
      rows: [
        { id: 1, rowNumber: 1, phone: '+919876543210', points: 100 },
        { id: 2, rowNumber: 2, phone: '+919876543211', points: 50 },
      ],
    });
    enqueue(queue, [1, 2]);
    await worker.drainOnce();
    const balancesAfterFirst = new Map(core.balances);

    // Simulate a redelivery after a crash-before-row-update: rows revert to
    // pending, the same message arrives again.
    for (const r of fake.table('loyalty_bulk_operation_rows')) r.status = 'pending';
    fake.table('loyalty_bulk_operations')[0].status = 'processing';
    enqueue(queue, [1, 2]);
    await worker.drainOnce();

    expect(core.balances).toEqual(balancesAfterFirst); // idempotent replay — 0 extra coins
    expect(core.creditedTotal).toBe(150);
  });

  it('#debit-insufficient-balance-skips-core-call', async () => {
    seed(fake, {
      type: 'debit',
      rows: [{ id: 1, rowNumber: 1, phone: '+919876543210', points: 100 }],
    });
    core.setBalance('+919876543210', 40);
    enqueue(queue, [1]);

    await worker.drainOnce();

    expect(core.calls).toHaveLength(0); // no debit ever sent
    const row = fake.table('loyalty_bulk_operation_rows')[0];
    expect(row).toMatchObject({ status: 'failed', errorReason: 'Insufficient balance' });
    const op = fake.table('loyalty_bulk_operations')[0];
    expect(op).toMatchObject({ processedRows: 1, successCount: 0, failureCount: 1 });
  });

  it('#resume-processes-only-pending-rows', async () => {
    seed(fake, {
      rows: [
        { id: 1, rowNumber: 1, phone: '+919876543210', points: 10, status: 'success' },
        { id: 2, rowNumber: 2, phone: '+919876543211', points: 20, status: 'failed' },
        { id: 3, rowNumber: 3, phone: '+919876543212', points: 30, status: 'pending' },
        { id: 4, rowNumber: 4, phone: '+919876543213', points: 40, status: 'skipped' },
      ],
    });
    enqueue(queue, [1, 2, 3, 4]);

    await worker.drainOnce();

    expect(core.calls).toHaveLength(1);
    expect(core.calls[0].idempotencyKey).toBe(`bulk:${OP_ID}:3`);
  });

  it('transient core error → message NOT acked, row stays pending', async () => {
    seed(fake, {
      rows: [{ id: 1, rowNumber: 1, phone: '+919876543210', points: 10 }],
    });
    core.failOn.set('+919876543210', new CoreLoyaltyError('upstream_error', 503, 'boom'));
    enqueue(queue, [1]);

    await worker.drainOnce();

    expect(queue.acked.get(LOYALTY_QUEUE_NAMES.bulkOps) ?? []).toHaveLength(0);
    const row = fake.table('loyalty_bulk_operation_rows')[0];
    expect(row.status).toBe('pending');
    expect(fake.table('loyalty_bulk_operations')[0].processedRows).toBe(0);
  });

  it('permanent core error (4xx) → row failed with the kind, message acked', async () => {
    seed(fake, {
      rows: [
        { id: 1, rowNumber: 1, phone: '+919876543210', points: 10 },
        { id: 2, rowNumber: 2, phone: '+919876543211', points: 20 },
      ],
    });
    core.failOn.set('+919876543210', new CoreLoyaltyError('bad_request', 400, 'nope'));
    enqueue(queue, [1, 2]);

    await worker.drainOnce();

    const rows = fake.table('loyalty_bulk_operation_rows');
    expect(rows[0]).toMatchObject({ status: 'failed', errorReason: 'bad_request' });
    expect(rows[1].status).toBe('success'); // per-row failure isolates
    const op = fake.table('loyalty_bulk_operations')[0];
    expect(op).toMatchObject({ processedRows: 2, successCount: 1, failureCount: 1 });
    expect(queue.acked.get(LOYALTY_QUEUE_NAMES.bulkOps)).toHaveLength(1);
  });

  it('a core insufficient_balance error marks the row failed with that reason', async () => {
    seed(fake, {
      type: 'debit',
      rows: [{ id: 1, rowNumber: 1, phone: '+919876543210', points: 10 }],
    });
    core.setBalance('+919876543210', 100); // passes the pre-check…
    core.failOn.set('+919876543210', new CoreLoyaltyError('insufficient_balance', 400, 'low'));
    enqueue(queue, [1]);

    await worker.drainOnce();

    expect(fake.table('loyalty_bulk_operation_rows')[0]).toMatchObject({
      status: 'failed',
      errorReason: 'Insufficient balance',
    });
  });

  it('flips the op to done when no pending rows remain', async () => {
    seed(fake, {
      rows: [
        { id: 1, rowNumber: 1, phone: '+919876543210', points: 10 },
        { id: 2, rowNumber: 2, phone: '+919876543211', points: 20, status: 'failed' },
      ],
    });
    enqueue(queue, [1]);

    await worker.drainOnce();

    expect(fake.table('loyalty_bulk_operations')[0].status).toBe('done');
  });

  it('skips messages for a missing or non-processing op (still acked)', async () => {
    seed(fake, {
      status: 'done',
      rows: [{ id: 1, rowNumber: 1, phone: '+919876543210', points: 10 }],
    });
    enqueue(queue, [1]);
    void queue.sendBatch(LOYALTY_QUEUE_NAMES.bulkOps, [
      { opId: 'missing-op', merchantId: MERCHANT_ID, rowIds: [99] },
    ]);

    await worker.drainOnce();

    expect(core.calls).toHaveLength(0);
    expect(queue.acked.get(LOYALTY_QUEUE_NAMES.bulkOps)).toHaveLength(2);
  });
});
