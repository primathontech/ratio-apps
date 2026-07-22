import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { QueueService } from '../../../core/queue/queue.service';
import type { FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { formsWebhookQueueName, type WebhookDeliveryMessage } from './webhook-delivery.queue';
import { WebhookDeliveryService } from './webhook-delivery.service';

/**
 * Drains the forms webhook-delivery SQS queue (google-product-sync worker
 * precedent): self-gated by `FORMS_WEBHOOK_WORKER_ENABLED`, long-polls via
 * the core `QueueService`, loads each message's `form_webhook_deliveries`
 * row, and hands it to {@link WebhookDeliveryService.execute} — the executor
 * owns the retry state machine (2xx → delivered; failures → 5m/20m/1h ladder
 * → failed) and never throws.
 *
 * Messages are acked after the attempt settles (the OUTCOME lives in the DB
 * row, so a redelivered message is harmless: rows no longer `pending` are
 * skipped). A message whose row has vanished is acked and dropped.
 *
 * PII: submission payloads never appear in log lines — ids and counts only.
 */
@Injectable()
export class WebhookDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);
  private running = false;

  /** Above the executor's 10s POST timeout so in-flight messages don't redeliver. */
  private readonly VISIBILITY = Number(process.env.FORMS_WEBHOOK_VISIBILITY ?? 120);

  constructor(
    private readonly queue: QueueService,
    private readonly executor: WebhookDeliveryService,
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
  ) {}

  onModuleInit(): void {
    if (process.env.FORMS_WEBHOOK_WORKER_ENABLED !== 'true') {
      this.logger.log('forms webhook worker disabled (FORMS_WEBHOOK_WORKER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'forms webhook worker started', visibility: this.VISIBILITY });
    void this.loop();
  }

  onModuleDestroy(): void {
    // Stop the loop; the in-flight drainOnce() finishes (un-acked messages
    // redeliver, no loss), then loop() exits.
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error({ msg: 'forms webhook worker loop error', err: `${err}` });
        await this.sleep(1000);
      }
    }
  }

  /** Receive one batch (≤10) and attempt each delivery. Exposed for deterministic tests. */
  async drainOnce(): Promise<void> {
    const queueName = formsWebhookQueueName();
    const msgs = await this.queue.receive<WebhookDeliveryMessage>(
      queueName,
      10,
      5,
      this.VISIBILITY,
    );
    for (const m of msgs) {
      try {
        await this.process(m.body);
        await this.queue.ack(queueName, [m.receiptHandle]);
      } catch (err) {
        // Not acked → redelivers after VISIBILITY. Never log the payload.
        this.logger.error({
          msg: 'forms webhook message failed (will retry)',
          deliveryId: m.body?.deliveryId,
          err: `${err}`,
        });
      }
    }
  }

  private async process(msg: WebhookDeliveryMessage): Promise<void> {
    const row = await this.handle.db
      .selectFrom('form_webhook_deliveries')
      .selectAll()
      .where('id', '=', msg.deliveryId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      this.logger.warn({ msg: 'webhook delivery row vanished — dropping', id: msg.deliveryId });
      return;
    }
    if (row.status !== 'pending') {
      // Already settled (double-fire / redelivery) — the claim lease plus
      // this check make the pipeline idempotent (TDD §3.7).
      return;
    }
    await this.executor.execute(row);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
