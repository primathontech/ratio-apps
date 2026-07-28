import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseWithMerchants, MerchantRow } from '../../../core/merchants/merchant.types';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { FormsDatabase } from '../db/types';
import { FORMS_MERCHANTS } from '../tokens';

/** Soft-deletes the merchant on uninstall (config/tokens preserved); all writes MUST go through `trx`, not `this.merchants`, to stay in the webhook-dispatch transaction with the `webhook_log` row. */
@Injectable()
export class FormsAppUninstalledHandler implements WebhookHandler {
  // Slash-form topic per the platform webhook registry; a wrong topic silently no-ops via the dispatcher's topic-mismatch fast-path.
  readonly topic = 'app/uninstalled';
  private readonly logger = new Logger(FormsAppUninstalledHandler.name);

  constructor(
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: template demonstrates the injected MerchantsService; this handler deliberately writes via `trx` (see note above)
    @Inject(FORMS_MERCHANTS) private readonly merchants: MerchantsService<FormsDatabase>,
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
    // S6: SELECT FOR UPDATE serializes against an in-flight OAuth callback's symmetric lock, else a callback could re-INSERT isActive=true between our check and UPDATE.
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
