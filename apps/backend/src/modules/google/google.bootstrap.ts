import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { GoogleDatabase } from './db/types';

/**
 * Google-specific install bootstrap. Runs inside the OAuth install transaction
 * (OAuthService.handleCallback → bootstrap.run).
 *
 * Seeds an empty `google_configs` row (all columns have DB defaults — every
 * integration starts disabled) so the admin's GET /google-config never 404s
 * right after install. Uses INSERT … ON DUPLICATE KEY UPDATE with a self-update
 * no-op so reinstalls preserve the merchant's existing settings/credentials
 * (don't clobber config on reinstall). `.ignore()` would silently swallow
 * non-duplicate errors (FK violations, NOT NULL gaps after a schema change);
 * the explicit ODKU only suppresses the intended duplicate-key path.
 */
@Injectable()
export class GoogleBootstrap implements AppBootstrap<GoogleDatabase> {
  private readonly logger = new Logger(GoogleBootstrap.name);

  async run(trx: Transaction<GoogleDatabase>, merchantId: string): Promise<void> {
    await trx
      .insertInto('google_configs')
      .values({ merchantId } as never)
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: 'google config seeded', merchantId });
  }
}
