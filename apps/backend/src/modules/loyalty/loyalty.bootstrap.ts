import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { LoyaltyDatabase } from './db/types';

/**
 * Loyalty-specific install bootstrap. Runs inside the OAuth install
 * transaction (OAuthService.handleCallback → bootstrap.run).
 *
 * Seeds a defaults-only `loyalty_configs` row so the admin's
 * GET /loyalty-config never 404s right after install. Uses INSERT … ON
 * DUPLICATE KEY UPDATE with a self-update no-op so reinstalls preserve the
 * merchant's existing settings (Finding #1: don't clobber config on
 * reinstall). `.ignore()` would silently swallow non-duplicate errors; the
 * explicit ODKU only suppresses the intended duplicate-key path.
 */
@Injectable()
export class LoyaltyBootstrap implements AppBootstrap<LoyaltyDatabase> {
  private readonly logger = new Logger(LoyaltyBootstrap.name);

  async run(trx: Transaction<LoyaltyDatabase>, merchantId: string): Promise<void> {
    // Column defaults carry the rest (programName 'Coins', rates, NULL urls).
    await trx
      .insertInto('loyalty_configs')
      .values({ merchantId })
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: 'loyalty config seeded', merchantId });
  }
}
