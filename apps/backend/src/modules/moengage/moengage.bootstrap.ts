import { Injectable, Logger } from '@nestjs/common';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { MoengageDatabase } from './db/types';

/**
 * MoEngage-specific install bootstrap. Runs inside the OAuth install
 * transaction (see OAuthService.handleCallback) for the MoEngage module's
 * per-module OAuth service instance.
 *
 * Seeds an empty `moengage_configs` row so the admin's GET /moengage-config
 * never 404s right after install. Uses INSERT … ON DUPLICATE KEY UPDATE with
 * a self-update no-op so reinstalls preserve the merchant's existing MoEngage
 * credentials (Finding #1: don't clobber config on reinstall). `.ignore()`
 * would silently swallow non-duplicate errors (data truncation, FK violations,
 * NOT NULL gaps after a schema change); the explicit ODKU only suppresses the
 * intended duplicate-key path.
 *
 * Uses `buildDefaultEventMap('moengage')` to seed Title-Case MoEngage event
 * names (Finding #4) — admins can still rename via the events PUT.
 */
@Injectable()
export class MoengageBootstrap implements AppBootstrap<MoengageDatabase> {
  private readonly logger = new Logger(MoengageBootstrap.name);

  async run(trx: Transaction<MoengageDatabase>, merchantId: string): Promise<void> {
    // mysql2 doesn't auto-stringify objects into JSON columns; encode here.
    const events = JSON.stringify(buildDefaultEventMap('moengage'));
    await trx
      .insertInto('moengage_configs')
      .values({
        merchantId,
        appId: '',
        dataCenter: 'DC_1',
        debug: false,
        swPath: '',
        events: events as unknown as ReturnType<typeof buildDefaultEventMap>,
      })
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: 'moengage config seeded', merchantId });
  }
}
