import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import type { Env } from '../../config/env.schema';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { QueueService } from '../../core/queue/queue.service';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogQueryService } from './catalog/catalog-query.service';
import { CatalogSyncService } from './catalog/catalog-sync.service';
import { RatioProductsService } from './catalog/ratio-products.service';
import { ReconcileService } from './catalog/reconcile.service';
import { WizzyApiClient } from './catalog/wizzy-api.client';
import { WizzySyncWorker } from './catalog/wizzy-sync.worker';
import { WizzyConfigController } from './config/config.controller';
import { WizzyConfigService } from './config/config.service';
import type { WizzyDatabase } from './db/types';
import { WizzyMerchantTokenGuard, WizzyWebhookSignatureGuard } from './guards';
import { WIZZY_DB_TOKEN, WizzyKyselyModule } from './kysely.module';
import { WizzyMerchantsController } from './merchants/merchants.controller';
import { WizzyOAuthController } from './oauth/oauth.controller';
import { type RatioOAuthCreds, RatioOAuthHttp } from './oauth/ratio-oauth.http';
import { RatioTokenProvider } from './oauth/ratio-token.provider';
import { ScriptTagClient } from './sdk/script-tag.client';
import { SdkRegistrationService } from './sdk/sdk-registration.service';
import { StorefrontController } from './storefront/storefront.controller';
import { StorefrontConfigService } from './storefront/storefront-config.service';
import {
  WIZZY_CRYPTO,
  WIZZY_MERCHANTS,
  WIZZY_OAUTH,
  WIZZY_RATIO,
  WIZZY_RATIO_OAUTH_CREDS,
  WIZZY_RATIO_OAUTH_HTTP,
  WIZZY_RATIO_PRODUCTS,
  WIZZY_WEBHOOKS,
} from './tokens';
import { WizzyAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { WizzyProductCreatedHandler } from './webhooks/product-created.handler';
import { WizzyProductDeletedHandler } from './webhooks/product-deleted.handler';
import { WizzyProductUpdatedHandler } from './webhooks/product-updated.handler';
import { WizzyWebhooksController } from './webhooks/webhooks.controller';
import { WizzyBootstrap } from './wizzy.bootstrap';

// Re-export guards so external consumers (e.g. e2e setup) can import from the barrel.
export { WizzyMerchantTokenGuard, WizzyWebhookSignatureGuard } from './guards';
export {
  WIZZY_CRYPTO,
  WIZZY_MERCHANTS,
  WIZZY_OAUTH,
  WIZZY_RATIO,
  WIZZY_WEBHOOKS,
} from './tokens';

/**
 * Wizzy feature module (AI Search & Discovery).
 *
 * Per-module DB isolation: the shared Crypto / Ratio / Merchants / OAuth /
 * Webhooks providers come from `createAppProviders`. The vendor-specific pieces
 * — config, catalog transform + push, initial bulk sync, reconcile, and the
 * guarded ScriptTag SDK registration — are wired here.
 * `ScheduleModule.forRoot()` powers the hourly reconcile cron.
 */
@Module({
  imports: [WizzyKyselyModule, ScheduleModule.forRoot()],
  controllers: [
    WizzyConfigController,
    WizzyOAuthController,
    CatalogController,
    WizzyWebhooksController,
    WizzyMerchantsController,
    StorefrontController,
  ],
  providers: [
    WizzyConfigService,
    StorefrontConfigService,
    WizzyBootstrap,
    // OAuth / token
    RatioTokenProvider,
    // Catalog
    RatioProductsService,
    CatalogSyncService,
    CatalogQueryService,
    ReconcileService,
    WizzyApiClient,
    // SDK / ScriptTag
    SdkRegistrationService,
    // Durable SQS queue
    QueueService,
    // Worker that drains `wizzy-product-sync`
    WizzySyncWorker,
    // Webhook handlers
    WizzyAppUninstalledHandler,
    WizzyProductCreatedHandler,
    WizzyProductUpdatedHandler,
    WizzyProductDeletedHandler,
    // Guards
    WizzyWebhookSignatureGuard,
    WizzyMerchantTokenGuard,
    // Vendor-specific token bindings
    { provide: WIZZY_RATIO_PRODUCTS, useExisting: RatioProductsService },
    {
      provide: WIZZY_RATIO_OAUTH_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthHttp =>
        new RatioOAuthHttp(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: WIZZY_RATIO_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthCreds => ({
        clientId: config.get('RATIO_WIZZY_CLIENT_ID' as never, { infer: true }) as string,
        clientSecret: config.get('RATIO_WIZZY_CLIENT_SECRET' as never, { infer: true }) as string,
      }),
    },
    {
      provide: 'WIZZY_SCRIPT_TAG_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ScriptTagClient =>
        new ScriptTagClient(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    // Shared factory providers (Crypto / Ratio / Merchants / OAuth / Webhooks).
    ...createAppProviders<WizzyDatabase>(
      {
        slug: 'wizzy',
        dbToken: WIZZY_DB_TOKEN,
        bootstrapClass: WizzyBootstrap,
        handlerClasses: [
          WizzyAppUninstalledHandler,
          WizzyProductCreatedHandler,
          WizzyProductUpdatedHandler,
          WizzyProductDeletedHandler,
        ],
      },
      {
        CRYPTO: WIZZY_CRYPTO,
        RATIO: WIZZY_RATIO,
        MERCHANTS: WIZZY_MERCHANTS,
        OAUTH: WIZZY_OAUTH,
        WEBHOOKS: WIZZY_WEBHOOKS,
      },
    ),
  ],
  exports: [],
})
export class WizzyModule {}
