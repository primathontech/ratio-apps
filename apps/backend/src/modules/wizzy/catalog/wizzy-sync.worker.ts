import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { QueueService } from '../../../core/queue/queue.service';
import { WIZZY_RATIO_PRODUCTS } from '../tokens';
import { CatalogSyncService, type RatioProductsPort } from './catalog-sync.service';
import { WIZZY_QUEUE_NAMES, type WizzySyncMessage } from './wizzy-sync.queue';

/**
 * Drains the `wizzy-product-sync` SQS queue and pushes each product to Wizzy.
 *
 * Per message:
 *   - `upsert` → fetch the authoritative product by id (so the transformed
 *     payload is the same rich REST structure as full sync) → then
 *     {@link CatalogSyncService.syncProduct}, ack on success.
 *   - `delete` → {@link CatalogSyncService.deleteProduct} then ack on success.
 * On a thrown error the message is NOT acked, so it redelivers after the
 * visibility timeout. After `maxReceiveCount` failed receives, SQS's redrive
 * policy moves it to the DLQ.
 *
 * Runs only when WIZZY_SYNC_WORKER_ENABLED=true.
 */
@Injectable()
export class WizzySyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WizzySyncWorker.name);
  private running = false;

  private readonly VISIBILITY = Number(process.env.WIZZY_SYNC_VISIBILITY ?? 120);

  constructor(
    private readonly queue: QueueService,
    private readonly catalogSync: CatalogSyncService,
    @Inject(WIZZY_RATIO_PRODUCTS) private readonly products: RatioProductsPort,
  ) {}

  onModuleDestroy(): void {
    this.running = false;
  }

  onModuleInit(): void {
    if (process.env.WIZZY_SYNC_WORKER_ENABLED !== 'true') {
      this.logger.log('Wizzy product-sync worker disabled (WIZZY_SYNC_WORKER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'Wizzy product-sync worker started', visibility: this.VISIBILITY });
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error({ msg: 'Wizzy product-sync worker loop error', err });
        await this.sleep(1000);
      }
    }
  }

  async drainOnce(): Promise<void> {
    const msgs = await this.queue.receive<WizzySyncMessage>(
      WIZZY_QUEUE_NAMES.sync,
      10,
      5,
      this.VISIBILITY,
    );
    for (const m of msgs) {
      try {
        await this.process(m.body);
        await this.queue.ack(WIZZY_QUEUE_NAMES.sync, [m.receiptHandle]);
      } catch (err) {
        this.logger.error({ msg: 'Wizzy product-sync message failed (will retry)', err });
      }
    }
  }

  private async process(msg: WizzySyncMessage): Promise<void> {
    if (msg.op !== 'upsert') {
      await this.catalogSync.deleteProduct(msg.merchantId, msg.productId);
      return;
    }
    // Rollover: a message enqueued before the fetch-by-id change carried the
    // parsed product. Honor it directly for one deploy.
    if (msg.product) {
      await this.catalogSync.syncProduct(msg.merchantId, msg.product, 'webhook');
      return;
    }
    // Fetch the authoritative product by id so we transform the same rich
    // REST-shaped payload as full sync (collections/metafields/availability),
    // not the leaner webhook payload.
    const product = await this.products.getById(msg.merchantId, msg.productId);
    await this.catalogSync.syncProduct(msg.merchantId, product, 'webhook');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
