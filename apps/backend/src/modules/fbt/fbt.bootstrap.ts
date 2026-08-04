import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_TEMPLATE_HOST } from '@ratio-app/shared/constants/_template-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { FbtDatabase } from './db/types';

/**
 * Fbt-specific install bootstrap. Runs inside the OAuth install
 * transaction (OAuthService.handleCallback → bootstrap.run).
 *
 * Seeds an empty `fbt_configs` row so the admin's GET /fbt-config
 * never 404s right after install. Uses INSERT … ON DUPLICATE KEY UPDATE with
 * a self-update no-op so reinstalls preserve the merchant's existing Fbt
 * credentials (Finding #1: don't clobber config on reinstall). `.ignore()`
 * would silently swallow non-duplicate errors (data truncation, FK violations,
 * NOT NULL gaps after a schema change); the explicit ODKU only suppresses the
 * intended duplicate-key path.
 */
@Injectable()
export class FbtBootstrap implements AppBootstrap<FbtDatabase> {
  private readonly logger = new Logger(FbtBootstrap.name);

  async run(trx: Transaction<FbtDatabase>, merchantId: string): Promise<void> {
    // mysql2 doesn't auto-stringify objects into JSON columns; encode here.
    const events = JSON.stringify(buildDefaultEventMap());
    await trx
      .insertInto('fbt_configs')
      .values({
        merchantId,
        apiKey: '',
        host: DEFAULT_TEMPLATE_HOST,
        debug: false,
        events: events as unknown as ReturnType<typeof buildDefaultEventMap>,
      })
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: 'fbt config seeded', merchantId });
  }
}
