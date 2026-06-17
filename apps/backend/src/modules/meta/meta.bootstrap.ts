import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_DATA_SHARING_LEVEL,
  DEFAULT_PRODUCT_ID_TYPE,
} from '@ratio-app/shared/constants/meta-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { MetaDatabase } from './db/types';

/**
 * Meta-specific install bootstrap. Runs inside the OAuth install
 * transaction (OAuthService.handleCallback → bootstrap.run).
 *
 * Seeds an empty `meta_configs` row so the admin's GET /meta-config
 * never 404s right after install. Uses INSERT … ON DUPLICATE KEY UPDATE with
 * a self-update no-op so reinstalls preserve the merchant's existing Meta
 * credentials (Finding #1: don't clobber config on reinstall). `.ignore()`
 * would silently swallow non-duplicate errors (data truncation, FK violations,
 * NOT NULL gaps after a schema change); the explicit ODKU only suppresses the
 * intended duplicate-key path.
 */
@Injectable()
export class MetaBootstrap implements AppBootstrap<MetaDatabase> {
  private readonly logger = new Logger(MetaBootstrap.name);

  async run(trx: Transaction<MetaDatabase>, merchantId: string): Promise<void> {
    // mysql2 doesn't auto-stringify objects into JSON columns; encode here.
    const events = JSON.stringify(buildDefaultEventMap());
    await trx
      .insertInto('meta_configs')
      .values({
        merchantId,
        pixelId: '',
        capiAccessToken: '',
        dataSharingLevel: DEFAULT_DATA_SHARING_LEVEL,
        productIdType: DEFAULT_PRODUCT_ID_TYPE,
        debug: false,
        events: events as unknown as ReturnType<typeof buildDefaultEventMap>,
      })
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: 'meta config seeded', merchantId });
  }
}
