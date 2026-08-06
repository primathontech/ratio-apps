import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { KafkaService } from '../../../core/kafka/kafka.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';
import { UcCancelPushWorkerService } from './cancel-push-worker.service';
import { UcEventLogService } from './event-log.service';
import { UcOrderPushWorkerService } from './order-push-worker.service';

const NON_RECOVERABLE_PATTERNS = [/sku not found/i, /invalid facility/i, /validation/i];

const UC_ORDER_PUSH_TOPIC = 'unicommerce-order-push';
const UC_ORDER_CANCEL_TOPIC = 'unicommerce-order-cancel';

function buildRetryDelaysMs(baseSeconds: number, attempts: number): number[] {
  return Array.from({ length: attempts }, (_, i) => Math.round(baseSeconds ** (i + 1) * 1000));
}

export interface PublishMeta {
  merchantId: string;
  type: 'order_push' | 'cancel_push';
  ratioOrderId: string;
}

@Injectable()
export class UcSyncQueueService implements OnModuleInit {
  private readonly logger = new Logger(UcSyncQueueService.name);
  private readonly retryDelaysMs: number[];

  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
    private readonly kafka: KafkaService,
    private readonly pushWorker: UcOrderPushWorkerService,
    private readonly cancelPushWorker: UcCancelPushWorkerService,
    private readonly eventLog: UcEventLogService,
    config: ConfigService<Env, true>,
  ) {
    this.retryDelaysMs = buildRetryDelaysMs(
      config.get('UC_RETRY_LADDER_BASE_SECONDS', { infer: true }),
      config.get('UC_RETRY_LADDER_ATTEMPTS', { infer: true }),
    );
  }

  // The producer side (this service's `publish()`) must not depend on the
  // consumer/worker (`UcOutboundConsumerService`, gated behind
  // UNICOMMERCE_OUTBOUND_WORKER_ENABLED and a separate deployable in
  // production) having started first to create the topics — found via local
  // verification: with the worker disabled and the broker's
  // auto-create-topics off, every `publish()` call failed outright until
  // something else happened to call `ensureTopics()` first.
  async onModuleInit(): Promise<void> {
    await this.ensureTopics();
  }

  async ensureTopics(): Promise<void> {
    await this.kafka.ensureTopic(UC_ORDER_PUSH_TOPIC);
    await this.kafka.ensureTopic(UC_ORDER_CANCEL_TOPIC);
  }

  async publish(jobId: string, meta: PublishMeta): Promise<void> {
    const topic = meta.type === 'cancel_push' ? UC_ORDER_CANCEL_TOPIC : UC_ORDER_PUSH_TOPIC;
    await this.kafka.send({
      topic,
      messages: [{ key: meta.merchantId, value: JSON.stringify({ jobId, ...meta }) }],
    });
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

  async attemptImmediate(jobId: string): Promise<void> {
    const claim = await this.handle.db
      .updateTable('ucSyncJobs')
      .set({ status: 'IN_PROGRESS' })
      .where('id', '=', jobId)
      .where('status', 'in', ['PENDING', 'RETRYING', 'NEEDS_MANUAL'])
      .executeTakeFirst();

    if (Number(claim?.numUpdatedRows ?? 0) === 0) {
      return;
    }

    const job = await this.handle.db
      .selectFrom('ucSyncJobs')
      .selectAll()
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();

    for (const delayMs of this.retryDelaysMs) {
      try {
        if (job.type === 'cancel_push') {
          const payload = job.payload as {
            merchantId: string;
            ratioOrderId: string;
            saleOrderCode: string;
            reason: string;
          };
          const result = await this.cancelPushWorker.push(
            payload.merchantId,
            payload.ratioOrderId,
            payload.saleOrderCode,
            payload.reason,
          );
          await this.handle.db
            .updateTable('ucSyncJobs')
            .set({ status: 'DONE' })
            .where('id', '=', jobId)
            .execute();
          await this.safeRecordEvent({
            merchantId: job.merchantId,
            direction: 'outbound',
            flow: 'cancel',
            reference: job.ratioOrderId,
            result: 'success',
            payload: job.payload,
            response: result,
            jobId: job.id,
          });
          if (result.alreadyDispatched) {
            this.logger.warn({
              msg: 'UC reports order already dispatched — cancel not applied, surfacing as dashboard warning',
              jobId,
              ratioOrderId: job.ratioOrderId,
            });
          }
          return;
        }

        const payload = job.payload as {
          merchantId: string;
          ratioOrderId: string;
          order: never;
        };
        const result = await this.pushWorker.push(payload);
        // UC's real response has no order-identifying field at all (Open
        // Item #5, confirmed against postorders.html) — `job.ratioOrderId`
        // (our own order id) is used as the surrogate saleOrderCode, per
        // the TRD's decision, not anything read off `result`.
        await this.handle.db
          .updateTable('ucSyncJobs')
          .set({ status: 'DONE', saleOrderCode: job.ratioOrderId })
          .where('id', '=', jobId)
          .execute();
        await this.safeRecordEvent({
          merchantId: job.merchantId,
          direction: 'outbound',
          flow: 'order_push',
          reference: job.ratioOrderId,
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

  private async moveToDlq(jobId: string, error: unknown): Promise<void> {
    const job = await this.handle.db
      .selectFrom('ucSyncJobs')
      .selectAll()
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
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
      .updateTable('ucSyncJobs')
      .set({ status: 'NEEDS_MANUAL' })
      .where('id', '=', jobId)
      .execute();
    await this.safeRecordEvent({
      merchantId: job.merchantId,
      direction: 'outbound',
      flow: job.type === 'order_push' ? 'order_push' : 'cancel',
      reference: job.ratioOrderId,
      result: 'failed',
      payload: job.payload,
      response: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    });
    this.logger.warn({ msg: 'job moved to DLQ', jobId });
  }
}
