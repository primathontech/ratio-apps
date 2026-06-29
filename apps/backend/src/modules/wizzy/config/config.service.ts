import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WizzyConfig, WizzyConfigInput } from '@ratio-app/shared/schemas/wizzy-config';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { WizzyConfigRow, WizzyDatabase } from '../db/types';
import { WIZZY_DB_TOKEN } from '../kysely.module';
import { WIZZY_CRYPTO } from '../tokens';

/**
 * Per-merchant Wizzy config CRUD. Backed by `wizzy_configs`, keyed by
 * `merchant_id` (single-tenant per-module DB).
 *
 * The Store Secret has write-only semantics: it is encrypted via the
 * per-module {@link CryptoService} before storage and NEVER returned by reads —
 * `WizzyConfig` exposes `hasStoreSecret` instead.
 */
@Injectable()
export class WizzyConfigService {
  constructor(
    @Inject(WIZZY_DB_TOKEN) private readonly handle: KyselyClient<WizzyDatabase>,
    @Inject(WIZZY_CRYPTO) private readonly crypto: CryptoService,
  ) {}

  /** Read the merchant's config in the redacted output shape. */
  async getByMerchantId(merchantId: string): Promise<WizzyConfig> {
    const row = await this.handle.db
      .selectFrom('wizzy_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'no wizzy config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    // Wizzy uses only Ratio OAuth (no separate vendor OAuth flow), so
    // `needsReconnect` is derived from whether the oauth_tokens row exists.
    // If there's no token row the merchant's session has lapsed — signal reconnect.
    const tokenRow = await this.handle.db
      .selectFrom('oauth_tokens')
      .select(['merchantId'])
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();

    return this.toOutput(row, !tokenRow);
  }

  /**
   * UPSERT the merchant's config. Both storeSecret and apiKey have write-only
   * semantics:
   *   - `undefined`/`null` → leave the stored value unchanged
   *   - `''` (empty)       → clear the stored value
   *   - non-empty string   → encrypt and store
   * Returns the redacted output shape.
   */
  async upsert(merchantId: string, input: WizzyConfigInput): Promise<WizzyConfig> {
    const setSecret = input.storeSecret !== undefined && input.storeSecret !== null;
    const encSecret = setSecret
      ? input.storeSecret
        ? this.crypto.encrypt(input.storeSecret)
        : null
      : undefined;

    const setApiKey = input.apiKey !== undefined && input.apiKey !== null;
    const encApiKey = setApiKey
      ? input.apiKey
        ? this.crypto.encrypt(input.apiKey)
        : null
      : undefined;

    const cols = {
      wizzyEnabled: input.wizzyEnabled,
      storeId: input.storeId ?? null,
      storeUrl: input.storeUrl ?? null,
      autoSyncEnabled: input.autoSyncEnabled,
      includeOutOfStock: input.includeOutOfStock,
      stripHtmlDescription: input.stripHtmlDescription,
      searchEnabled: input.searchEnabled,
      inputSelector: input.inputSelector,
      resultsMountSelector: input.resultsMountSelector,
      resultsPagePath: input.resultsPagePath,
      themePrimary: input.themePrimary,
    };

    // Secret columns are only touched when the caller intends to change them.
    const secretForInsert = setSecret ? { storeSecretEnc: encSecret ?? null } : {};
    const secretForUpdate = setSecret ? { storeSecretEnc: encSecret ?? null } : {};
    const apiKeyForInsert = setApiKey ? { apiKeyEnc: encApiKey ?? null } : {};
    const apiKeyForUpdate = setApiKey ? { apiKeyEnc: encApiKey ?? null } : {};

    await this.handle.db
      .insertInto('wizzy_configs')
      .values({
        merchantId,
        ...cols,
        ...secretForInsert,
        ...apiKeyForInsert,
      } as never)
      .onDuplicateKeyUpdate({
        ...cols,
        ...secretForUpdate,
        ...apiKeyForUpdate,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();

    return this.getByMerchantId(merchantId);
  }

  /** Map a stored row → redacted output shape. */
  private toOutput(row: WizzyConfigRow, needsReconnect: boolean): WizzyConfig {
    return {
      wizzyEnabled: Boolean(row.wizzyEnabled),
      storeId: row.storeId,
      hasStoreSecret: Boolean(row.storeSecretEnc),
      hasApiKey: Boolean(row.apiKeyEnc),
      needsReconnect,
      storeUrl: row.storeUrl,
      lastBulkSyncAt: row.lastBulkSyncAt ? new Date(row.lastBulkSyncAt).toISOString() : null,
      autoSyncEnabled: Boolean(row.autoSyncEnabled),
      includeOutOfStock: Boolean(row.includeOutOfStock),
      stripHtmlDescription: Boolean(row.stripHtmlDescription),
      searchEnabled: Boolean(row.searchEnabled),
      inputSelector: row.inputSelector,
      resultsMountSelector: row.resultsMountSelector,
      resultsPagePath: row.resultsPagePath,
      themePrimary: row.themePrimary,
    };
  }
}
