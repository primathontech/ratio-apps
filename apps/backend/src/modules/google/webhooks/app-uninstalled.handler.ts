import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseWithMerchants, MerchantRow } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_WEBHOOK_TOPICS } from './topics';

/**
 * Handle app uninstall:
 *   - disable both pixels (`ga4_pixel_status` / `ads_pixel_status` = 'disabled')
 *   - merchants.is_active = false, uninstalled_at = now()
 *   - google_configs otherwise preserved (so reinstall restores prior settings)
 *   - oauth_tokens / google_credentials preserved until a follow-up cleanup job
 *
 * The admin UI checks `merchant.isActive` on bootstrap and routes inactive
 * merchants to `/disabled` instead of breaking the config flow.
 *
 * IMPORTANT: this handler runs INSIDE the webhook-dispatch transaction
 * (see `WebhooksService.dispatch`). All writes go through `trx`, not a
 * module-level service — otherwise the writes would live in a different
 * transaction from the `webhook_log` row, breaking the all-or-nothing
 * self-healing guarantee.
 */
@Injectable()
export class GoogleAppUninstalledHandler implements WebhookHandler {
  readonly topic = GOOGLE_WEBHOOK_TOPICS.appUninstalled;
  private readonly logger = new Logger(GoogleAppUninstalledHandler.name);

  async handle(
    _data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'app/uninstalled for unknown merchant — no-op' });
      return;
    }
    // S6: Serialize against an in-flight OAuth callback transaction touching
    // the same merchant. The callback service takes a symmetric SELECT FOR
    // UPDATE on `merchants.id` before its UPSERT, so whichever transaction
    // wins the lock here forces the other to wait until commit. Without this,
    // a callback could re-INSERT `isActive = true` AFTER our existence check
    // but BEFORE our UPDATE — leaving Ratio (uninstalled) and the DB (active)
    // out of sync.
    await sql`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`.execute(trx);
    const merchant = (await trx
      .selectFrom('merchants')
      .selectAll()
      .where('id', '=', merchantId)
      .limit(1)
      .executeTakeFirst()) as MerchantRow | undefined;
    if (!merchant?.isActive) {
      this.logger.warn({
        msg: 'app/uninstalled for already-inactive merchant — no-op (likely a retry)',
        merchantId,
      });
      return;
    }
    // Disable both pixels (same trx / same per-module DB as the merchants table).
    await (trx as unknown as Transaction<GoogleDatabase>)
      .updateTable('google_configs')
      .set({
        ga4PixelStatus: 'disabled',
        adsPixelStatus: 'disabled',
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('merchantId', '=', merchantId)
      .execute();
    await trx
      .updateTable('merchants')
      .set({
        isActive: false,
        uninstalledAt: sql`CURRENT_TIMESTAMP(3)`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('id', '=', merchantId)
      .execute();
    this.logger.log({ msg: 'merchant uninstalled, pixels disabled', merchantId });
  }
}
