import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { ulid } from 'ulid';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { FbtDatabase } from './db/types';

/**
 * FBT install bootstrap. Runs inside the OAuth install transaction
 * (OAuthService.handleCallback → bootstrap.run), so the merchant has a usable
 * config row the instant install completes and the admin never 404s.
 *
 * `allowAutomaticRecommendation` deliberately defaults to FALSE: turning it on
 * spends OpenAI budget, so it is the merchant's explicit choice. `nextRunAt`
 * stays NULL, which keeps the merchant out of the sweep's due-selection query
 * entirely. When the merchant later toggles automation on, that write sets
 * `nextRunAt = NOW(3)` so bundles appear on the next tick rather than at 04:00.
 *
 * INSERT … ON DUPLICATE KEY UPDATE with a self-referencing no-op means a
 * REINSTALL preserves the merchant's prior settings instead of resetting them.
 * `.ignore()` is deliberately avoided — it would also silently swallow FK
 * violations and NOT NULL gaps introduced by a later schema change.
 */
@Injectable()
export class FbtBootstrap implements AppBootstrap<FbtDatabase> {
  private readonly logger = new Logger(FbtBootstrap.name);

  async run(trx: Transaction<FbtDatabase>, merchantId: string): Promise<void> {
    await trx
      .insertInto('merchant_recommendation_config')
      .values({
        id: ulid(),
        merchantId,
        // Written as a literal and never branched on. Dropped in 0002.
        platform: 'openstore',
        allowAutomaticRecommendation: false,
        recommendationCount: 3,
        syncFrequency: 'daily',
        syncHourUtc: 4,
        syncWeekday: null,
        nextRunAt: null,
        lastRunAt: null,
        // mysql2 does not auto-stringify objects into JSON columns.
        productExcludedList: '[]',
        productsWidgetDisabledList: '[]',
      } as never)
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();

    this.logger.log({ msg: 'fbt merchant config seeded', merchantId });
  }
}
