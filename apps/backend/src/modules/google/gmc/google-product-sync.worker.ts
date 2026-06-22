import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { QueueService } from '../../../core/queue/queue.service';
import { FeedSyncService } from './feed-sync.service';
import { GOOGLE_QUEUE_NAMES, type GoogleSyncMessage } from './google-product-sync.queue';

/**
 * Drains the `google-product-sync` SQS queue and pushes each product to GMC.
 *
 * Unlike the Meta CAPI worker there is NO per-merchant batching — every message
 * is a single product op (the webhook handlers enqueue one message per product),
 * and the GMC Content API is called one product at a time. Each message carries
 * the full parsed `RatioProduct`, so the worker never re-fetches.
 *
 * Per message:
 *   - `upsert` → {@link FeedSyncService.syncProduct} then ack on success.
 *   - `delete` → {@link FeedSyncService.deleteProduct} then ack on success.
 * On a thrown error the message is NOT acked, so it redelivers after the
 * visibility timeout. After `maxReceiveCount` failed receives, SQS's redrive
 * policy moves it to the DLQ ({@link GOOGLE_QUEUE_NAMES.dlq}) — that policy is
 * configured on the queue as infra/IaC, mirroring `meta-capi-dlq`.
 *
 * Runs only when GOOGLE_SYNC_WORKER_ENABLED=true.
 */
@Injectable()
export class GoogleProductSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleProductSyncWorker.name);
  private running = false;

  // Visibility window must sit comfortably above per-message processing time so
  // an in-flight message doesn't redeliver while still being pushed to GMC.
  private readonly VISIBILITY = Number(process.env.GOOGLE_SYNC_VISIBILITY ?? 120);

  constructor(
    private readonly queue: QueueService,
    private readonly feedSync: FeedSyncService,
  ) {}

  onModuleDestroy(): void {
    // Stop the loop; the in-flight drainOnce() finishes (un-acked messages
    // redeliver, no loss), then loop() exits.
    this.running = false;
  }

  onModuleInit(): void {
    if (process.env.GOOGLE_SYNC_WORKER_ENABLED !== 'true') {
      this.logger.log('Google product-sync worker disabled (GOOGLE_SYNC_WORKER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'Google product-sync worker started', visibility: this.VISIBILITY });
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error({ msg: 'Google product-sync worker loop error', err });
        await this.sleep(1000);
      }
    }
  }

  /** Receive one batch (≤10) and process each message. Exposed for deterministic tests. */
  async drainOnce(): Promise<void> {
    const msgs = await this.queue.receive<GoogleSyncMessage>(
      GOOGLE_QUEUE_NAMES.sync,
      10,
      5,
      this.VISIBILITY,
    );
    for (const m of msgs) {
      try {
        await this.process(m.body);
        // ack only on success; a thrown error leaves the message for redrive.
        await this.queue.ack(GOOGLE_QUEUE_NAMES.sync, [m.receiptHandle]);
      } catch (err) {
        // Not acked → redelivers after VISIBILITY; eventually → DLQ via redrive.
        // Never let one bad message kill the loop.
        this.logger.error({ msg: 'Google product-sync message failed (will retry)', err });
      }
    }
  }

  private async process(msg: GoogleSyncMessage): Promise<void> {
    if (msg.op === 'upsert') {
      await this.feedSync.syncProduct(msg.merchantId, msg.product, 'webhook');
    } else {
      await this.feedSync.deleteProduct(msg.merchantId, msg.productId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
