import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import type { Env } from '../../config/env.schema';
import { KafkaService } from '../../core/kafka/kafka.service';
import { createAppProviders } from '../../core/factories/app-module.factory';
import type { RatioOAuthCreds } from '../../core/oauth/ratio-oauth.http';
import { RatioOAuthHttp } from '../../core/oauth/ratio-oauth.http';
import { UcAdminDashboardController } from './controllers/admin-dashboard.controller';
import { UcAuthController } from './controllers/auth.controller';
import { UcCatalogController } from './controllers/catalog.controller';
import { UcConnectController } from './controllers/connect.controller';
import { UcDispatchController } from './controllers/dispatch.controller';
import { UcInventoryController } from './controllers/inventory.controller';
import { UcOrderCancelController } from './controllers/order-cancel.controller';
import { UcOrdersReadController } from './controllers/orders-read.controller';
import { UcStatusController } from './controllers/status.controller';
import { UcWebhooksController } from './controllers/webhooks.controller';
import type { UnicommerceDatabase } from './db/types';
import {
  UcApiKeyGuard,
  UcKillSwitchGuard,
  UcMerchantTokenGuard,
  UcWebhookSignatureGuard,
} from './guards';
import { UcMerchantsController } from './merchants/merchants.controller';
import { UC_DB_TOKEN, UnicommerceKyselyModule } from './kysely.module';
import { UcOAuthController } from './oauth/oauth.controller';
import { UcRatioTokenProvider } from './oauth/ratio-token.provider';
import { UcAlertingService } from './services/alerting.service';
import { UcCancelPushWorkerService } from './services/cancel-push-worker.service';
import { UcCatalogService } from './services/catalog.service';
import { UcConfigService } from './services/config.service';
import { UcCredentialsService } from './services/credentials.service';
import { UcEventLogService } from './services/event-log.service';
import { UcFeatureFlagsService } from './services/feature-flags.service';
import { UcInventoryService } from './services/inventory.service';
import { UcOrderItemMapService } from './services/order-item-map.service';
import { UcOrderPushWorkerService } from './services/order-push-worker.service';
import { UcReconciliationSweepService } from './services/reconciliation-sweep.service';
import { UcSkuCacheService } from './services/sku-cache.service';
import { UcStatusMappingService } from './services/status-mapping.service';
import { UcOutboundConsumerService } from './services/outbound-consumer.service';
import { UcSyncQueueService } from './services/sync-queue.service';
import { UcAuthService } from './services/uc-auth.service';
import { UcHttpClientImpl } from './services/uc-http-client';
import { UcRatioApiService } from './services/uc-ratio-api.service';
import {
  UC_CRYPTO,
  UC_MERCHANTS,
  UC_OAUTH,
  UC_RATIO,
  UC_RATIO_OAUTH_CREDS,
  UC_RATIO_OAUTH_HTTP,
  UC_WEBHOOKS,
} from './tokens';
import { UnicommerceBootstrap } from './unicommerce.bootstrap';
import { UcOrderCancelledHandler } from './webhooks/order-cancelled.handler';
import { UcOrderConfirmedHandler } from './webhooks/order-confirmed.handler';
import { UC_WEBHOOK_TOPICS, UcProductSyncHandler } from './webhooks/product-sync.handler';

export { UC_CRYPTO, UC_MERCHANTS, UC_OAUTH, UC_RATIO, UC_WEBHOOKS } from './tokens';

// Two DI tokens for the two topic-bound instances of the same handler class:
export const UC_PRODUCT_CREATE_HANDLER = Symbol.for('ratio-app:unicommerce:product-create-handler');
export const UC_PRODUCT_UPDATE_HANDLER = Symbol.for('ratio-app:unicommerce:product-update-handler');

@Module({
  imports: [UnicommerceKyselyModule, ScheduleModule.forRoot()],
  controllers: [
    UcAdminDashboardController,
    UcConnectController,
    UcAuthController,
    UcCatalogController,
    UcInventoryController,
    UcOrderCancelController,
    UcOrdersReadController,
    UcDispatchController,
    UcStatusController,
    UcWebhooksController,
    UcOAuthController,
    UcMerchantsController,
  ],
  providers: [
    UnicommerceBootstrap,
    KafkaService,
    UcCredentialsService,
    UcConfigService,
    UcEventLogService,
    UcAuthService,
    UcApiKeyGuard,
    UcKillSwitchGuard,
    UcWebhookSignatureGuard,
    UcMerchantTokenGuard,
    UcFeatureFlagsService,
    UcAlertingService,
    UcReconciliationSweepService,
    UcSkuCacheService,
    UcRatioTokenProvider,
    UcRatioApiService,
    UcInventoryService,
    UcOrderItemMapService,
    UcStatusMappingService,
    UcHttpClientImpl,
    UcOrderConfirmedHandler,
    UcOrderCancelledHandler,
    UcSyncQueueService,
    UcOutboundConsumerService,
    {
      provide: UC_PRODUCT_CREATE_HANDLER,
      useFactory: () => new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productCreate),
    },
    {
      provide: UC_PRODUCT_UPDATE_HANDLER,
      useFactory: () => new UcProductSyncHandler(UC_WEBHOOK_TOPICS.productUpdate),
    },
    // `UcOrderPushWorkerService` takes an interface (`UcHttpClient`) and a
    // plain `{ clientId, securityKey }` object as constructor args — neither
    // is DI-resolvable by type alone, so it's wired via useFactory (same
    // reasoning as `UcCatalogService` below): `UcHttpClientImpl` supplies the
    // concrete `UcHttpClient`, and the config object is built from the
    // Unicommerce-issued (shared, not per-merchant) `clientid`/`securitykey`
    // env vars.
    {
      provide: UcOrderPushWorkerService,
      inject: [UcCredentialsService, UcHttpClientImpl, ConfigService],
      useFactory: (
        credentials: UcCredentialsService,
        http: UcHttpClientImpl,
        config: ConfigService<Env, true>,
      ) =>
        new UcOrderPushWorkerService(credentials, http, {
          clientId:
            (config.get('RATIO_UNICOMMERCE_UC_CLIENT_ID' as never, { infer: true }) as
              | string
              | undefined) ?? '',
          securityKey:
            (config.get('RATIO_UNICOMMERCE_UC_SECURITY_KEY' as never, { infer: true }) as
              | string
              | undefined) ?? '',
          baseUrl: config.get('UC_GENERICPROXY_BASE_URL', { infer: true }) as string,
        }),
    },
    // Same reasoning/config as `UcOrderPushWorkerService` above — shares the
    // same shared (not per-merchant) clientid/securitykey env vars.
    {
      provide: UcCancelPushWorkerService,
      inject: [UcCredentialsService, UcHttpClientImpl, ConfigService],
      useFactory: (
        credentials: UcCredentialsService,
        http: UcHttpClientImpl,
        config: ConfigService<Env, true>,
      ) =>
        new UcCancelPushWorkerService(credentials, http, {
          clientId:
            (config.get('RATIO_UNICOMMERCE_UC_CLIENT_ID' as never, { infer: true }) as
              | string
              | undefined) ?? '',
          securityKey:
            (config.get('RATIO_UNICOMMERCE_UC_SECURITY_KEY' as never, { infer: true }) as
              | string
              | undefined) ?? '',
          baseUrl: config.get('UC_GENERICPROXY_BASE_URL', { infer: true }) as string,
        }),
    },
    {
      provide: UC_RATIO_OAUTH_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthHttp =>
        new RatioOAuthHttp(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: UC_RATIO_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthCreds => ({
        clientId: config.get('RATIO_UNICOMMERCE_CLIENT_ID' as never, { infer: true }) as string,
        clientSecret: config.get('RATIO_UNICOMMERCE_CLIENT_SECRET' as never, {
          infer: true,
        }) as string,
      }),
    },
    // UcCatalogService takes a plain `storefrontDomain: string` as its second
    // constructor arg (not a NestJS-injectable token by type alone), so it's
    // wired via useFactory rather than a bare class reference — Nest's
    // reflection-based DI can't resolve an undecorated `string` param.
    {
      provide: UcCatalogService,
      inject: [UcRatioApiService, ConfigService],
      useFactory: (ratio: UcRatioApiService, config: ConfigService<Env, true>) =>
        new UcCatalogService(
          ratio,
          (config.get('RATIO_UNICOMMERCE_STOREFRONT_DOMAIN', { infer: true }) as
            | string
            | undefined) ?? '',
        ),
    },
    ...createAppProviders<UnicommerceDatabase>(
      {
        slug: 'unicommerce',
        dbToken: UC_DB_TOKEN,
        bootstrapClass: UnicommerceBootstrap,
        handlerClasses: [
          UC_PRODUCT_CREATE_HANDLER,
          UC_PRODUCT_UPDATE_HANDLER,
          UcOrderConfirmedHandler,
          UcOrderCancelledHandler,
        ] as never,
      },
      {
        CRYPTO: UC_CRYPTO,
        RATIO: UC_RATIO,
        MERCHANTS: UC_MERCHANTS,
        OAUTH: UC_OAUTH,
        WEBHOOKS: UC_WEBHOOKS,
      },
    ),
  ],
})
export class UnicommerceModule {}
