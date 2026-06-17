import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GoogleConfig, GoogleConfigInput } from '@ratio-app/shared/schemas/google-config';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleConfigRow, GoogleDatabase } from '../db/types';
import { GOOGLE_CRYPTO } from '../tokens';
import { GOOGLE_DB_TOKEN } from '../kysely.module';

/**
 * Per-merchant Google config CRUD. Backed by `google_configs`, keyed by
 * `merchant_id` (single-tenant per-module DB).
 *
 * The GMC service-account key is the one secret here: it is encrypted via the
 * per-module {@link CryptoService} before storage and NEVER returned by reads —
 * `GoogleConfig` exposes `hasGmcKey` instead. The merchant's "needs reconnect"
 * flag lives on `google_credentials` (the Google OAuth tokens table) and is
 * folded into the config read so the admin can render a single object.
 */
@Injectable()
export class GoogleConfigService {
  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    @Inject(GOOGLE_CRYPTO) private readonly crypto: CryptoService,
  ) {}

  /** Read the merchant's config in the redacted output shape. */
  async getByMerchantId(merchantId: string): Promise<GoogleConfig> {
    const row = await this.handle.db
      .selectFrom('google_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'no google config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    // `needs_reconnect` lives on the Google credentials row (absent until the
    // merchant connects via OAuth) — default false when there is no row.
    const cred = await this.handle.db
      .selectFrom('google_credentials')
      .select(['needsReconnect'])
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();

    return this.toOutput(row, Boolean(cred?.needsReconnect));
  }

  /**
   * UPSERT the merchant's config. The GMC key has write-only semantics:
   *   - `undefined`/`null` → leave the stored key unchanged
   *   - `''` (empty)       → clear the stored key
   *   - non-empty string   → encrypt and store
   * Returns the redacted output shape, reading `needs_reconnect` back as for GET.
   */
  async upsert(merchantId: string, input: GoogleConfigInput): Promise<GoogleConfig> {
    const setKey = input.gmcServiceAccountKey !== undefined && input.gmcServiceAccountKey !== null;
    const encKey = setKey
      ? input.gmcServiceAccountKey
        ? this.crypto.encrypt(input.gmcServiceAccountKey)
        : null
      : undefined;

    // Columns common to INSERT values and the ODKU update set.
    const cols = {
      connectionMethod: input.connectionMethod,
      googleAccountEmail: null as string | null,
      ga4Enabled: input.ga4Enabled,
      ga4MeasurementId: input.ga4MeasurementId ?? null,
      adsEnabled: input.adsEnabled,
      adsConversionId: input.adsConversionId ?? null,
      adsConversionLabel: input.adsConversionLabel ?? null,
      enhancedConversionsEnabled: input.enhancedConversionsEnabled,
      gmcEnabled: input.gmcEnabled,
      gmcMerchantId: input.gmcMerchantId ?? null,
      gmcTargetCountry: input.gmcTargetCountry,
      gmcContentLanguage: input.gmcContentLanguage,
      gmcCurrency: input.gmcCurrency,
      gmcDefaultCondition: input.gmcDefaultCondition,
      gmcBrandOverride: input.gmcBrandOverride ?? null,
      gmcGoogleProductCategory: input.gmcGoogleProductCategory ?? null,
      gmcCategoryMode: input.gmcCategoryMode,
      autoSyncEnabled: input.autoSyncEnabled,
      hourlyReconcileEnabled: input.hourlyReconcileEnabled,
      syncVariantsEnabled: input.syncVariantsEnabled,
      includeOutOfStock: input.includeOutOfStock,
      freeListingsEnabled: input.freeListingsEnabled,
    };

    // The secret column is only touched when the caller intends to change it.
    const keyForInsert = setKey ? { gmcServiceAccountKeyEnc: encKey ?? null } : {};
    const keyForUpdate = setKey ? { gmcServiceAccountKeyEnc: encKey ?? null } : {};

    await this.handle.db
      .insertInto('google_configs')
      .values({
        merchantId,
        ...cols,
        ...keyForInsert,
      } as never)
      .onDuplicateKeyUpdate({
        ...cols,
        ...keyForUpdate,
        // `googleAccountEmail` is owned by the OAuth flow — do not clobber it on
        // a config save. Drop it from the update set.
        googleAccountEmail: sql`google_account_email`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();

    return this.getByMerchantId(merchantId);
  }

  /** Map a stored row → redacted output shape. */
  private toOutput(row: GoogleConfigRow, needsReconnect: boolean): GoogleConfig {
    return {
      connectionMethod: row.connectionMethod,
      googleAccountEmail: row.googleAccountEmail,
      hasGmcKey: Boolean(row.gmcServiceAccountKeyEnc),
      needsReconnect,
      ga4Enabled: Boolean(row.ga4Enabled),
      ga4MeasurementId: row.ga4MeasurementId,
      ga4PixelStatus: row.ga4PixelStatus,
      adsEnabled: Boolean(row.adsEnabled),
      adsConversionId: row.adsConversionId,
      adsConversionLabel: row.adsConversionLabel,
      adsPixelStatus: row.adsPixelStatus,
      enhancedConversionsEnabled: Boolean(row.enhancedConversionsEnabled),
      gmcEnabled: Boolean(row.gmcEnabled),
      gmcMerchantId: row.gmcMerchantId,
      gmcTargetCountry: row.gmcTargetCountry,
      gmcContentLanguage: row.gmcContentLanguage,
      gmcCurrency: row.gmcCurrency,
      gmcDefaultCondition: row.gmcDefaultCondition,
      gmcBrandOverride: row.gmcBrandOverride,
      gmcGoogleProductCategory: row.gmcGoogleProductCategory,
      gmcCategoryMode: row.gmcCategoryMode,
      autoSyncEnabled: Boolean(row.autoSyncEnabled),
      hourlyReconcileEnabled: Boolean(row.hourlyReconcileEnabled),
      syncVariantsEnabled: Boolean(row.syncVariantsEnabled),
      includeOutOfStock: Boolean(row.includeOutOfStock),
      freeListingsEnabled: Boolean(row.freeListingsEnabled),
    };
  }
}
