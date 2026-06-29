import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseWithMerchants, MerchantRow } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { WizzyDatabase } from '../db/types';
import { WIZZY_WEBHOOK_TOPICS } from './topics';

/**
 * Handle app uninstall:
 *   - wizzy_configs: wizzyEnabled = false
 *   - merchants.is_active = false, uninstalled_at = now()
 *
 * IMPORTANT: this handler runs INSIDE the webhook-dispatch transaction.
 * All writes go through `trx` for the all-or-nothing webhook_log guarantee.
 */
@Injectable()
export class WizzyAppUninstalledHandler implements WebhookHandler {
  readonly topic = WIZZY_WEBHOOK_TOPICS.appUninstalled;
  private readonly logger = new Logger(WizzyAppUninstalledHandler.name);

  async handle(
    _data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'app/uninstalled for unknown merchant — no-op' });
      return;
    }

    // Serialize against an in-flight OAuth callback.
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

    // Disable the app config inside the transaction.
    await (trx as unknown as Transaction<WizzyDatabase>)
      .updateTable('wizzy_configs')
      .set({
        wizzyEnabled: false,
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

    this.logger.log({ msg: 'merchant uninstalled', merchantId });
  }
}
