import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { QueueService } from '../../../core/queue/queue.service';
import { type CoreLoyaltyClient, CoreLoyaltyError } from '../core-client/core-loyalty.client';
import type { LoyaltyBulkOperationRow, LoyaltyBulkOpRowRow, LoyaltyDatabase } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import { LOYALTY_CORE_CLIENT } from '../tokens';
import { LOYALTY_QUEUE_NAMES, type LoyaltyBulkMessage } from './loyalty-queues';

/**
 * Drains `loyalty-bulk-ops` and applies each row to the Core Loyalty ledger
 * (TRD §6). Wizzy-sync worker pattern: runs only when
 * `LOYALTY_WORKER_ENABLED=true`; ack on success, thrown error → no ack →
 * redelivery after the visibility timeout.
 *
 * Per row (concurrency `LOYALTY_BULK_CONCURRENCY`, default 5):
 *   - debit ops pre-check the Core balance — shortfall marks the row failed
 *     (`Insufficient balance`) WITHOUT any Core write;
 *   - credit/debit carry the idempotency key `bulk:{opId}:{rowNumber}` so a
 *     redelivered message never double-credits (the Core ledger dedupes);
 *   - permanent Core 4xx (`insufficient_balance`/`bad_request`/`not_found`)
 *     fail just that row; transient kinds THROW so the whole message
 *     redelivers and un-processed rows stay `pending` (crash-resume =
 *     `WHERE status='pending'`);
 *   - op counters are incremented atomically per row
 *     (`SET processed_rows = processed_rows + 1 …`).
 * After a batch, an op with no `pending` rows left flips to `done`.
 */
@Injectable()
export class BulkWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BulkWorker.name);
  private running = false;

  private readonly VISIBILITY = Number(process.env.LOYALTY_BULK_VISIBILITY ?? 300);

  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly queue: QueueService,
    @Inject(LOYALTY_CORE_CLIENT) private readonly core: CoreLoyaltyClient,
  ) {}

  onModuleDestroy(): void {
    this.running = false;
  }

  onModuleInit(): void {
    if (process.env.LOYALTY_WORKER_ENABLED !== 'true') {
      this.logger.log('Loyalty bulk worker disabled (LOYALTY_WORKER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'Loyalty bulk worker started', visibility: this.VISIBILITY });
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error({ msg: 'Loyalty bulk worker loop error', err });
        await sleep(1000);
      }
    }
  }

  async drainOnce(): Promise<void> {
    const msgs = await this.queue.receive<LoyaltyBulkMessage>(
      LOYALTY_QUEUE_NAMES.bulkOps,
      10,
      5,
      this.VISIBILITY,
    );
    for (const m of msgs) {
      try {
        await this.processBatch(m.body);
        await this.queue.ack(LOYALTY_QUEUE_NAMES.bulkOps, [m.receiptHandle]);
      } catch (err) {
        this.logger.error({ msg: 'Loyalty bulk message failed (will retry)', err });
      }
    }
  }

  private async processBatch(msg: LoyaltyBulkMessage): Promise<void> {
    const op = await this.handle.db
      .selectFrom('loyalty_bulk_operations')
      .selectAll()
      .where('id', '=', msg.opId)
      .where('merchantId', '=', msg.merchantId)
      .executeTakeFirst();
    if (!op || op.status !== 'processing') {
      this.logger.warn({
        msg: 'Loyalty bulk message skipped (missing or non-processing op)',
        opId: msg.opId,
        status: op?.status ?? 'missing',
      });
      return;
    }

    const rows = await this.handle.db
      .selectFrom('loyalty_bulk_operation_rows')
      .selectAll()
      .where('operationId', '=', msg.opId)
      .where('id', 'in', msg.rowIds)
      .where('status', '=', 'pending')
      .orderBy('rowNumber', 'asc')
      .execute();

    const concurrency = Math.max(1, Number(process.env.LOYALTY_BULK_CONCURRENCY ?? 5));
    for (let i = 0; i < rows.length; i += concurrency) {
      await Promise.all(rows.slice(i, i + concurrency).map((row) => this.processRow(op, row)));
    }

    const pendingLeft = await this.handle.db
      .selectFrom('loyalty_bulk_operation_rows')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('operationId', '=', msg.opId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (Number(pendingLeft?.count ?? 0) === 0) {
      await this.handle.db
        .updateTable('loyalty_bulk_operations')
        .set({ status: 'done', updatedAt: new Date() })
        .where('id', '=', msg.opId)
        .execute();
    }
  }

  /**
   * Apply one pending row. Permanent outcomes update the row + op counters;
   * transient Core errors are re-thrown so the caller leaves the message
   * un-acked (the row stays `pending` for the redelivery).
   */
  private async processRow(op: LoyaltyBulkOperationRow, row: LoyaltyBulkOpRowRow): Promise<void> {
    try {
      if (op.type === 'debit') {
        const balance = await this.core.balance(op.merchantId, row.phone);
        if (balance.points_balance < row.points) {
          await this.markRow(op.id, row.id, 'failed', { errorReason: 'Insufficient balance' });
          return;
        }
      }

      const input = {
        merchantId: op.merchantId,
        phone: row.phone,
        points: row.points,
        idempotencyKey: `bulk:${op.id}:${row.rowNumber}`,
        description: row.reason ?? `Bulk ${op.type}`,
        metadata: { source: 'bulk_upload', operation_id: op.id },
      };
      const res =
        op.type === 'credit' ? await this.core.credit(input) : await this.core.debit(input);

      await this.markRow(op.id, row.id, 'success', { coreTransactionId: res.transaction_id });
    } catch (err) {
      if (err instanceof CoreLoyaltyError) {
        if (err.kind === 'insufficient_balance') {
          await this.markRow(op.id, row.id, 'failed', { errorReason: 'Insufficient balance' });
          return;
        }
        if (err.kind === 'bad_request' || err.kind === 'not_found') {
          await this.markRow(op.id, row.id, 'failed', { errorReason: err.kind });
          return;
        }
      }
      // Transient (upstream_error / rate_limited / unauthorized /
      // invalid_response) or unknown — redeliver the whole message.
      throw err;
    }
  }

  /** Row terminal update + atomic per-row op counter increments. */
  private async markRow(
    opId: string,
    rowId: number,
    status: 'success' | 'failed',
    extra: { coreTransactionId?: string; errorReason?: string },
  ): Promise<void> {
    await this.handle.db
      .updateTable('loyalty_bulk_operation_rows')
      .set({
        status,
        coreTransactionId: extra.coreTransactionId ?? null,
        errorReason: extra.errorReason ?? null,
        processedAt: new Date(),
      })
      .where('id', '=', rowId)
      .where('status', '=', 'pending')
      .execute();

    await this.handle.db
      .updateTable('loyalty_bulk_operations')
      .set((eb) => ({
        processedRows: eb('processedRows', '+', 1),
        ...(status === 'success'
          ? { successCount: eb('successCount', '+', 1) }
          : { failureCount: eb('failureCount', '+', 1) }),
        updatedAt: new Date(),
      }))
      .where('id', '=', opId)
      .execute();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
