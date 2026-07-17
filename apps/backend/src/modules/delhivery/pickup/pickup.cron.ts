import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { DelhiveryDatabase, DelhiveryShipmentRow } from '../db/types';
import { DELHIVERY_DB_TOKEN } from '../kysely.module';
import { DelhiverySdkService } from '../sdk/sdk.service';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** `HH:mm` and `YYYY-MM-DD` in IST for a given instant. */
export function istParts(now: Date): { hhmm: string; date: string } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    hhmm: `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`,
    date: `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`,
  };
}

/**
 * Daily pickup/manifest at each merchant's configured cutoff (default 10:00
 * IST). Runs every 15 minutes; a merchant is due once the IST clock passes
 * their `pickup_cutoff`. Shipments already covered by a pickup request carry
 * `pickup_requested_at` — only un-requested `awaiting_pickup` shipments
 * trigger (and are then stamped), so a merchant gets at most one request per
 * batch of new shipments.
 *
 * The admin's manual "Request Pickup" button calls {@link requestNow}.
 */
@Injectable()
export class PickupCron {
  private readonly logger = new Logger(PickupCron.name);
  private running = false;

  constructor(
    @Inject(DELHIVERY_DB_TOKEN) private readonly handle: KyselyClient<DelhiveryDatabase>,
    private readonly sdk: DelhiverySdkService,
  ) {}

  @Cron('*/15 * * * *')
  async cycle(): Promise<void> {
    await this.runOnce(new Date());
  }

  /** One cutoff sweep. Exposed for deterministic tests. */
  async runOnce(now: Date): Promise<{ ran: boolean; merchants: number }> {
    if (this.running) return { ran: false, merchants: 0 };
    this.running = true;
    try {
      const { hhmm } = istParts(now);
      const configs = await this.handle.db
        .selectFrom('delhivery_configs')
        .innerJoin('merchants', 'merchants.id', 'delhivery_configs.merchantId')
        .select(['delhivery_configs.merchantId as merchantId', 'delhivery_configs.pickupCutoff as pickupCutoff'])
        .where('merchants.isActive', '=', true)
        .where('delhivery_configs.enabled', '=', true)
        .execute();

      let requested = 0;
      for (const config of configs) {
        // Due when the IST clock has passed the merchant's cutoff ('HH:mm'
        // strings compare lexicographically).
        if (hhmm < config.pickupCutoff) continue;
        try {
          const did = await this.requestForMerchant(config.merchantId, now);
          if (did) requested += 1;
        } catch (err) {
          this.logger.error({ msg: 'pickup request failed', merchantId: config.merchantId, err: `${err}` });
        }
      }
      return { ran: true, merchants: requested };
    } finally {
      this.running = false;
    }
  }

  /** Manual "Request Pickup" from the admin. */
  async requestNow(merchantId: string, date?: string): Promise<{ scheduled: boolean; count: number }> {
    const pending = await this.pendingShipments(merchantId);
    if (pending.length === 0) return { scheduled: false, count: 0 };
    const { date: today } = istParts(new Date());
    await this.sdk.requestPickup(merchantId, { date: date ?? today, count: pending.length });
    await this.stamp(pending);
    return { scheduled: true, count: pending.length };
  }

  private async requestForMerchant(merchantId: string, now: Date): Promise<boolean> {
    const pending = await this.pendingShipments(merchantId);
    if (pending.length === 0) return false;
    const { date } = istParts(now);
    await this.sdk.requestPickup(merchantId, { date, count: pending.length });
    await this.stamp(pending);
    this.logger.log({ msg: 'pickup scheduled', merchantId, count: pending.length });
    return true;
  }

  /** Manifested-but-never-requested shipments awaiting pickup. */
  private async pendingShipments(merchantId: string): Promise<DelhiveryShipmentRow[]> {
    return (await this.handle.db
      .selectFrom('delhivery_shipments')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('status', '=', 'awaiting_pickup')
      .where('active', '=', true)
      .where('awb', 'is not', null)
      .where('pickupRequestedAt', 'is', null)
      .execute()) as DelhiveryShipmentRow[];
  }

  private async stamp(shipments: DelhiveryShipmentRow[]): Promise<void> {
    if (shipments.length === 0) return;
    await this.handle.db
      .updateTable('delhivery_shipments')
      .set({ pickupRequestedAt: sql`CURRENT_TIMESTAMP(3)` } as never)
      .where(
        'id',
        'in',
        shipments.map((s) => s.id),
      )
      .execute();
  }
}
