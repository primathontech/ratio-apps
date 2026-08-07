import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseWithMerchants, MerchantRow } from '../../../core/merchants/merchant.types';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { ClevertapDatabase } from '../db/types';
import { CLEVERTAP_MERCHANTS } from '../tokens';
import { CLEVERTAP_WEBHOOK_TOPICS } from './topics';

@Injectable()
export class ClevertapAppUninstalledHandler implements WebhookHandler {
  readonly topic = CLEVERTAP_WEBHOOK_TOPICS.appUninstalled;
  private readonly logger = new Logger(ClevertapAppUninstalledHandler.name);

  constructor(
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: injected to keep the handler's DI shape identical to every other module's, but deliberately UNUSED — every write goes through `trx` so it commits atomically with the `webhook_log` row (asserted by app-uninstalled.handler.test.ts).
    @Inject(CLEVERTAP_MERCHANTS) private readonly merchants: MerchantsService<ClevertapDatabase>,
  ) {}

  async handle(
    _data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'app/uninstalled for unknown merchant — no-op' });
      return;
    }
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
