import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { DelhiveryDatabase } from './db/types';

/**
 * Delhivery-specific install bootstrap. Runs inside the OAuth install
 * transaction (OAuthService.handleCallback → bootstrap.run).
 *
 * Seeds an empty `delhivery_configs` row so the admin's GET /delhivery-config
 * never 404s right after install. The seed row has an empty encrypted token
 * and `enabled = false` (column default) — the app stays inert until the
 * merchant saves real credentials. Uses INSERT … ON DUPLICATE KEY UPDATE with
 * a self-update no-op so reinstalls preserve the merchant's existing Delhivery
 * credentials (don't clobber config on reinstall). `.ignore()` would silently
 * swallow non-duplicate errors; the explicit ODKU only suppresses the intended
 * duplicate-key path.
 */
@Injectable()
export class DelhiveryBootstrap implements AppBootstrap<DelhiveryDatabase> {
  private readonly logger = new Logger(DelhiveryBootstrap.name);

  async run(trx: Transaction<DelhiveryDatabase>, merchantId: string): Promise<void> {
    await trx
      .insertInto('delhivery_configs')
      .values({
        merchantId,
        apiTokenEnc: '',
      })
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: 'delhivery config seeded', merchantId });
  }
}
