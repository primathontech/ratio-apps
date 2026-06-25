import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseWithMerchants, MerchantRow } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { WizzyDatabase } from '../db/types';
import { SdkRegistrationService } from '../sdk/sdk-registration.service';
import { WIZZY_WEBHOOK_TOPICS } from './topics';

/**
 * Handle app uninstall:
 *   - delete ScriptTag (guarded — never throws)
 *   - wizzy_configs: wizzyEnabled = false, scriptTagStatus = 'disabled'
 *   - merchants.is_active = false, uninstalled_at = now()
 *
 * IMPORTANT: this handler runs INSIDE the webhook-dispatch transaction.
 * All writes go through `trx` for the all-or-nothing webhook_log guarantee.
 * The ScriptTagClient call is OUTSIDE the transaction (network call) but is
 * guarded (never throws).
 */
@Injectable()
export class WizzyAppUninstalledHandler implements WebhookHandler {
  readonly topic = WIZZY_WEBHOOK_TOPICS.appUninstalled;
  private readonly logger = new Logger(WizzyAppUninstalledHandler.name);

  constructor(private readonly sdk: SdkRegistrationService) {}

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

    // Delete the ScriptTag (guarded — the API may be draft/unavailable).
    // This call is outside the DB transaction (network) but never throws.
    await this.sdk.delete(merchantId);

    // Disable the app config inside the transaction.
    await (trx as unknown as Transaction<WizzyDatabase>)
      .updateTable('wizzy_configs')
      .set({
        wizzyEnabled: false,
        scriptTagStatus: 'disabled',
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

    this.logger.log({ msg: 'merchant uninstalled, script tag deleted', merchantId });
  }
}
