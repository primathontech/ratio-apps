import { Inject, Injectable } from '@nestjs/common';
import {
  type LoyaltyPublicConfig,
  loyaltyPublicConfigSchema,
} from '@ratio-app/shared/schemas/loyalty-claim';
import type { Selectable } from 'kysely';
import { RedisService } from '../../../core/cache/redis.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { LoyaltyDatabase } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';

// Bump this alongside the `@ratio-app/loyalty-sdk` package version so the
// storefront SDK and the config it bootstraps stay in lockstep.
const SDK_VERSION = '0.1.0';

/** Config-row cache TTL (seconds). The cached row holds no plaintext secret. */
const CONFIG_CACHE_TTL_S = 120;
const configCacheKey = (merchantId: string) => `loyalty:cfg:${merchantId}`;

// The cache stores ONLY the non-secret columns `publicConfig` needs — never the
// full row. `loyalty_configs` carries `claimSigningSecret`, so a `selectAll()`
// here would sweep the raw signing secret into Redis (a lower-trust store); we
// deliberately allow-list the columns instead. `merchantId` proves existence
// (drives `enabled`); `programName` is the only value read out.
type CachedConfigRow = Pick<
  Selectable<LoyaltyDatabase['loyalty_configs']>,
  'merchantId' | 'programName'
>;

/**
 * Builds the PUBLIC, redacted storefront config served to the browser SDK.
 *
 * The config is constructed field-by-field from an allow-list (never spread
 * from the DB row); no secret is ever read or emitted, and the result is parsed
 * through the `.strict()` schema as a defensive guarantee.
 */
@Injectable()
export class StorefrontConfigService {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly redis: RedisService,
  ) {}

  /**
   * Read the merchant's config row, Redis-cached (TTL {@link CONFIG_CACHE_TTL_S}).
   * Degrades to a direct DB read when Redis is unavailable.
   */
  private async configRow(merchantId: string): Promise<CachedConfigRow | undefined> {
    const key = configCacheKey(merchantId);
    const cached = await this.redis.getJson<CachedConfigRow>(key);
    if (cached) return cached;
    const row = await this.handle.db
      .selectFrom('loyalty_configs')
      .select(['merchantId', 'programName'])
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

  /**
   * Resolve the redacted public storefront config for a merchant — exactly the
   * `.strict()` claim-widget shape, so no config field (let alone a secret)
   * can leak into the public bundle. `enabled` = the merchant is installed
   * (config row seeded by the install bootstrap).
   */
  async publicConfig(merchantId: string): Promise<LoyaltyPublicConfig> {
    const row = await this.configRow(merchantId);
    return loyaltyPublicConfigSchema.parse({
      programName: row?.programName ?? 'Coins',
      enabled: Boolean(row),
      version: SDK_VERSION,
    });
  }
}
