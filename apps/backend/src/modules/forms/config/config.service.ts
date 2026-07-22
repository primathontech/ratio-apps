import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FormsConfig, FormsConfigInput } from '@ratio-app/shared/schemas/forms-config';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { FORMS_CRYPTO } from '../tokens';

const DEFAULT_RECAPTCHA_THRESHOLD = 0.3;

/**
 * Per-merchant Forms config CRUD. Backed by `forms_configs`, keyed by
 * `merchant_id` (single-tenant per-module DB — no `app` column).
 *
 * The reCAPTCHA secret is WRITE-ONLY and ENCRYPTED AT REST (AES-256-GCM via
 * the module's CryptoService, keyed by RATIO_FORMS_DATA_ENCRYPTION_KEY).
 * The GET shape carries only `hasRecaptchaSecret`; the plaintext never
 * leaves this service (a decrypt helper for the reCAPTCHA verifier lands
 * with the submissions phase).
 *
 * MySQL has no `RETURNING`, so writes use INSERT…ON DUPLICATE KEY UPDATE and
 * compose the response in memory.
 */
@Injectable()
export class FormsConfigService {
  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    @Inject(FORMS_CRYPTO) private readonly crypto: CryptoService,
  ) {}

  async getByMerchantId(merchantId: string): Promise<FormsConfig> {
    const row = await this.handle.db
      .selectFrom('forms_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'no forms config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    return {
      // exactOptionalPropertyTypes: omit absent optionals instead of
      // spelling out `undefined`.
      ...(row.recaptchaSiteKey ? { recaptchaSiteKey: row.recaptchaSiteKey } : {}),
      // mysql2 returns DECIMAL as a string → coerce.
      recaptchaThreshold: Number(row.recaptchaThreshold),
      ...(row.defaultNotificationEmail
        ? { defaultNotificationEmail: row.defaultNotificationEmail }
        : {}),
      // MySQL stores booleans as TINYINT(1) → mysql2 returns 0/1, coerce.
      formsEnabled: Boolean(row.formsEnabled),
      hasRecaptchaSecret: Boolean(row.recaptchaSecretEnc),
      emailBounced: Boolean(row.emailBounced),
    };
  }

  /**
   * UPSERT this merchant's Forms config and return the saved (GET) shape.
   *
   * Secret handling: a non-blank `recaptchaSecret` is encrypted and replaces
   * the stored ciphertext; blank/absent keeps the existing value untouched
   * (write-only semantics — the admin form never round-trips the secret).
   * `emailBounced` is deliberately NOT written here: the email worker owns
   * that flag.
   */
  async upsert(merchantId: string, input: FormsConfigInput): Promise<FormsConfig> {
    const recaptchaThreshold = input.recaptchaThreshold ?? DEFAULT_RECAPTCHA_THRESHOLD;
    const formsEnabled = input.formsEnabled ?? true;
    const recaptchaSiteKey = input.recaptchaSiteKey?.trim() || null;
    const defaultNotificationEmail = input.defaultNotificationEmail?.trim() || null;

    const providedSecret = input.recaptchaSecret?.trim() ?? '';
    const existing = await this.handle.db
      .selectFrom('forms_configs')
      .select(['recaptchaSecretEnc', 'emailBounced'])
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    const recaptchaSecretEnc = providedSecret
      ? this.crypto.encrypt(providedSecret)
      : (existing?.recaptchaSecretEnc ?? null);

    await this.handle.db
      .insertInto('forms_configs')
      .values({
        merchantId,
        recaptchaSiteKey,
        recaptchaSecretEnc,
        recaptchaThreshold,
        defaultNotificationEmail,
        formsEnabled,
      })
      .onDuplicateKeyUpdate({
        recaptchaSiteKey,
        recaptchaSecretEnc,
        recaptchaThreshold,
        defaultNotificationEmail,
        formsEnabled,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();

    return {
      ...(recaptchaSiteKey ? { recaptchaSiteKey } : {}),
      recaptchaThreshold,
      ...(defaultNotificationEmail ? { defaultNotificationEmail } : {}),
      formsEnabled,
      hasRecaptchaSecret: Boolean(recaptchaSecretEnc),
      emailBounced: Boolean(existing?.emailBounced),
    };
  }
}
