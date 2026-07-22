import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { FormsDatabase } from './db/types';

/**
 * Forms-specific install bootstrap. Runs inside the OAuth install
 * transaction (OAuthService.handleCallback → bootstrap.run).
 *
 * Seeds the `forms_configs` row with the launch defaults — reCAPTCHA
 * threshold 0.30, kill switch on (`forms_enabled = true`), shared Ratio
 * reCAPTCHA key mode (no site key / secret) — so the admin's GET
 * /forms-config never 404s right after install. Uses INSERT … ON DUPLICATE
 * KEY UPDATE with a self-update no-op so reinstalls preserve the merchant's
 * existing settings (don't clobber config on reinstall). `.ignore()` would
 * silently swallow non-duplicate errors (data truncation, FK violations,
 * NOT NULL gaps after a schema change); the explicit ODKU only suppresses
 * the intended duplicate-key path.
 */
@Injectable()
export class FormsBootstrap implements AppBootstrap<FormsDatabase> {
  private readonly logger = new Logger(FormsBootstrap.name);

  async run(trx: Transaction<FormsDatabase>, merchantId: string): Promise<void> {
    await trx
      .insertInto('forms_configs')
      .values({
        merchantId,
        recaptchaThreshold: 0.3,
        formsEnabled: true,
      })
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: 'forms config seeded', merchantId });
  }
}
