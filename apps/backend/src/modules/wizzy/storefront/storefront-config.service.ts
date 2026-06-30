import { Inject, Injectable } from '@nestjs/common';
import {
  type WizzyStorefrontConfig,
  wizzyStorefrontConfigSchema,
} from '@ratio-app/shared/schemas/wizzy-search';
import type { Selectable } from 'kysely';
import { RedisService } from '../../../core/cache/redis.service';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { WizzyDatabase } from '../db/types';
import { WIZZY_DB_TOKEN } from '../kysely.module';
import { WIZZY_CRYPTO } from '../tokens';

// Bump this alongside the `@ratio-app/wizzy-sdk` package version so the
// storefront SDK and the config it bootstraps stay in lockstep.
const SDK_VERSION = '0.1.1';

/** Config-row cache TTL (seconds). Cached ROW holds only ciphertext creds —
 * the plaintext secret is never written to Redis; decryption stays in-process. */
const CONFIG_CACHE_TTL_S = 120;
const configCacheKey = (merchantId: string) => `wizzy:cfg:${merchantId}`;

type WizzyConfigRow = Selectable<WizzyDatabase['wizzy_configs']>;

/**
 * Builds the PUBLIC, redacted storefront config served to the browser SDK.
 *
 * The config is constructed field-by-field from an allow-list (never spread
 * from the DB row) and the `apiKey` is decrypted on the way out — the private
 * `storeSecret` is never read or emitted. The result is parsed through the
 * `.strict()` {@link wizzyStorefrontConfigSchema} as a defensive guarantee that
 * no secret can ever leak into the public bundle.
 */
@Injectable()
export class StorefrontConfigService {
  constructor(
    @Inject(WIZZY_DB_TOKEN) private readonly handle: KyselyClient<WizzyDatabase>,
    @Inject(WIZZY_CRYPTO) private readonly crypto: CryptoService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Read the merchant's config row, Redis-cached (TTL {@link CONFIG_CACHE_TTL_S}).
   * The cached value holds only the ENCRYPTED creds (same as the DB) — decryption
   * happens in-process in the callers, so no plaintext secret reaches Redis.
   * Degrades to a direct DB read when Redis is unavailable.
   */
  private async configRow(merchantId: string): Promise<WizzyConfigRow | undefined> {
    const key = configCacheKey(merchantId);
    const cached = await this.redis.getJson<WizzyConfigRow>(key);
    if (cached) return cached;
    const row = await this.handle.db
      .selectFrom('wizzy_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (row) await this.redis.setJson(key, row, CONFIG_CACHE_TTL_S);
    return row;
  }

  /** Bust the cached config row (call after any merchant config update). */
  async invalidate(merchantId: string): Promise<void> {
    await this.redis.del(configCacheKey(merchantId));
  }

  /** Resolve the redacted public storefront config for a merchant. */
  async publicConfig(merchantId: string): Promise<WizzyStorefrontConfig> {
    const row = await this.configRow(merchantId);

    // Not configured (no row, or missing the credentials that the SDK needs):
    // return a valid-but-disabled config. Never throw, never leak.
    if (!row?.storeId || !row.apiKeyEnc) {
      return wizzyStorefrontConfigSchema.parse({
        storeId: row?.storeId ?? '',
        apiKey: '',
        version: SDK_VERSION,
        inputSelector: row?.inputSelector ?? '#search',
        resultsMountSelector: row?.resultsMountSelector ?? '#wizzy-results',
        resultsPagePath: row?.resultsPagePath ?? '/search',
        searchEnabled: false,
        theme: { primary: row?.themePrimary ?? '#0fb3a9' },
      });
    }

    // Configured: decrypt the public API key (NOT the store secret) and build
    // the config explicitly from the allowed fields only.
    return wizzyStorefrontConfigSchema.parse({
      storeId: row.storeId,
      apiKey: this.crypto.decrypt(row.apiKeyEnc),
      version: SDK_VERSION,
      inputSelector: row.inputSelector,
      resultsMountSelector: row.resultsMountSelector,
      resultsPagePath: row.resultsPagePath,
      searchEnabled: Boolean(row.searchEnabled),
      theme: { primary: row.themePrimary },
    });
  }

  /**
   * Resolve the FULL server-side credentials (incl. the decrypted store secret)
   * for sending Wizzy analytics events. Unlike {@link publicConfig}, this is
   * NEVER served to the browser — it's used only by the server-to-server events
   * endpoint. Wizzy's `/events/*` API requires the store secret (public
   * storeId+apiKey is rejected with 403), so events must originate server-side.
   *
   * Returns null when the merchant isn't configured or storefront search is off.
   */
  async resolveEventCreds(
    merchantId: string,
  ): Promise<{ storeId: string; storeSecret: string; apiKey: string } | null> {
    const row = await this.configRow(merchantId);

    if (!row?.searchEnabled || !row.storeId || !row.storeSecretEnc || !row.apiKeyEnc) {
      return null;
    }
    return {
      storeId: row.storeId,
      storeSecret: this.crypto.decrypt(row.storeSecretEnc),
      apiKey: this.crypto.decrypt(row.apiKeyEnc),
    };
  }
}
