import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { KafkaService } from '../../core/kafka/kafka.service';
import { ClevertapBootstrap } from './clevertap.bootstrap';
import { ClevertapConfigController } from './config/config.controller';
import { ClevertapConfigService } from './config/config.service';
import type { ClevertapDatabase } from './db/types';
import {
  CLEVERTAP_EVENTS_CLIENT_FACTORY,
  ClevertapEventsClient,
  type ClevertapEventsClientFactory,
} from './events/clevertap-events.client';
import { ClevertapForwardingWorker } from './events/clevertap-forwarding.worker';
import { ClevertapForwardingService } from './events/forwarding.service';
import { ClevertapMerchantTokenGuard, ClevertapWebhookSignatureGuard } from './guards';
import { CLEVERTAP_DB_TOKEN, ClevertapKyselyModule } from './kysely.module';
import { ClevertapMerchantsController } from './merchants/merchants.controller';
import { ClevertapOAuthController } from './oauth/oauth.controller';
import { type RatioOAuthCreds, RatioOAuthHttp } from './oauth/ratio-oauth.http';
import { RatioTokenProvider } from './oauth/ratio-token.provider';
import { ClevertapSdkController } from './sdk/sdk.controller';
import { ClevertapSdkService } from './sdk/sdk.service';
import { ClevertapCatalogDirtyScheduler } from './sync/catalog-dirty.scheduler';
import { ClevertapCatalogSyncService } from './sync/catalog-sync.service';
import { RatioProductSourceClient } from './sync/product-source.client';
import {
  CLEVERTAP_APP_ENABLED,
  CLEVERTAP_CRYPTO,
  CLEVERTAP_FORWARD_WORKER_ENABLED,
  CLEVERTAP_MERCHANTS,
  CLEVERTAP_OAUTH,
  CLEVERTAP_PRODUCT_SOURCE,
  CLEVERTAP_RATIO,
  CLEVERTAP_RATIO_OAUTH_CREDS,
  CLEVERTAP_RATIO_OAUTH_HTTP,
  CLEVERTAP_WEBHOOKS,
} from './tokens';
import { ClevertapAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { ClevertapCustomerCreatedHandler } from './webhooks/customer-created.handler';
import { ClevertapCustomerUpdatedHandler } from './webhooks/customer-updated.handler';
import { ClevertapLoyaltyPointsCreditedHandler } from './webhooks/loyalty-points-credited.handler';
import { ClevertapLoyaltyPointsDebitedHandler } from './webhooks/loyalty-points-debited.handler';
import { ClevertapOrderCancelledHandler } from './webhooks/order-cancelled.handler';
import { ClevertapOrderCreatedHandler } from './webhooks/order-created.handler';
import { ClevertapOrderFulfilledHandler } from './webhooks/order-fulfilled.handler';
import { ClevertapOrderPaidHandler } from './webhooks/order-paid.handler';
import { ClevertapOrderPartiallyFulfilledHandler } from './webhooks/order-partially-fulfilled.handler';
import { ClevertapOrderUpdatedHandler } from './webhooks/order-updated.handler';
import { ClevertapProductCreatedHandler } from './webhooks/product-created.handler';
import { ClevertapProductDeletedHandler } from './webhooks/product-deleted.handler';
import { ClevertapProductUpdatedHandler } from './webhooks/product-updated.handler';
import { ClevertapReviewCreatedHandler } from './webhooks/review-created.handler';
import {
  ClevertapWebhooksCompatController,
  ClevertapWebhooksController,
} from './webhooks/webhooks.controller';

export { ClevertapMerchantTokenGuard, ClevertapWebhookSignatureGuard } from './guards';
export {
  CLEVERTAP_CRYPTO,
  CLEVERTAP_MERCHANTS,
  CLEVERTAP_OAUTH,
  CLEVERTAP_RATIO,
  CLEVERTAP_WEBHOOKS,
} from './tokens';

@Module({
  imports: [ClevertapKyselyModule],
  controllers: [
    ClevertapConfigController,
    ClevertapSdkController,
    ClevertapOAuthController,
    ClevertapWebhooksController,
    ClevertapWebhooksCompatController,
    ClevertapMerchantsController,
  ],
  providers: [
    ClevertapConfigService,
    ClevertapSdkService,
    ClevertapBootstrap,
    ClevertapForwardingService,
    ClevertapForwardingWorker,
    KafkaService,
    ClevertapCatalogSyncService,
    ClevertapCatalogDirtyScheduler,
    {
      provide: CLEVERTAP_APP_ENABLED,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): boolean =>
        config.get('CLEVERTAP_APP_ENABLED', { infer: true }),
    },
    {
      provide: CLEVERTAP_FORWARD_WORKER_ENABLED,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): boolean =>
        config.get('CLEVERTAP_FORWARD_WORKER_ENABLED', { infer: true }),
    },
    {
      provide: CLEVERTAP_EVENTS_CLIENT_FACTORY,
      useFactory: (): ClevertapEventsClientFactory => (apiHost: string) =>
        new ClevertapEventsClient({ apiHost }),
    },
    RatioTokenProvider,
    {
      provide: CLEVERTAP_RATIO_OAUTH_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthHttp =>
        new RatioOAuthHttp(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: CLEVERTAP_RATIO_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthCreds => ({
        clientId: config.get('RATIO_CLEVERTAP_CLIENT_ID' as never, { infer: true }) as string,
        clientSecret: config.get('RATIO_CLEVERTAP_CLIENT_SECRET' as never, {
          infer: true,
        }) as string,
      }),
    },
    {
      provide: CLEVERTAP_PRODUCT_SOURCE,
      inject: [RatioTokenProvider, ConfigService],
      useFactory: (tokens: RatioTokenProvider, config: ConfigService<Env, true>) =>
        new RatioProductSourceClient(tokens, {
          baseUrl: config.get('RATIO_API_BASE_URL', { infer: true }) as string,
        }),
    },
    ClevertapAppUninstalledHandler,
    ClevertapOrderPaidHandler,
    ClevertapOrderCreatedHandler,
    ClevertapOrderCancelledHandler,
    ClevertapOrderFulfilledHandler,
    ClevertapOrderPartiallyFulfilledHandler,
    ClevertapOrderUpdatedHandler,
    ClevertapCustomerCreatedHandler,
    ClevertapCustomerUpdatedHandler,
    ClevertapLoyaltyPointsCreditedHandler,
    ClevertapLoyaltyPointsDebitedHandler,
    ClevertapReviewCreatedHandler,
    ClevertapProductCreatedHandler,
    ClevertapProductUpdatedHandler,
    ClevertapProductDeletedHandler,
    ClevertapWebhookSignatureGuard,
    ClevertapMerchantTokenGuard,
    ...createAppProviders<ClevertapDatabase>(
      {
        slug: 'clevertap',
        dbToken: CLEVERTAP_DB_TOKEN,
        bootstrapClass: ClevertapBootstrap,
        handlerClasses: [
          ClevertapAppUninstalledHandler,
          ClevertapOrderPaidHandler,
          ClevertapOrderCreatedHandler,
          ClevertapOrderCancelledHandler,
          ClevertapOrderFulfilledHandler,
          ClevertapOrderPartiallyFulfilledHandler,
          ClevertapOrderUpdatedHandler,
          ClevertapCustomerCreatedHandler,
          ClevertapCustomerUpdatedHandler,
          ClevertapLoyaltyPointsCreditedHandler,
          ClevertapLoyaltyPointsDebitedHandler,
          ClevertapReviewCreatedHandler,
          ClevertapProductCreatedHandler,
          ClevertapProductUpdatedHandler,
          ClevertapProductDeletedHandler,
        ],
      },
      {
        CRYPTO: CLEVERTAP_CRYPTO,
        RATIO: CLEVERTAP_RATIO,
        MERCHANTS: CLEVERTAP_MERCHANTS,
        OAUTH: CLEVERTAP_OAUTH,
        WEBHOOKS: CLEVERTAP_WEBHOOKS,
      },
    ),
  ],
  exports: [],
})
export class ClevertapModule {}
