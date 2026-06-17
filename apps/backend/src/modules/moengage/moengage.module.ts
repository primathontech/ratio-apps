import { Module } from '@nestjs/common';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { MoengageConfigController } from './config/config.controller';
import { MoengageConfigService } from './config/config.service';
import type { MoengageDatabase } from './db/types';
import { MoengageMerchantTokenGuard, MoengageWebhookSignatureGuard } from './guards';
import { MOENGAGE_DB_TOKEN, MoengageKyselyModule } from './kysely.module';
import { MoengageMerchantsController } from './merchants/merchants.controller';
import { MoengageBootstrap } from './moengage.bootstrap';
import { MoengageOAuthController } from './oauth/oauth.controller';
import { MoengageSdkController } from './sdk/sdk.controller';
import { MoengageSdkService } from './sdk/sdk.service';
// Symbols live in ./tokens to break a circular import with ./guards. We
// import + re-export so existing call sites `from './moengage.module'` keep
// working (single-statement re-export tripped a TDZ when combined with the
// internal use of the same symbols below).
import {
  MOENGAGE_CRYPTO,
  MOENGAGE_MERCHANTS,
  MOENGAGE_OAUTH,
  MOENGAGE_RATIO,
  MOENGAGE_WEBHOOKS,
} from './tokens';
import { MoengageAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { MoengageWebhooksController } from './webhooks/webhooks.controller';

// Re-export guards so controllers can import them from the module's barrel file.
export { MoengageMerchantTokenGuard, MoengageWebhookSignatureGuard } from './guards';
export { MOENGAGE_CRYPTO, MOENGAGE_MERCHANTS, MOENGAGE_OAUTH, MOENGAGE_RATIO, MOENGAGE_WEBHOOKS };

/**
 * MoEngage feature module. Mirrors the per-module wiring pattern from Phase D
 * of the per-module-db plan: instantiates its own `MerchantsService`,
 * `OAuthService`, `WebhooksService`, `CryptoService`, and `RatioClient` from
 * the now-library `core/` against its own `MoengageDatabase` Kysely client.
 *
 * Nothing crosses modules by design — per-module DB isolation. The shared
 * Crypto / Ratio / Merchants / OAuth / Webhooks providers are produced by
 * `createAppProviders`; everything else (controllers, app-specific services,
 * bootstrap, handler, guards) is wired here directly.
 *
 * Routes mounted under `/moengage/*` via controller path prefixes.
 */
@Module({
  imports: [MoengageKyselyModule],
  controllers: [
    MoengageConfigController,
    MoengageSdkController,
    MoengageOAuthController,
    MoengageWebhooksController,
    MoengageMerchantsController,
  ],
  providers: [
    MoengageConfigService,
    MoengageSdkService,
    MoengageBootstrap,
    MoengageAppUninstalledHandler,
    MoengageWebhookSignatureGuard,
    MoengageMerchantTokenGuard,
    ...createAppProviders<MoengageDatabase>(
      {
        slug: 'moengage',
        dbToken: MOENGAGE_DB_TOKEN,
        bootstrapClass: MoengageBootstrap,
        handlerClass: MoengageAppUninstalledHandler,
      },
      {
        CRYPTO: MOENGAGE_CRYPTO,
        RATIO: MOENGAGE_RATIO,
        MERCHANTS: MOENGAGE_MERCHANTS,
        OAUTH: MOENGAGE_OAUTH,
        WEBHOOKS: MOENGAGE_WEBHOOKS,
      },
    ),
  ],
  // Nothing crosses modules by design — per-module DB isolation.
  exports: [],
})
export class MoengageModule {}
