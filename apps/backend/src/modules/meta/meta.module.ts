import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { RatioOAuthHttp, type RatioOAuthCreds } from '../../core/oauth/ratio-oauth.http';
import { RedisService } from './cache/redis.service';
import { CatalogBatchService } from './catalog/catalog-batch.service';
import { CatalogSourceService } from './catalog/catalog-source.service';
import { CatalogTransformerService } from './catalog/catalog-transformer.service';
import { MetaCatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { MetaFeedController } from './catalog/feed.controller';
import { MetaCapiStatsController } from './capi/capi-stats.controller';
import { CapiStatsService } from './capi/capi-stats.service';
import { CapiHmacGuard } from './capi/capi-hmac.guard';
import { MetaCapiController } from './capi/capi.controller';
import { MetaCapiService } from './capi/capi.service';
import { MetaCapiWorker } from './queue/capi.worker';
import { QueueService } from './queue/queue.service';
import { MetaProductWebhookController } from './webhooks/product-webhook.controller';
import { MetaConfigController } from './config/config.controller';
import { MetaConfigService } from './config/config.service';
import type { MetaDatabase } from './db/types';
import { MetaMerchantTokenGuard, MetaWebhookSignatureGuard } from './guards';
import { META_DB_TOKEN, MetaKyselyModule } from './kysely.module';
import { MetaMerchantsController } from './merchants/merchants.controller';
import { MetaBootstrap } from './meta.bootstrap';
import { MetaOAuthController } from './oauth/oauth.controller';
import { MetaRatioTokenProvider } from './oauth/ratio-token.provider';
import { MetaSdkController } from './sdk/sdk.controller';
import { MetaSdkService } from './sdk/sdk.service';
import {
  META_CRYPTO,
  META_MERCHANTS,
  META_OAUTH,
  META_RATIO,
  META_RATIO_OAUTH_CREDS,
  META_RATIO_OAUTH_HTTP,
  META_WEBHOOKS,
} from './tokens';
import { MetaAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { MetaWebhooksController } from './webhooks/webhooks.controller';

// Re-export guards so external consumers (e.g. e2e setup) can import from
// the barrel; controllers internal to this module pull from ./guards.
export { MetaMerchantTokenGuard, MetaWebhookSignatureGuard } from './guards';
// Re-export the tokens from the module barrel so existing
// `import { META_MERCHANTS } from './meta.module'` call sites keep
// working. The symbols themselves live in `./tokens.ts` to break the
// circular import between this file and its sibling services/guards.
export {
  META_CRYPTO,
  META_MERCHANTS,
  META_OAUTH,
  META_RATIO,
  META_WEBHOOKS,
} from './tokens';

/**
 * Meta feature module.
 *
 * Nothing crosses modules by design — per-module DB isolation. The Crypto /
 * Ratio / Merchants / OAuth / Webhooks providers are built by the shared
 * `createAppProviders` factory; everything else (config + sdk services,
 * controllers, bootstrap, handler, guards) is wired here directly because
 * those pieces are app-specific.
 */
@Module({
  imports: [MetaKyselyModule],
  controllers: [
    MetaConfigController,
    MetaSdkController,
    MetaCapiController,
    MetaCapiStatsController,
    MetaOAuthController,
    MetaWebhooksController,
    MetaMerchantsController,
    // Phase 2 catalog
    MetaProductWebhookController,
    MetaCatalogController,
    MetaFeedController,
  ],
  providers: [
    MetaConfigService,
    MetaSdkService,
    MetaCapiService,
    CapiHmacGuard,
    CapiStatsService,
    // Phase 1 scale + Phase 2 catalog infra
    QueueService,
    RedisService,
    MetaCapiWorker,
    // Phase 2 catalog services + worker + guard
    CatalogTransformerService,
    CatalogBatchService,
    MetaRatioTokenProvider,
    CatalogSourceService,
    CatalogService,
    {
      provide: META_RATIO_OAUTH_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthHttp =>
        new RatioOAuthHttp(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: META_RATIO_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthCreds => ({
        clientId: config.get('RATIO_META_CLIENT_ID' as never, { infer: true }) as string,
        clientSecret: config.get('RATIO_META_CLIENT_SECRET' as never, { infer: true }) as string,
      }),
    },
    MetaBootstrap,
    MetaAppUninstalledHandler,
    // Guards are concrete @Injectable classes that defer to the per-module
    // factories internally (see ./guards.ts). They are class-shaped so
    // controllers can reference them in @UseGuards(GuardClass).
    MetaWebhookSignatureGuard,
    MetaMerchantTokenGuard,
    ...createAppProviders<MetaDatabase>(
      {
        slug: 'meta',
        dbToken: META_DB_TOKEN,
        bootstrapClass: MetaBootstrap,
        handlerClass: MetaAppUninstalledHandler,
      },
      {
        CRYPTO: META_CRYPTO,
        RATIO: META_RATIO,
        MERCHANTS: META_MERCHANTS,
        OAUTH: META_OAUTH,
        WEBHOOKS: META_WEBHOOKS,
      },
    ),
  ],
  // Nothing crosses modules by design — per-module DB isolation.
  exports: [],
})
export class MetaModule {}
