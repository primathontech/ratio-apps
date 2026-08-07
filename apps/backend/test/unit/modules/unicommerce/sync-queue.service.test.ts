import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KafkaService } from '../../../../src/core/kafka/kafka.service';
import { UcCancelPushWorkerService } from '../../../../src/modules/unicommerce/services/cancel-push-worker.service';
import { UcOrderPushWorkerService } from '../../../../src/modules/unicommerce/services/order-push-worker.service';
import { UcSyncQueueService } from '../../../../src/modules/unicommerce/services/sync-queue.service';

// Reproduces the exact original hardcoded ladder (2s/4s/8s) so every
// existing timing-sensitive test (attempt counts, fake-timer advances)
// keeps behaving identically after the ladder became env-configurable.
function fakeConfig() {
  return {
    get: (key: string) => (key === 'UC_RETRY_LADDER_BASE_SECONDS' ? 2 : 3),
  } as never;
}

const kafkaService = new KafkaService({
  get: (key: string) => (key === 'KAFKA_BROKERS' ? 'localhost:9092' : 'ratio-app-test'),
} as never);

interface FakeJobRow {
  id: string;
  merchantId: string;
  // Real `uc_sync_jobs` rows always carry this as a top-level column
  // (separate from whatever's nested in `payload`) — Task 14's event-log
  // writes read `job.ratioOrderId` directly, so fixtures need it set.
  ratioOrderId: string;
  payload: unknown;
  attemptCount: number;
  status: string;
  nextRetryAt?: Date | null;
  type?: string;
  saleOrderCode?: string | null;
}

/**
 * Fake Kysely handle covering the selectFrom/updateTable/insertInto calls
 * sync-queue.service.ts issues, backed by an in-memory `jobs` array so
 * multi-row queries (sweep()'s PENDING/RETRYING scans) filter realistically
 * instead of returning a single hardcoded row.
 */
function fakeHandle(jobs: FakeJobRow[]) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];

  function matchesOp(rowVal: unknown, op: string, val: unknown): boolean {
    if (op === '<=') return (rowVal as Date) <= (val as Date);
    if (op === 'in') return (val as unknown[]).includes(rowVal);
    return rowVal === val;
  }

  function selectFrom(_table: string) {
    const filters: Array<(row: FakeJobRow) => boolean> = [];
    const builder = {
      selectAll: () => builder,
      select: (_col: string) => builder,
      where: (col: string, op: string, val: unknown) => {
        filters.push((row) => matchesOp((row as unknown as Record<string, unknown>)[col], op, val));
        return builder;
      },
      executeTakeFirstOrThrow: async () => {
        const found = jobs.find((j) => filters.every((f) => f(j)));
        if (!found) throw new Error('row not found');
        return found;
      },
      execute: async () =>
        jobs.filter((j) => filters.every((f) => f(j))).map((j) => ({ id: j.id })),
    };
    return builder;
  }

  const db = {
    selectFrom,
    updateTable: (_table: string) => ({
      // Mirrors selectFrom's chained-filter pattern above so the claim step
      // (`.where('id', ...).where('status', 'in', [...])`) is expressible.
      // Both `execute()` and `executeTakeFirst()` do their row lookup + patch
      // synchronously (no `await` in between) so that concurrent callers
      // racing via Promise.all get real compare-and-swap semantics — exactly
      // one of them observes the pre-claim status and wins.
      set: (patch: Record<string, unknown>) => {
        const filters: Array<(row: FakeJobRow) => boolean> = [];
        const builder = {
          where: (col: string, op: string, val: unknown) => {
            filters.push((row) => matchesOp((row as unknown as Record<string, unknown>)[col], op, val));
            return builder;
          },
          execute: async () => {
            const job = jobs.find((j) => filters.every((f) => f(j)));
            if (job) Object.assign(job, patch);
            updates.push(patch);
          },
          executeTakeFirst: async () => {
            const job = jobs.find((j) => filters.every((f) => f(j)));
            if (job) {
              Object.assign(job, patch);
              updates.push(patch);
              return { numUpdatedRows: 1n };
            }
            return { numUpdatedRows: 0n };
          },
        };
        return builder;
      },
    }),
    insertInto: (_table: string) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return { execute: async () => undefined };
      },
    }),
  };
  return { handle: { db }, updates, inserts, jobs };
}

describe('UcSyncQueueService.attemptImmediate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the job DONE when the push succeeds', async () => {
    const job: FakeJobRow = {
      id: 'job-1',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', saleOrderDTO: { code: 'x' } },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle, updates } = fakeHandle([job]);
    const pushWorker = {
      push: vi.fn().mockResolvedValue({ successful: true, saleOrderCode: 'UC-1' }),
    };
    const cancelPushWorker = { push: vi.fn() };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, cancelPushWorker as never, eventLog as never, fakeConfig());

    await svc.attemptImmediate('job-1');

    expect(pushWorker.push).toHaveBeenCalledTimes(1);
    // Fix 1: status and saleOrderCode are written back in ONE atomic update,
    // not two separate `.execute()` calls — this is the value
    // UcOrderCancelledHandler's findSaleOrderCode reads back. UC's real
    // response has no order-identifying field (Open Item #5) — the value
    // written is job.ratioOrderId (our own order id), never anything read
    // off the push result.
    expect(updates).toContainEqual({ status: 'DONE', saleOrderCode: 'order-1' });
    // Task 14: success is determined HERE (not in the worker), so the
    // dashboard-visible event-log row is written here too.
    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'm1',
        direction: 'outbound',
        flow: 'order_push',
        reference: 'order-1',
        result: 'success',
      }),
    );
  });

  it("claims and re-attempts a NEEDS_MANUAL job (admin dashboard's Retry button, Task 15)", async () => {
    const job: FakeJobRow = {
      id: 'job-dlq-1',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', saleOrderDTO: { code: 'x' } },
      attemptCount: 3,
      status: 'NEEDS_MANUAL',
    };
    const { handle, updates } = fakeHandle([job]);
    const pushWorker = {
      push: vi.fn().mockResolvedValue({ successful: true, saleOrderCode: 'UC-RETRIED' }),
    };
    const cancelPushWorker = { push: vi.fn() };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, cancelPushWorker as never, eventLog as never, fakeConfig());

    await svc.attemptImmediate('job-dlq-1');

    // The claim must succeed (status IN (...NEEDS_MANUAL)) and the push must
    // actually fire — before the fix, NEEDS_MANUAL wasn't claimable, so this
    // call was a silent no-op and the admin's "Retry" button never worked.
    expect(pushWorker.push).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual({ status: 'DONE', saleOrderCode: 'order-1' });
  });



  it('moves straight to DLQ on a non-recoverable error, without retrying', async () => {
    const job: FakeJobRow = {
      id: 'job-2',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      type: 'order_push',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', saleOrderDTO: { code: 'x' } },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle, updates, inserts } = fakeHandle([job]);
    const pushWorker = { push: vi.fn().mockRejectedValue(new Error('SKU not found for item')) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, { push: vi.fn() } as never, eventLog as never, fakeConfig());

    await svc.attemptImmediate('job-2');

    expect(pushWorker.push).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      originalJobId: 'job-2',
      lastError: 'SKU not found for item',
    });
    expect(updates).toContainEqual({ status: 'NEEDS_MANUAL' });
    // Task 14: final failure (moveToDlq) also gets a dashboard-visible
    // event-log row, with the error message as the response.
    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'm1',
        direction: 'outbound',
        flow: 'order_push',
        reference: 'order-1',
        result: 'failed',
        response: 'SKU not found for item',
      }),
    );
  });

  // Kafka architecture: the old RETRYING fallback is replaced by an immediate
  // DLQ move after exhausting the in-process retry ladder. The Kafka consumer
  // commits its offset regardless, and the DLQ table is the terminal home.
  it('retries 3 times on a recoverable error, then moves to DLQ (NEEDS_MANUAL)', async () => {
    const job: FakeJobRow = {
      id: 'job-3',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', saleOrderDTO: { code: 'x' } },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle, updates, inserts } = fakeHandle([job]);
    const pushWorker = { push: vi.fn().mockRejectedValue(new Error('upstream timeout')) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, { push: vi.fn() } as never, eventLog as never, fakeConfig());

    const promise = svc.attemptImmediate('job-3');
    await vi.runAllTimersAsync();
    await promise;

    expect(pushWorker.push).toHaveBeenCalledTimes(3);
    expect(inserts).toHaveLength(1);
    expect(updates).toContainEqual({ status: 'NEEDS_MANUAL' });
  });

  it('honors a configured base/attempt count different from the 2s/4s/8s default (e.g. base=3, attempts=4)', async () => {
    const job: FakeJobRow = {
      id: 'job-3b',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', saleOrderDTO: { code: 'x' } },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle, updates } = fakeHandle([job]);
    const pushWorker = { push: vi.fn().mockRejectedValue(new Error('upstream timeout')) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const customConfig = {
      get: (key: string) => (key === 'UC_RETRY_LADDER_BASE_SECONDS' ? 3 : 4),
    } as never;
    const svc = new UcSyncQueueService(
      handle as never,
      kafkaService,
      pushWorker as never,
      { push: vi.fn() } as never,
      eventLog as never,
      customConfig,
    );

    const promise = svc.attemptImmediate('job-3b');
    await vi.runAllTimersAsync();
    await promise;

    // base=3, attempts=4 -> 3s, 9s, 27s, 81s (3^1..3^4) — 4 attempts, not 3.
    expect(pushWorker.push).toHaveBeenCalledTimes(4);
    expect(updates).toContainEqual({ status: 'NEEDS_MANUAL' });
  });

  // Fix 2: `push()` throwing on `status: 'failure'` (rather than resolving
  // silently) must actually flow through this classification — proven here
  // with the REAL UcOrderPushWorkerService (not a hand-rolled mock) wired to
  // a fake HTTP client, so both halves of the fix are exercised together.
  it("a status:'failure' push response is classified via isNonRecoverable, not marked DONE", async () => {
    const job: FakeJobRow = {
      id: 'job-4',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', order: { id: 'order-1' } },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle, updates, inserts } = fakeHandle([job]);
    const credentials = { getRatioUsername: vi.fn().mockResolvedValue('uc-user') };
    const httpClient = {
      post: vi.fn().mockResolvedValue({
        status: 'failure',
        message: 'SKU not found for item Z',
        data: null,
      }),
    };
    const pushWorker = new UcOrderPushWorkerService(credentials as never, httpClient as never, {
      clientId: 'x',
      securityKey: 'y',
      baseUrl: 'https://genericproxy.unicommerce.com',
    });
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker, { push: vi.fn() } as never, eventLog as never, fakeConfig());

    await svc.attemptImmediate('job-4');

    expect(httpClient.post).toHaveBeenCalledTimes(1);
    expect(updates).not.toContainEqual({ status: 'DONE' });
    expect(updates).toContainEqual({ status: 'NEEDS_MANUAL' });
    expect(inserts[0]).toMatchObject({ lastError: 'SKU not found for item Z' });
  });

  it("a status:'failure' response with no message defaults to recoverable and retries, not DONE", async () => {
    const job: FakeJobRow = {
      id: 'job-5',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', order: { id: 'order-1' } },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle, updates } = fakeHandle([job]);
    const credentials = { getRatioUsername: vi.fn().mockResolvedValue('uc-user') };
    const httpClient = {
      post: vi.fn().mockResolvedValue({ status: 'failure', data: null }),
    };
    const pushWorker = new UcOrderPushWorkerService(credentials as never, httpClient as never, {
      clientId: 'x',
      securityKey: 'y',
      baseUrl: 'https://genericproxy.unicommerce.com',
    });
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker, { push: vi.fn() } as never, eventLog as never, fakeConfig());

    const promise = svc.attemptImmediate('job-5');
    await vi.runAllTimersAsync();
    await promise;

    expect(httpClient.post).toHaveBeenCalledTimes(3);
    expect(updates).not.toContainEqual({ status: 'DONE' });
    expect(updates).toContainEqual({ status: 'NEEDS_MANUAL' });
  });
});

describe('UcSyncQueueService.attemptImmediate — event-log write failures (Fix 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The regression: eventLog.record() is called INSIDE the same try block
  // that drives the 3-attempt retry ladder, right after the job is marked
  // DONE. If record() rejects, that rejection must not be treated like a
  // pushWorker failure — it must not re-invoke pushWorker.push() (which would
  // re-issue the real outbound HTTP call for an order already pushed) and it
  // must not let the ladder's final RETRYING fallback overwrite the DONE
  // status a real success already wrote.
  it('a rejected eventLog.record() on order_push success does not re-push and does not revert DONE', async () => {
    const job: FakeJobRow = {
      id: 'job-eventlog-fail',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', saleOrderDTO: { code: 'x' } },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle, updates } = fakeHandle([job]);
    const pushWorker = {
      push: vi.fn().mockResolvedValue({ successful: true, saleOrderCode: 'UC-1' }),
    };
    const cancelPushWorker = { push: vi.fn() };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, cancelPushWorker as never, eventLog as never, fakeConfig());

    const promise = svc.attemptImmediate('job-eventlog-fail');
    await vi.runAllTimersAsync();
    await promise;

    // pushWorker.push() must only ever be called once — a failing event-log
    // write must not be mistaken for a recoverable push failure and retried.
    expect(pushWorker.push).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('DONE');
    expect(updates).not.toContainEqual({ status: 'NEEDS_MANUAL' });
  });

  it('a rejected eventLog.record() on cancel_push success does not re-push and does not revert DONE', async () => {
    const job: FakeJobRow = {
      id: 'cancel-job-eventlog-fail',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      type: 'cancel_push',
      payload: {
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        saleOrderCode: 'UC-999',
        reason: 'Cancelled on Ratio storefront',
      },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle, updates } = fakeHandle([job]);
    const pushWorker = { push: vi.fn() };
    const cancelPushWorker = { push: vi.fn().mockResolvedValue({ alreadyDispatched: false }) };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, cancelPushWorker as never, eventLog as never, fakeConfig());

    const promise = svc.attemptImmediate('cancel-job-eventlog-fail');
    await vi.runAllTimersAsync();
    await promise;

    expect(cancelPushWorker.push).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('DONE');
    expect(updates).not.toContainEqual({ status: 'NEEDS_MANUAL' });
  });

  it('a rejected eventLog.record() inside moveToDlq still leaves the job NEEDS_MANUAL, not retried further', async () => {
    const job: FakeJobRow = {
      id: 'job-dlq-eventlog-fail',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      type: 'order_push',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', saleOrderDTO: { code: 'x' } },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle, updates, inserts } = fakeHandle([job]);
    const pushWorker = { push: vi.fn().mockRejectedValue(new Error('SKU not found for item')) };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, { push: vi.fn() } as never, eventLog as never, fakeConfig());

    await svc.attemptImmediate('job-dlq-eventlog-fail');

    expect(pushWorker.push).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(job.status).toBe('NEEDS_MANUAL');
  });
});

// sweep() removed in Kafka architecture — outbound jobs are picked up by
// the Kafka consumer (unicommerce-outbound-worker group) instead of a DB cron.

describe('UcSyncQueueService — concurrent claim (Bug 1 fix)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The regression: the fast path (webhook handler, fire-and-forget) and
  // sweep() can both independently call `attemptImmediate` for the SAME
  // jobId while the job sits PENDING for the whole 2s/4s/8s ladder. Fired via
  // `Promise.all` (NOT two sequentially-awaited calls) so both invocations
  // are genuinely in flight together — before the fix, neither call gated on
  // the other, so both would reach `pushWorker.push()`.
  it('two concurrent attemptImmediate() calls for the same job only push once', async () => {
    const job: FakeJobRow = {
      id: 'job-race',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: { merchantId: 'm1', ratioOrderId: 'order-1', saleOrderDTO: { code: 'x' } },
      attemptCount: 0,
      status: 'PENDING',
    };
    const { handle } = fakeHandle([job]);
    const pushWorker = {
      push: vi.fn().mockResolvedValue({ successful: true, saleOrderCode: 'UC-1' }),
    };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, { push: vi.fn() } as never, eventLog as never, fakeConfig());

    await Promise.all([svc.attemptImmediate('job-race'), svc.attemptImmediate('job-race')]);

    expect(pushWorker.push).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('DONE');
  });

  // Two concurrent attemptImmediate() calls for the same job must also race
  // through the atomic claim — only the winner proceeds to push.
  it('two concurrent attemptImmediate() calls for the same RETRYING job only push once', async () => {
    const job: FakeJobRow = {
      id: 'job-retry-race',
      merchantId: 'm1',
      ratioOrderId: 'order-9',
      payload: { merchantId: 'm1', ratioOrderId: 'order-9', saleOrderDTO: { code: 'r' } },
      attemptCount: 1,
      status: 'RETRYING',
    };
    const { handle } = fakeHandle([job]);
    const pushWorker = {
      push: vi.fn().mockResolvedValue({ successful: true, saleOrderCode: 'UC-1' }),
    };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, { push: vi.fn() } as never, eventLog as never, fakeConfig());

    await Promise.all([svc.attemptImmediate('job-retry-race'), svc.attemptImmediate('job-retry-race')]);

    expect(pushWorker.push).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('DONE');
  });
});

// Task 9: 'cancel_push' jobs share this exact same claim/retry/DLQ machinery
// instead of a separate queue — these tests exercise that the type-based
// branch inside attemptImmediate() dispatches to UcCancelPushWorkerService
// (not UcOrderPushWorkerService) and that the atomic-claim guarantee proven
// above for order_push jobs applies identically here, since both types funnel
// through the SAME claim step.
describe('UcSyncQueueService.attemptImmediate — cancel_push jobs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function cancelJob(overrides: Partial<FakeJobRow> = {}): FakeJobRow {
    return {
      id: 'cancel-job-1',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      type: 'cancel_push',
      payload: {
        merchantId: 'm1',
        ratioOrderId: 'order-1',
        saleOrderCode: 'UC-999',
        reason: 'Cancelled on Ratio storefront',
      },
      attemptCount: 0,
      status: 'PENDING',
      ...overrides,
    };
  }

  it('dispatches to UcCancelPushWorkerService.push with the payload fields, and marks DONE', async () => {
    const job = cancelJob();
    const { handle, updates } = fakeHandle([job]);
    const pushWorker = { push: vi.fn() };
    const cancelPushWorker = { push: vi.fn().mockResolvedValue({ alreadyDispatched: false }) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, cancelPushWorker as never, eventLog as never, fakeConfig());

    await svc.attemptImmediate('cancel-job-1');

    expect(pushWorker.push).not.toHaveBeenCalled();
    expect(cancelPushWorker.push).toHaveBeenCalledWith('m1', 'order-1', 'UC-999', 'Cancelled on Ratio storefront');
    expect(updates).toContainEqual({ status: 'DONE' });
    // Task 14: cancel_push success also gets a dashboard-visible event-log
    // row, flow: 'cancel' (not 'order_push').
    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'm1',
        direction: 'outbound',
        flow: 'cancel',
        reference: 'order-1',
        result: 'success',
      }),
    );
  });

  it('does not throw or retry when UcCancelPushWorkerService reports alreadyDispatched=true — still marks DONE (terminal)', async () => {
    const job = cancelJob();
    const { handle, updates } = fakeHandle([job]);
    const pushWorker = { push: vi.fn() };
    const cancelPushWorker = { push: vi.fn().mockResolvedValue({ alreadyDispatched: true }) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, cancelPushWorker as never, eventLog as never, fakeConfig());

    await svc.attemptImmediate('cancel-job-1');

    expect(cancelPushWorker.push).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual({ status: 'DONE' });
  });

  it('retries a recoverable cancel-push error on the same 2s/4s/8s ladder as order_push jobs', async () => {
    const job = cancelJob();
    const { handle, updates } = fakeHandle([job]);
    const pushWorker = { push: vi.fn() };
    const cancelPushWorker = { push: vi.fn().mockRejectedValue(new Error('upstream timeout')) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, cancelPushWorker as never, eventLog as never, fakeConfig());

    const promise = svc.attemptImmediate('cancel-job-1');
    await vi.runAllTimersAsync();
    await promise;

    expect(cancelPushWorker.push).toHaveBeenCalledTimes(3);
    expect(updates).toContainEqual({ status: 'NEEDS_MANUAL' });
  });

  it('moves a non-recoverable cancel-push error straight to DLQ, without retrying', async () => {
    const job = cancelJob();
    const { handle, updates, inserts } = fakeHandle([job]);
    const pushWorker = { push: vi.fn() };
    const cancelPushWorker = { push: vi.fn().mockRejectedValue(new Error('validation error: bad sale order code')) };
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, cancelPushWorker as never, eventLog as never, fakeConfig());

    await svc.attemptImmediate('cancel-job-1');

    expect(cancelPushWorker.push).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(updates).toContainEqual({ status: 'NEEDS_MANUAL' });
    // Task 14: final failure (moveToDlq) for a cancel_push job also gets a
    // dashboard-visible event-log row, flow: 'cancel'.
    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'm1',
        direction: 'outbound',
        flow: 'cancel',
        reference: 'order-1',
        result: 'failed',
        response: 'validation error: bad sale order code',
      }),
    );
  });

  it('real UcCancelPushWorkerService wired end-to-end: a status:\'failure\' "already dispatched" response body surfaces as alreadyDispatched, not a retry (proves the design-risk fix)', async () => {
    const job = cancelJob();
    const { handle, updates } = fakeHandle([job]);
    const pushWorker = { push: vi.fn() };
    const credentials = { getRatioUsername: vi.fn().mockResolvedValue('uc-user') };
    const httpClient = {
      post: vi.fn().mockResolvedValue({ status: 'failure', message: 'Order already dispatched, cannot cancel', data: null }),
    };
    const cancelPushWorker = new UcCancelPushWorkerService(credentials as never, httpClient as never, {
      clientId: 'x',
      securityKey: 'y',
      baseUrl: 'https://genericproxy.unicommerce.com',
    });
    const eventLog = { record: vi.fn().mockResolvedValue(undefined) };
    const svc = new UcSyncQueueService(handle as never, kafkaService, pushWorker as never, cancelPushWorker, eventLog as never, fakeConfig());

    await svc.attemptImmediate('cancel-job-1');

    expect(httpClient.post).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual({ status: 'DONE' });
    expect(updates).not.toContainEqual({ status: 'RETRYING' });
    expect(updates).not.toContainEqual({ status: 'NEEDS_MANUAL' });
  });
});

// Bug: a cancel webhook arriving while the corresponding order_push job was
// still PENDING/RETRYING/NEEDS_MANUAL was invisible to order-cancelled.handler.ts
// (it only checks for a DONE push), so the push later ran anyway and shipped
// an order the customer had already cancelled. This method lets the cancel
// handler neutralize that race before it can happen.
describe('UcSyncQueueService.cancelPendingOrderPush', () => {
  it('cancels a PENDING order_push job for the given order', async () => {
    const job: FakeJobRow = {
      id: 'job-1',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: {},
      attemptCount: 0,
      status: 'PENDING',
      type: 'order_push',
    };
    const { handle, jobs } = fakeHandle([job]);
    const svc = new UcSyncQueueService(
      handle as never,
      kafkaService,
      { push: vi.fn() } as never,
      { push: vi.fn() } as never,
      { record: vi.fn() } as never,
      fakeConfig(),
    );

    await svc.cancelPendingOrderPush('m1', 'order-1');

    expect(jobs[0]!.status).toBe('CANCELLED');
  });

  it('does not touch an IN_PROGRESS job for the same order (a worker may be mid-push)', async () => {
    const job: FakeJobRow = {
      id: 'job-1',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: {},
      attemptCount: 0,
      status: 'IN_PROGRESS',
      type: 'order_push',
    };
    const { handle, jobs } = fakeHandle([job]);
    const svc = new UcSyncQueueService(
      handle as never,
      kafkaService,
      { push: vi.fn() } as never,
      { push: vi.fn() } as never,
      { record: vi.fn() } as never,
      fakeConfig(),
    );

    await svc.cancelPendingOrderPush('m1', 'order-1');

    expect(jobs[0]!.status).toBe('IN_PROGRESS');
  });

  it('does not touch an already-DONE job for the same order', async () => {
    const job: FakeJobRow = {
      id: 'job-1',
      merchantId: 'm1',
      ratioOrderId: 'order-1',
      payload: {},
      attemptCount: 0,
      status: 'DONE',
      type: 'order_push',
    };
    const { handle, jobs } = fakeHandle([job]);
    const svc = new UcSyncQueueService(
      handle as never,
      kafkaService,
      { push: vi.fn() } as never,
      { push: vi.fn() } as never,
      { record: vi.fn() } as never,
      fakeConfig(),
    );

    await svc.cancelPendingOrderPush('m1', 'order-1');

    expect(jobs[0]!.status).toBe('DONE');
  });
});

// The producer side must not depend on the (optionally-disabled, separately
// deployable) outbound consumer having started first to create the Kafka
// topics — found via local verification: publish() failed outright against
// a real broker with auto-create-topics off until something else happened
// to call ensureTopics() first.
describe('UcSyncQueueService.onModuleInit', () => {
  it('ensures both the order-push and order-cancel topics exist on startup', async () => {
    const { handle } = fakeHandle([]);
    const kafka = { ensureTopic: vi.fn().mockResolvedValue(undefined), send: vi.fn() };
    const svc = new UcSyncQueueService(
      handle as never,
      kafka as never,
      { push: vi.fn() } as never,
      { push: vi.fn() } as never,
      { record: vi.fn() } as never,
      fakeConfig(),
    );

    await svc.onModuleInit();

    expect(kafka.ensureTopic).toHaveBeenCalledWith('unicommerce-order-push');
    expect(kafka.ensureTopic).toHaveBeenCalledWith('unicommerce-order-cancel');
  });
});
