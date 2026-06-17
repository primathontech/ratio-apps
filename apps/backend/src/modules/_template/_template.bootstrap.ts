import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_TEMPLATE_HOST } from '@ratio-app/shared/constants/_template-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { TemplateDatabase } from './db/types';

/**
 * Template-specific install bootstrap. Runs inside the OAuth install
 * transaction (OAuthService.handleCallback → bootstrap.run).
 *
 * Seeds an empty `_template_configs` row so the admin's GET /_template-config
 * never 404s right after install. Uses INSERT … ON DUPLICATE KEY UPDATE with
 * a self-update no-op so reinstalls preserve the merchant's existing Template
 * credentials (Finding #1: don't clobber config on reinstall). `.ignore()`
 * would silently swallow non-duplicate errors (data truncation, FK violations,
 * NOT NULL gaps after a schema change); the explicit ODKU only suppresses the
 * intended duplicate-key path.
 */
@Injectable()
export class TemplateBootstrap implements AppBootstrap<TemplateDatabase> {
  private readonly logger = new Logger(TemplateBootstrap.name);

  async run(trx: Transaction<TemplateDatabase>, merchantId: string): Promise<void> {
    // mysql2 doesn't auto-stringify objects into JSON columns; encode here.
    const events = JSON.stringify(buildDefaultEventMap());
    await trx
      .insertInto('_template_configs')
      .values({
        merchantId,
        apiKey: '',
        host: DEFAULT_TEMPLATE_HOST,
        debug: false,
        events: events as unknown as ReturnType<typeof buildDefaultEventMap>,
      })
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: '_template config seeded', merchantId });
  }
}
