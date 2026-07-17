import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../../core/queue/queue.service';
import { DELHIVERY_QUEUE_NAMES, type DelhiveryShipmentMessage } from './shipment-create.queue';
import { DelhiveryShipmentService } from './shipment.service';

/**
 * Drains the `delhivery-shipment-create` SQS queue (mirrors the google
 * product-sync worker). The orders/* webhook handlers enqueue references;
 * this worker fetches the authoritative order and runs the shipment op.
 *
 * Per message:
 *   - `create`   → {@link DelhiveryShipmentService.createForOrder} (auto mode)
 *   - `cancel`   → {@link DelhiveryShipmentService.cancelForOrder}
 *   - `recreate` → {@link DelhiveryShipmentService.recreateForOrder}
 *
 * Ack ONLY on success — a thrown error (Delhivery 5xx/429, order API down)
 * leaves the message for redelivery after the visibility timeout; after
 * `maxReceiveCount` failed receives SQS's redrive policy moves it to the DLQ
 * ({@link DELHIVERY_QUEUE_NAMES.dlq}) — configured as infra/IaC. This is the
 * "retry 3× exp-backoff" resilience path from the TRD.
 *
 * Runs only when DELHIVERY_SHIPMENT_WORKER_ENABLED=true.
 */
@Injectable()
export class ShipmentCreateWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShipmentCreateWorker.name);
  private running = false;

  // Visibility window must sit above per-message time (order fetch + products
  // + manifestation + order mirror) so an in-flight message doesn't redeliver.
  private readonly VISIBILITY = Number(process.env.DELHIVERY_SHIPMENT_VISIBILITY ?? 120);

  constructor(
    private readonly queue: QueueService,
    private readonly shipments: DelhiveryShipmentService,
  ) {}

  onModuleDestroy(): void {
    this.running = false;
  }

  onModuleInit(): void {
    if (process.env.DELHIVERY_SHIPMENT_WORKER_ENABLED !== 'true') {
      this.logger.log('Delhivery shipment worker disabled (DELHIVERY_SHIPMENT_WORKER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'Delhivery shipment worker started', visibility: this.VISIBILITY });
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error({ msg: 'Delhivery shipment worker loop error', err });
        await this.sleep(1000);
      }
    }
  }

  /** Receive one batch (≤10) and process each message. Exposed for deterministic tests. */
  async drainOnce(): Promise<void> {
    const msgs = await this.queue.receive<DelhiveryShipmentMessage>(
      DELHIVERY_QUEUE_NAMES.shipments,
      10,
      5,
      this.VISIBILITY,
    );
    for (const m of msgs) {
      try {
        await this.process(m.body);
        // ack only on success; a thrown error leaves the message for redrive.
        await this.queue.ack(DELHIVERY_QUEUE_NAMES.shipments, [m.receiptHandle]);
      } catch (err) {
        // Not acked → redelivers after VISIBILITY; eventually → DLQ via redrive.
        this.logger.error({ msg: 'Delhivery shipment message failed (will retry)', err: `${err}` });
      }
    }
  }

  private async process(msg: DelhiveryShipmentMessage): Promise<void> {
    const ref = { orderId: msg.orderId, orderNumber: msg.orderNumber };
    switch (msg.op) {
      case 'create':
        await this.shipments.createForOrder(msg.merchantId, ref);
        return;
      case 'cancel':
        await this.shipments.cancelForOrder(msg.merchantId, ref);
        return;
      case 'recreate':
        await this.shipments.recreateForOrder(msg.merchantId, ref);
        return;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
