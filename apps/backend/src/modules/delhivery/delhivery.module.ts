import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import type { Env } from '../../config/env.schema';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { QueueService } from '../../core/queue/queue.service';
import { DelhiveryBootstrap } from './delhivery.bootstrap';
import { DelhiveryConfigController } from './config/config.controller';
import { DelhiveryConfigService } from './config/config.service';
import type { DelhiveryDatabase } from './db/types';
import { KwikEngageClient } from './events/kwikengage.client';
import { DelhiveryMerchantTokenGuard, DelhiveryWebhookSignatureGuard } from './guards';
import { DELHIVERY_DB_TOKEN, DelhiveryKyselyModule } from './kysely.module';
import { DelhiveryMerchantsController } from './merchants/merchants.controller';
import { DelhiveryOAuthController } from './oauth/oauth.controller';
import { RatioOAuthHttp, type RatioOAuthCreds } from './oauth/ratio-oauth.http';
import { RatioTokenProvider } from './oauth/ratio-token.provider';
import { PickupCron } from './pickup/pickup.cron';
import { RatioOrdersService } from './ratio/ratio-orders.service';
import { DelhiveryServiceabilityService } from './serviceability/serviceability.service';
import { DelhiverySdkController } from './sdk/sdk.controller';
import { DelhiverySdkService } from './sdk/sdk.service';
import { ShipmentCreateWorker } from './shipments/shipment-create.worker';
import { DelhiveryShipmentService } from './shipments/shipment.service';
import { DelhiveryShipmentsController } from './shipments/shipments.controller';
import { DelhiveryStorefrontController } from './storefront/storefront.controller';
import {
  DELHIVERY_CRYPTO,
  DELHIVERY_KWIKENGAGE,
  DELHIVERY_MERCHANTS,
  DELHIVERY_OAUTH,
  DELHIVERY_ORDERS,
  DELHIVERY_RATIO,
  DELHIVERY_RATIO_OAUTH_CREDS,
  DELHIVERY_RATIO_OAUTH_HTTP,
  DELHIVERY_WEBHOOKS,
} from './tokens';
import { TrackingReconcileCron } from './tracking/tracking-reconcile.cron';
import { DelhiveryTrackingService } from './tracking/tracking.service';
import { DelhiveryAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { DelhiveryOrdersCancelledHandler } from './webhooks/orders-cancelled.handler';
import { DelhiveryOrdersEditedHandler } from './webhooks/orders-edited.handler';
import { DelhiveryOrdersPaidHandler } from './webhooks/orders-paid.handler';
import { DelhiveryWebhooksController } from './webhooks/webhooks.controller';

// Re-export guards so external consumers (e.g. e2e setup) can import from
// the barrel; controllers internal to this module pull from ./guards.
export { DelhiveryMerchantTokenGuard, DelhiveryWebhookSignatureGuard } from './guards';
// Re-export the tokens from the module barrel so existing
// `import { DELHIVERY_MERCHANTS } from './delhivery.module'` call sites keep
// working. The symbols themselves live in `./tokens.ts` to break the
// circular import between this file and its sibling services/guards.
export {
  DELHIVERY_CRYPTO,
  DELHIVERY_MERCHANTS,
  DELHIVERY_OAUTH,
  DELHIVERY_RATIO,
  DELHIVERY_WEBHOOKS,
} from './tokens';

/**
 * Delhivery Direct feature module — a CARRIER app (thin integration; the
 * module DB is the shipment source of truth, no Ratio Fulfillment Service).
 *
 * Per-module DB isolation: the shared Crypto / Ratio / Merchants / OAuth /
 * Webhooks providers come from `createAppProviders` (the webhook provider is
 * fed all four topic handlers). Vendor-specific pieces wired here: the
 * Delhivery Express B2C adapter (SdkService), config (token encrypted at
 * rest), shipments + tracking + serviceability services, the SQS shipment
 * worker, and the tracking-reconcile / pickup crons
 * (`ScheduleModule.forRoot()`).
 */
@Module({
  imports: [DelhiveryKyselyModule, ScheduleModule.forRoot()],
  controllers: [
    DelhiveryConfigController,
    DelhiverySdkController,
    // PUBLIC storefront-SDK routes: per-merchant loader + shared widget bundle
    DelhiveryStorefrontController,
    DelhiveryShipmentsController,
    DelhiveryOAuthController,
    DelhiveryWebhooksController,
    DelhiveryMerchantsController,
  ],
  providers: [
    DelhiveryConfigService,
    DelhiverySdkService,
    DelhiveryServiceabilityService,
    DelhiveryShipmentService,
    DelhiveryTrackingService,
    DelhiveryBootstrap,
    // Ratio platform (orders/products/inventory) access
    RatioTokenProvider,
    RatioOrdersService,
    // App-side shipping events
    KwikEngageClient,
    // Durable SQS queue (orders/* webhooks enqueue; the worker drains it)
    QueueService,
    // Worker + crons (worker self-gates on DELHIVERY_SHIPMENT_WORKER_ENABLED)
    ShipmentCreateWorker,
    TrackingReconcileCron,
    PickupCron,
    // Webhook handlers (one per subscribed topic)
    DelhiveryAppUninstalledHandler,
    DelhiveryOrdersPaidHandler,
    DelhiveryOrdersCancelledHandler,
    DelhiveryOrdersEditedHandler,
    // Guards are concrete @Injectable classes that defer to the per-module
    // factories internally (see ./guards.ts). They are class-shaped so
    // controllers can reference them in @UseGuards(GuardClass).
    DelhiveryWebhookSignatureGuard,
    DelhiveryMerchantTokenGuard,
    // Vendor-specific token bindings
    { provide: DELHIVERY_ORDERS, useExisting: RatioOrdersService },
    { provide: DELHIVERY_KWIKENGAGE, useExisting: KwikEngageClient },
    {
      provide: DELHIVERY_RATIO_OAUTH_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthHttp =>
        new RatioOAuthHttp(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: DELHIVERY_RATIO_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthCreds => ({
        clientId: config.get('RATIO_DELHIVERY_CLIENT_ID' as never, { infer: true }) as string,
        clientSecret: config.get('RATIO_DELHIVERY_CLIENT_SECRET' as never, {
          infer: true,
        }) as string,
      }),
    },
    ...createAppProviders<DelhiveryDatabase>(
      {
        slug: 'delhivery',
        dbToken: DELHIVERY_DB_TOKEN,
        bootstrapClass: DelhiveryBootstrap,
        handlerClasses: [
          DelhiveryAppUninstalledHandler,
          DelhiveryOrdersPaidHandler,
          DelhiveryOrdersCancelledHandler,
          DelhiveryOrdersEditedHandler,
        ],
      },
      {
        CRYPTO: DELHIVERY_CRYPTO,
        RATIO: DELHIVERY_RATIO,
        MERCHANTS: DELHIVERY_MERCHANTS,
        OAUTH: DELHIVERY_OAUTH,
        WEBHOOKS: DELHIVERY_WEBHOOKS,
      },
    ),
  ],
  // Nothing crosses modules by design — per-module DB isolation.
  exports: [],
})
export class DelhiveryModule {}
