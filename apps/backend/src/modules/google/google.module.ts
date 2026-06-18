import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import type { Env } from '../../config/env.schema';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { QueueService } from '../../core/queue/queue.service';
import { GoogleBootstrap } from './google.bootstrap';
import { GoogleConfigController } from './config/config.controller';
import { GoogleConfigService } from './config/config.service';
import type { GoogleDatabase } from './db/types';
import { DiscoveryService } from './discovery/discovery.service';
import { FeedQueryService } from './gmc/feed-query.service';
import { FeedSyncService } from './gmc/feed-sync.service';
import { GoogleProductSyncWorker } from './gmc/google-product-sync.worker';
import { GmcValidationService } from './gmc/gmc-validation.service';
import { GoogleFeedController } from './gmc/feed.controller';
import { RatioProductsService } from './gmc/ratio-products.service';
import { ReconcileService } from './gmc/reconcile.service';
import { GoogleAuthService } from './google-oauth/google-auth.service';
import { GoogleConnectController } from './google-oauth/google-oauth.controller';
import { GoogleOAuthHttp, type GoogleOAuthCreds } from './google-oauth/google-oauth.http';
import { RatioOAuthHttp, type RatioOAuthCreds } from './google-oauth/ratio-oauth.http';
import { RatioTokenProvider } from './google-oauth/ratio-token.provider';
import { GoogleMerchantTokenGuard, GoogleWebhookSignatureGuard } from './guards';
import { GOOGLE_DB_TOKEN, GoogleKyselyModule } from './kysely.module';
import { GoogleMerchantsController } from './merchants/merchants.controller';
import { GoogleOAuthController } from './oauth/oauth.controller';
import { PixelRegistrationService } from './sdk/pixel-registration.service';
import { GoogleSdkController } from './sdk/sdk.controller';
import { GoogleSdkService } from './sdk/sdk.service';
import { WebPixelsApi } from './sdk/web-pixels.api';
import {
  GOOGLE_CRYPTO,
  GOOGLE_MERCHANTS,
  GOOGLE_OAUTH,
  GOOGLE_OAUTH_CREDS,
  GOOGLE_OAUTH_HTTP,
  GOOGLE_RATIO,
  GOOGLE_RATIO_OAUTH_CREDS,
  GOOGLE_RATIO_OAUTH_HTTP,
  GOOGLE_RATIO_PRODUCTS,
  GOOGLE_WEB_PIXELS,
  GOOGLE_WEBHOOKS,
} from './tokens';
import { GoogleAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { GoogleProductCreatedHandler } from './webhooks/product-created.handler';
import { GoogleProductDeletedHandler } from './webhooks/product-deleted.handler';
import { GoogleProductUpdatedHandler } from './webhooks/product-updated.handler';
import { GoogleWebhooksController } from './webhooks/webhooks.controller';

// Re-export guards so external consumers (e.g. e2e setup) can import from the barrel.
export { GoogleMerchantTokenGuard, GoogleWebhookSignatureGuard } from './guards';
export {
  GOOGLE_CRYPTO,
  GOOGLE_MERCHANTS,
  GOOGLE_OAUTH,
  GOOGLE_RATIO,
  GOOGLE_WEBHOOKS,
} from './tokens';

/**
 * Google feature module (GA4 + Google Ads + Merchant Center).
 *
 * Per-module DB isolation: the shared Crypto / Ratio / Merchants / OAuth /
 * Webhooks providers come from `createAppProviders` (the webhook provider is now
 * fed all four topic handlers). The vendor-specific pieces — config, SDK/pixel
 * delivery + guarded Web Pixels registration, the GMC feed-sync / reconcile /
 * validation services, and the Google OAuth/token layer — are wired here.
 * `ScheduleModule.forRoot()` powers the hourly reconcile cron.
 */
@Module({
  imports: [GoogleKyselyModule, ScheduleModule.forRoot()],
  controllers: [
    GoogleConfigController,
    GoogleSdkController,
    GoogleOAuthController,
    GoogleConnectController,
    GoogleFeedController,
    GoogleWebhooksController,
    GoogleMerchantsController,
  ],
  providers: [
    GoogleConfigService,
    GoogleSdkService,
    GoogleBootstrap,
    // Vendor services
    GoogleAuthService,
    RatioProductsService,
    RatioTokenProvider,
    FeedSyncService,
    FeedQueryService,
    ReconcileService,
    GmcValidationService,
    DiscoveryService,
    PixelRegistrationService,
    // Durable SQS queue (product webhooks enqueue; a worker drains it)
    QueueService,
    // Worker that drains `google-product-sync` → GMC (self-gates on GOOGLE_SYNC_WORKER_ENABLED)
    GoogleProductSyncWorker,
    // Webhook handlers (one per subscribed topic)
    GoogleAppUninstalledHandler,
    GoogleProductCreatedHandler,
    GoogleProductUpdatedHandler,
    GoogleProductDeletedHandler,
    // Guards
    GoogleWebhookSignatureGuard,
    GoogleMerchantTokenGuard,
    // Vendor-specific token bindings
    { provide: GOOGLE_RATIO_PRODUCTS, useExisting: RatioProductsService },
    {
      provide: GOOGLE_OAUTH_HTTP,
      useFactory: (): GoogleOAuthHttp => new GoogleOAuthHttp(),
    },
    {
      provide: GOOGLE_RATIO_OAUTH_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthHttp =>
        new RatioOAuthHttp(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: GOOGLE_RATIO_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthCreds => ({
        clientId: config.get('RATIO_GOOGLE_CLIENT_ID' as never, { infer: true }) as string,
        clientSecret: config.get('RATIO_GOOGLE_CLIENT_SECRET' as never, { infer: true }) as string,
      }),
    },
    {
      provide: GOOGLE_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): GoogleOAuthCreds => ({
        clientId: (config.get('RATIO_GOOGLE_GOOGLE_CLIENT_ID' as never, { infer: true }) ??
          '') as string,
        clientSecret: (config.get('RATIO_GOOGLE_GOOGLE_CLIENT_SECRET' as never, {
          infer: true,
        }) ?? '') as string,
        redirectUri: (config.get('RATIO_GOOGLE_GOOGLE_REDIRECT_URI' as never, { infer: true }) ??
          '') as string,
      }),
    },
    {
      provide: GOOGLE_WEB_PIXELS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): WebPixelsApi =>
        new WebPixelsApi(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    // Shared factory providers (Crypto / Ratio / Merchants / OAuth / Webhooks).
    // The webhook service is fed all four handlers via `handlerClasses`.
    ...createAppProviders<GoogleDatabase>(
      {
        slug: 'google',
        dbToken: GOOGLE_DB_TOKEN,
        bootstrapClass: GoogleBootstrap,
        handlerClasses: [
          GoogleAppUninstalledHandler,
          GoogleProductCreatedHandler,
          GoogleProductUpdatedHandler,
          GoogleProductDeletedHandler,
        ],
      },
      {
        CRYPTO: GOOGLE_CRYPTO,
        RATIO: GOOGLE_RATIO,
        MERCHANTS: GOOGLE_MERCHANTS,
        OAUTH: GOOGLE_OAUTH,
        WEBHOOKS: GOOGLE_WEBHOOKS,
      },
    ),
  ],
  exports: [],
})
export class GoogleModule {}
