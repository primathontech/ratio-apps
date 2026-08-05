import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { createAppProviders } from '../../core/factories/app-module.factory';
import type { RatioOAuthCreds } from '../../core/oauth/ratio-oauth.http';
import { RatioOAuthHttp } from '../../core/oauth/ratio-oauth.http';
import { FbtBundleLookupService } from './bundles/bundle-lookup.service';
import { FbtBundlesController } from './bundles/bundles.controller';
import { FbtBundlesService } from './bundles/bundles.service';
import { FbtConfigController } from './config/config.controller';
import { FbtConfigService } from './config/config.service';
import type { FbtDatabase } from './db/types';
import { FbtBootstrap } from './fbt.bootstrap';
import { FbtMerchantTokenGuard, FbtWebhookSignatureGuard } from './guards';
import { FBT_DB_TOKEN, FbtKyselyModule } from './kysely.module';
import { FbtMerchantsController } from './merchants/merchants.controller';
import { FbtOAuthController } from './oauth/oauth.controller';
import { FbtRatioTokenProvider } from './oauth/ratio-token.provider';
import {
  FBT_CRYPTO,
  FBT_MERCHANTS,
  FBT_OAUTH,
  FBT_RATIO,
  FBT_RATIO_OAUTH_CREDS,
  FBT_RATIO_OAUTH_HTTP,
  FBT_WEBHOOKS,
} from './tokens';
import { FbtAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { FbtProductCreatedHandler } from './webhooks/product-created.handler';
import { FbtProductDeletedHandler } from './webhooks/product-deleted.handler';
import { FbtProductUpdatedHandler } from './webhooks/product-updated.handler';
import { FbtWebhooksController } from './webhooks/webhooks.controller';

// Re-export guards so external consumers (e.g. e2e setup) can import from
// the barrel; controllers internal to this module pull from ./guards.
export { FbtMerchantTokenGuard, FbtWebhookSignatureGuard } from './guards';
// Re-export the tokens from the module barrel so existing
// `import { FBT_MERCHANTS } from './fbt.module'` call sites keep
// working. The symbols themselves live in `./tokens.ts` to break the
// circular import between this file and its sibling services/guards.
export {
  FBT_CRYPTO,
  FBT_MERCHANTS,
  FBT_OAUTH,
  FBT_RATIO,
  FBT_WEBHOOKS,
} from './tokens';

/**
 * Fbt feature module.
 *
 * Nothing crosses modules by design — per-module DB isolation. The Crypto /
 * Ratio / Merchants / OAuth / Webhooks providers are built by the shared
 * `createAppProviders` factory; everything else (bootstrap, handler, guards,
 * config controller/service) is wired here directly because those pieces are
 * app-specific. The real storefront serving is Plan 5.
 */
@Module({
  imports: [FbtKyselyModule],
  controllers: [
    FbtOAuthController,
    FbtWebhooksController,
    FbtMerchantsController,
    FbtConfigController,
    FbtBundlesController,
  ],
  providers: [
    FbtBootstrap,
    FbtConfigService,
    FbtBundlesService,
    FbtBundleLookupService,
    // Webhook handlers (one per subscribed topic). Each must also be listed
    // individually here — `webhooksProvider` (inside `createAppProviders`)
    // injects them by class, so DI needs its own provider entry per handler.
    FbtAppUninstalledHandler,
    FbtProductCreatedHandler,
    FbtProductUpdatedHandler,
    FbtProductDeletedHandler,
    // Guards are concrete @Injectable classes that defer to the per-module
    // factories internally (see ./guards.ts). They are class-shaped so
    // controllers can reference them in @UseGuards(GuardClass).
    FbtWebhookSignatureGuard,
    FbtMerchantTokenGuard,
    // Ratio access-token refresh plumbing (Task 6): `core`'s OAuthService only
    // stores tokens at install, so product-source calls need this to obtain a
    // still-valid access token, refreshing + rotating when it has expired.
    FbtRatioTokenProvider,
    {
      provide: FBT_RATIO_OAUTH_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthHttp =>
        new RatioOAuthHttp(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: FBT_RATIO_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthCreds => ({
        clientId: config.get('RATIO_FBT_CLIENT_ID' as never, { infer: true }) as string,
        clientSecret: config.get('RATIO_FBT_CLIENT_SECRET' as never, { infer: true }) as string,
      }),
    },
    ...createAppProviders<FbtDatabase>(
      {
        slug: 'fbt',
        dbToken: FBT_DB_TOKEN,
        bootstrapClass: FbtBootstrap,
        handlerClasses: [
          FbtAppUninstalledHandler,
          FbtProductCreatedHandler,
          FbtProductUpdatedHandler,
          FbtProductDeletedHandler,
        ],
      },
      {
        CRYPTO: FBT_CRYPTO,
        RATIO: FBT_RATIO,
        MERCHANTS: FBT_MERCHANTS,
        OAUTH: FBT_OAUTH,
        WEBHOOKS: FBT_WEBHOOKS,
      },
    ),
  ],
  // Nothing crosses modules by design — per-module DB isolation.
  exports: [],
})
export class FbtModule {}
