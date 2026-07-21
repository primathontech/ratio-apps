import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { RedisService } from '../../core/cache/redis.service';
import { EmailService } from '../../core/email/email.service';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { QueueService } from '../../core/queue/queue.service';
import { S3Service } from '../../core/storage/s3.service';
import { LoyaltyBulkController } from './bulk/bulk.controller';
import { BulkService } from './bulk/bulk.service';
import { BulkWorker } from './bulk/bulk.worker';
import { LoyaltyConfigController } from './config/config.controller';
import { LoyaltyConfigService } from './config/config.service';
import { CoreLoyaltyClient } from './core-client/core-loyalty.client';
import { GokwikIdentityClient } from './core-client/gokwik-identity.client';
import { LoyaltyCustomersController } from './customers/customers.controller';
import { DailySnapshotJob } from './dashboard/daily-snapshot.job';
import { LoyaltyDashboardController } from './dashboard/dashboard.controller';
import { MaintenanceWorker } from './dashboard/maintenance.worker';
import { StatsService } from './dashboard/stats.service';
import type { LoyaltyDatabase } from './db/types';
import { LoyaltyExportsController } from './exports/exports.controller';
import { ExportsService, LOYALTY_CUSTOMER_QUERY } from './exports/exports.service';
import { ExportsWorker } from './exports/exports.worker';
import { LoyaltyMerchantTokenGuard, LoyaltyWebhookSignatureGuard } from './guards';
import { LOYALTY_DB_TOKEN, LoyaltyKyselyModule } from './kysely.module';
import { LoyaltyBootstrap } from './loyalty.bootstrap';
import { LoyaltyMerchantsController } from './merchants/merchants.controller';
import { CustomerMirrorService } from './mirror/customer-mirror.service';
import { CustomerQueryService } from './mirror/customer-query.service';
import { LoyaltyOAuthController } from './oauth/oauth.controller';
import { type RatioOAuthCreds, RatioOAuthHttp } from './oauth/ratio-oauth.http';
import { RatioTokenProvider } from './oauth/ratio-token.provider';
import { QrController } from './qr/qr.controller';
import { QrService } from './qr/qr.service';
import { QrClaimController } from './qr/qr-claim.controller';
import { RuleCacheService } from './rules/rule-cache.service';
import { RuleEvaluatorService } from './rules/rule-evaluator.service';
import { LoyaltyRulesController } from './rules/rules.controller';
import { RulesService } from './rules/rules.service';
import { StorefrontController } from './storefront/storefront.controller';
import { StorefrontConfigService } from './storefront/storefront-config.service';
import {
  LOYALTY_CORE_CLIENT,
  LOYALTY_CRYPTO,
  LOYALTY_GK_IDENTITY,
  LOYALTY_MERCHANTS,
  LOYALTY_OAUTH,
  LOYALTY_RATIO,
  LOYALTY_RATIO_OAUTH_CREDS,
  LOYALTY_RATIO_OAUTH_HTTP,
  LOYALTY_WEBHOOKS,
} from './tokens';
import { LoyaltyAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { LoyaltyOrderCancelledHandler } from './webhooks/order-cancelled.handler';
import { LoyaltyOrderCreatedHandler } from './webhooks/order-created.handler';
import { LoyaltyWebhooksController } from './webhooks/webhooks.controller';

// Re-export guards so external consumers (e.g. e2e setup) can import from
// the barrel; controllers internal to this module pull from ./guards.
export { LoyaltyMerchantTokenGuard, LoyaltyWebhookSignatureGuard } from './guards';
// Re-export the tokens from the module barrel so existing
// `import { LOYALTY_MERCHANTS } from './loyalty.module'` call sites keep
// working. The symbols themselves live in `./tokens.ts` to break the
// circular import between this file and its sibling services/guards.
export {
  LOYALTY_CORE_CLIENT,
  LOYALTY_CRYPTO,
  LOYALTY_GK_IDENTITY,
  LOYALTY_MERCHANTS,
  LOYALTY_OAUTH,
  LOYALTY_RATIO,
  LOYALTY_WEBHOOKS,
} from './tokens';

/**
 * Loyalty feature module — merchant admin tooling on top of the Core Loyalty
 * Service (bulk coin ops, dynamic earning rules, QR offline events, exports,
 * analytics).
 *
 * Nothing crosses modules by design — per-module DB isolation. The Crypto /
 * Ratio / Merchants / OAuth / Webhooks providers are built by the shared
 * `createAppProviders` factory; everything else is wired here directly.
 */
@Module({
  imports: [LoyaltyKyselyModule],
  controllers: [
    LoyaltyConfigController,
    LoyaltyOAuthController,
    LoyaltyWebhooksController,
    LoyaltyMerchantsController,
    StorefrontController,
    LoyaltyRulesController,
    LoyaltyBulkController,
    LoyaltyExportsController,
    QrController,
    QrClaimController,
    LoyaltyCustomersController,
    LoyaltyDashboardController,
  ],
  providers: [
    LoyaltyConfigService,
    StorefrontConfigService,
    RedisService,
    QueueService,
    S3Service,
    EmailService,
    LoyaltyBootstrap,
    LoyaltyAppUninstalledHandler,
    LoyaltyOrderCreatedHandler,
    LoyaltyOrderCancelledHandler,
    CustomerMirrorService,
    CustomerQueryService,
    { provide: LOYALTY_CUSTOMER_QUERY, useExisting: CustomerQueryService },
    RuleCacheService,
    RuleEvaluatorService,
    RulesService,
    BulkService,
    BulkWorker,
    ExportsService,
    ExportsWorker,
    QrService,
    StatsService,
    DailySnapshotJob,
    MaintenanceWorker,
    // Guards are concrete @Injectable classes that defer to the per-module
    // factories internally (see ./guards.ts). They are class-shaped so
    // controllers can reference them in @UseGuards(GuardClass).
    LoyaltyWebhookSignatureGuard,
    LoyaltyMerchantTokenGuard,
    // Ratio OAuth token plumbing (wizzy pattern) — feeds CoreLoyaltyClient.
    RatioTokenProvider,
    {
      provide: LOYALTY_RATIO_OAUTH_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthHttp =>
        new RatioOAuthHttp(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: LOYALTY_RATIO_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthCreds => ({
        clientId: config.get('RATIO_LOYALTY_CLIENT_ID' as never, { infer: true }) as string,
        clientSecret: config.get('RATIO_LOYALTY_CLIENT_SECRET' as never, { infer: true }) as string,
      }),
    },
    {
      provide: LOYALTY_CORE_CLIENT,
      inject: [RatioTokenProvider, ConfigService],
      useFactory: (tokens: RatioTokenProvider, config: ConfigService<Env, true>) =>
        new CoreLoyaltyClient(tokens, {
          baseUrl: config.get('RATIO_API_BASE_URL', { infer: true }) as string,
        }),
    },
    {
      provide: LOYALTY_GK_IDENTITY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new GokwikIdentityClient({
          baseUrl: config.get('RATIO_API_BASE_URL', { infer: true }) as string,
        }),
    },
    // Shared factory providers (Crypto / Ratio / Merchants / OAuth / Webhooks).
    ...createAppProviders<LoyaltyDatabase>(
      {
        slug: 'loyalty',
        dbToken: LOYALTY_DB_TOKEN,
        bootstrapClass: LoyaltyBootstrap,
        handlerClasses: [
          LoyaltyAppUninstalledHandler,
          LoyaltyOrderCreatedHandler,
          LoyaltyOrderCancelledHandler,
        ],
      },
      {
        CRYPTO: LOYALTY_CRYPTO,
        RATIO: LOYALTY_RATIO,
        MERCHANTS: LOYALTY_MERCHANTS,
        OAUTH: LOYALTY_OAUTH,
        WEBHOOKS: LOYALTY_WEBHOOKS,
      },
    ),
  ],
  // Nothing crosses modules by design — per-module DB isolation.
  exports: [],
})
export class LoyaltyModule {}
