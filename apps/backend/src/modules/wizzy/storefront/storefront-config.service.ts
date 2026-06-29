import { Inject, Injectable } from '@nestjs/common';
import {
  type WizzyStorefrontConfig,
  wizzyStorefrontConfigSchema,
} from '@ratio-app/shared/schemas/wizzy-search';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { WizzyDatabase } from '../db/types';
import { WIZZY_DB_TOKEN } from '../kysely.module';
import { WIZZY_CRYPTO } from '../tokens';

// Bump this alongside the `@ratio-app/wizzy-sdk` package version so the
// storefront SDK and the config it bootstraps stay in lockstep.
const SDK_VERSION = '0.1.0';

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
  ) {}

  /** Resolve the redacted public storefront config for a merchant. */
  async publicConfig(merchantId: string): Promise<WizzyStorefrontConfig> {
    const row = await this.handle.db
      .selectFrom('wizzy_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();

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
}
