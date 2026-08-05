import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseWithMerchants, MerchantRow } from '../../../core/merchants/merchant.types';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { FbtDatabase } from '../db/types';
import { FBT_MERCHANTS } from '../tokens';
import { FBT_TOPICS } from './topics';

/**
 * Soft-delete the merchant on uninstall.
 *   - merchants.is_active = false, uninstalled_at = now()
 *   - fbt_merchant_config preserved (so reinstall restores prior settings)
 *   - oauth_tokens preserved until a follow-up cleanup job
 *
 * The admin UI checks `merchant.isActive` on bootstrap and routes inactive
 * merchants to `/disabled` instead of breaking the config flow.
 *
 * IMPORTANT: this handler runs INSIDE the webhook-dispatch transaction
 * (see `WebhooksService.dispatch`). All writes go through `trx`, not
 * `this.merchants` — otherwise the merchant update would live in a
 * different transaction from the `webhook_log` row, breaking the
 * all-or-nothing self-healing guarantee.
 */
@Injectable()
export class FbtAppUninstalledHandler implements WebhookHandler {
  // NOTE: webhook `topic` must equal the EXACT `event` string the Ratio
  // runtime delivers. This example uses dot-form (`app.uninstalled`), but the
  // platform webhook registry documents slash-form (`app/uninstalled`). Verify
  // against a live delivery when scaffolding — a wrong topic silently no-ops
  // (the dispatcher's topic-mismatch fast-path). See docs/agent/context/learnings.md.
  readonly topic = FBT_TOPICS.APP_UNINSTALLED;
  private readonly logger = new Logger(FbtAppUninstalledHandler.name);

  constructor(
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: this handler soft-deletes the merchant via `trx` (see note above), not through the injected service, so this field goes unused
    @Inject(FBT_MERCHANTS) private readonly merchants: MerchantsService<FbtDatabase>,
  ) {}

  async handle(
    _data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'app.uninstalled for unknown merchant — no-op' });
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
        msg: 'app.uninstalled for already-inactive merchant — no-op (likely a retry)',
        merchantId,
      });
      return;
    }
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
