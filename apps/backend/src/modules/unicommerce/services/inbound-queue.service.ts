import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';
import { UcEventLogService } from './event-log.service';
import {
  UcInventoryUpdateWorkerService,
  type InventoryUpdatePayload,
} from './inventory-update-worker.service';
import {
  UcStatusNotifyWorkerService,
  type StatusNotifyPayload,
} from './status-notify-worker.service';

// Wire contract with the standalone producer (apps/uc-inbound-ingest publishes
// `{ jobId, merchantId, type }` here). Single shared topic; the consumer
// branches on the `type` field. The producer is responsible for ensuring the
// topic exists (it calls ensureTopic at startup, same producer-side
// responsibility the outbound path established in sync-queue.service.ts).
export const UC_INBOUND_EVENTS_TOPIC = 'unicommerce-inbound-events';

// Same terminal-error vocabulary as sync-queue.service.ts (outbound), extended
// with the inbound workers' own terminal errors: an item that no longer exists
// or a status we can't map will never succeed on retry — straight to the DLQ.
const NON_RECOVERABLE_PATTERNS = [
  /unknown orderItemId/i,
  /unrecognized status/i,
  /unknown variant/i,
  /sku not found/i,
  /invalid facility/i,
  /validation/i,
];

// Duplicate of sync-queue.service.ts's ladder helper (base^1, base^2, ...,
// base^attempts). Extracting it to a shared location would mean touching the
// outbound path for zero behavior change — the two copies are 3 lines and the
// env-driven settings they read are the same, so a copy is the less disruptive
// option; they cannot drift because both read UC_RETRY_LADDER_*.
function buildRetryDelaysMs(baseSeconds: number, attempts: number): number[] {
  return Array.from({ length: attempts }, (_, i) => Math.round(baseSeconds ** (i + 1) * 1000));
}

/**
 * Consumer-side processor for `uc_inbound_jobs` rows (migration 0003) —
 * structured exactly like `UcSyncQueueService.attemptImmediate`: atomic
 * claim (status PENDING/RETRYING/NEEDS_MANUAL → IN_PROGRESS), load the job
 * row, drive the retry ladder, DONE on success, `uc_dlq` + NEEDS_MANUAL on
 * terminal failure. Dispatches by `type` to the per-flow workers and writes
 * the dashboard-visible `uc_event_logs` row (direction 'inbound') — the row
 * apps/uc-inbound-ingest deliberately does NOT write, so dashboard visibility
 * is delayed until actual processing, not lost.
 *
 * `attempt_count` is intentionally not incremented during retries — the
 * outbound path (`uc_sync_jobs`) behaves identically, and this module's
 * convention is that the retry ladder lives in-process (the column stays for
 * future sweeps).
 */
@Injectable()
export class UcInboundQueueService {
  private readonly logger = new Logger(UcInboundQueueService.name);
  private readonly retryDelaysMs: number[];

  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
    private readonly statusWorker: UcStatusNotifyWorkerService,
    private readonly inventoryWorker: UcInventoryUpdateWorkerService,
    private readonly eventLog: UcEventLogService,
    config: ConfigService<Env, true>,
  ) {
    this.retryDelaysMs = buildRetryDelaysMs(
      config.get('UC_RETRY_LADDER_BASE_SECONDS', { infer: true }),
      config.get('UC_RETRY_LADDER_ATTEMPTS', { infer: true }),
    );
  }

  async attemptImmediate(jobId: string): Promise<void> {
    const claim = await this.handle.db
      .updateTable('ucInboundJobs')
      .set({ status: 'IN_PROGRESS' })
      .where('id', '=', jobId)
      .where('status', 'in', ['PENDING', 'RETRYING', 'NEEDS_MANUAL'])
      .executeTakeFirst();

    if (Number(claim?.numUpdatedRows ?? 0) === 0) {
      return;
    }

    const job = await this.handle.db
      .selectFrom('ucInboundJobs')
      .selectAll()
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();

    for (const delayMs of this.retryDelaysMs) {
      try {
        const result =
          job.type === 'status_notify'
            ? await this.statusWorker.apply(
                job.merchantId,
                job.payload as unknown as StatusNotifyPayload,
              )
            : await this.inventoryWorker.apply(
                job.merchantId,
                job.payload as unknown as InventoryUpdatePayload,
              );

        await this.handle.db
          .updateTable('ucInboundJobs')
          .set({ status: 'DONE' })
          .where('id', '=', jobId)
          .execute();
        await this.safeRecordEvent({
          merchantId: job.merchantId,
          direction: 'inbound',
          flow: job.type === 'status_notify' ? 'status' : 'inventory',
          reference:
            job.type === 'status_notify'
              ? (job.payload as unknown as StatusNotifyPayload).orderItemId
              : (job.payload as unknown as InventoryUpdatePayload).variantId,
          result: 'success',
          payload: job.payload,
          response: result,
          jobId: job.id,
        });
        return;
      } catch (err) {
        if (this.isNonRecoverable(err)) {
          await this.moveToDlq(jobId, err);
          return;
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    await this.moveToDlq(jobId, new Error(`retry limit exceeded after ${this.retryDelaysMs.length} attempts`));
  }

  private isNonRecoverable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return NON_RECOVERABLE_PATTERNS.some((p) => p.test(message));
  }

  private async safeRecordEvent(entry: Parameters<UcEventLogService['record']>[0]): Promise<void> {
    try {
      await this.eventLog.record(entry);
    } catch (err) {
      this.logger.error({
        msg: 'event-log write failed — job status already committed, not retrying because of this',
        err: err instanceof Error ? err.message : String(err),
        reference: entry.reference,
        flow: entry.flow,
        result: entry.result,
      });
    }
  }

  private async moveToDlq(jobId: string, error: unknown): Promise<void> {
    const job = await this.handle.db
      .selectFrom('ucInboundJobs')
      .selectAll()
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
    // `uc_dlq` (0001) is generic enough to reuse as-is: merchant_id,
    // original_job_id (a char(36) UUID either way), payload, attempts,
    // last_error. Nothing in the codebase joins uc_dlq back to uc_sync_jobs,
    // so an inbound job's id fits without a schema change (see migration 0003).
    await this.handle.db
      .insertInto('ucDlq')
      .values({
        merchantId: job.merchantId,
        originalJobId: job.id,
        payload: JSON.stringify(job.payload) as unknown as Record<string, unknown>,
        attempts: job.attemptCount,
        lastError: error instanceof Error ? error.message : String(error),
      })
      .execute();
    await this.handle.db
      .updateTable('ucInboundJobs')
      .set({ status: 'NEEDS_MANUAL' })
      .where('id', '=', jobId)
      .execute();
    await this.safeRecordEvent({
      merchantId: job.merchantId,
      direction: 'inbound',
      flow: job.type === 'status_notify' ? 'status' : 'inventory',
      reference:
        job.type === 'status_notify'
          ? (job.payload as unknown as StatusNotifyPayload).orderItemId
          : (job.payload as unknown as InventoryUpdatePayload).variantId,
      result: 'failed',
      payload: job.payload,
      response: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    });
    this.logger.warn({ msg: 'inbound job moved to DLQ', jobId });
  }
}
