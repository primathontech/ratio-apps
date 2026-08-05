import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { FbtDatabase } from './db/types';

/**
 * FBT install bootstrap. Runs inside the OAuth install transaction
 * (OAuthService.handleCallback → bootstrap.run), so the merchant has a usable config
 * row the instant install completes and the admin never 404s.
 *
 * `allowAutomaticRecommendation` deliberately defaults to FALSE: turning it on spends
 * OpenAI budget, so it is the merchant's explicit choice. `nextRunAt` stays NULL, which
 * keeps the merchant out of the sweep's due-selection query entirely — under the
 * greenfield design NULL unambiguously means "never opted in". When the merchant later
 * enables automation, that write sets `nextRunAt = NOW(3)` so bundles appear on the next
 * tick rather than at 04:00.
 *
 * No surrogate `id` and no `platform`: `merchantId` is the primary key, and the
 * greenfield schema has no platform dimension.
 *
 * INSERT … ON DUPLICATE KEY UPDATE with a self-referencing no-op means a REINSTALL
 * preserves the merchant's prior settings instead of resetting them. `.ignore()` is
 * deliberately avoided — it would also silently swallow FK violations and NOT NULL gaps
 * introduced by a later schema change.
 */
@Injectable()
export class FbtBootstrap implements AppBootstrap<FbtDatabase> {
  private readonly logger = new Logger(FbtBootstrap.name);

  async run(trx: Transaction<FbtDatabase>, merchantId: string): Promise<void> {
    await trx
      .insertInto('fbt_merchant_config')
      .values({
        merchantId,
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
      })
      // Cast ONLY the ODKU argument, never `.values()`. A blanket
      // `.values({…} as never)` would suppress type-checking across every column name
      // in the production install path, so a typo'd camelCase key would compile clean
      // and fail at runtime. Precedent: forms.bootstrap.ts and _template.bootstrap.ts
      // narrow the cast this way.
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();

    this.logger.log({ msg: 'fbt merchant config seeded', merchantId });
  }
}
