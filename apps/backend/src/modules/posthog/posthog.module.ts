import { Module } from '@nestjs/common';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { PosthogConfigController } from './config/config.controller';
import { PosthogConfigService } from './config/config.service';
import type { PosthogDatabase } from './db/types';
import { PosthogMerchantTokenGuard, PosthogWebhookSignatureGuard } from './guards';
import { POSTHOG_DB_TOKEN, PosthogKyselyModule } from './kysely.module';
import { PosthogMerchantsController } from './merchants/merchants.controller';
import { PosthogOAuthController } from './oauth/oauth.controller';
import { PosthogBootstrap } from './posthog.bootstrap';
import { PosthogSdkController } from './sdk/sdk.controller';
import { PosthogSdkService } from './sdk/sdk.service';
import {
  POSTHOG_CRYPTO,
  POSTHOG_MERCHANTS,
  POSTHOG_OAUTH,
  POSTHOG_RATIO,
  POSTHOG_WEBHOOKS,
} from './tokens';
import { PosthogAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { PosthogWebhooksController } from './webhooks/webhooks.controller';

// Re-export guards so external consumers (e.g. e2e setup) can import from
// the barrel; controllers internal to this module pull from ./guards.
export { PosthogMerchantTokenGuard, PosthogWebhookSignatureGuard } from './guards';
// Re-export the tokens from the module barrel so existing
// `import { POSTHOG_MERCHANTS } from './posthog.module'` call sites keep
// working. The symbols themselves live in `./tokens.ts` to break the
// circular import between this file and its sibling services/guards.
export {
  POSTHOG_CRYPTO,
  POSTHOG_MERCHANTS,
  POSTHOG_OAUTH,
  POSTHOG_RATIO,
  POSTHOG_WEBHOOKS,
} from './tokens';

/**
 * PostHog feature module.
 *
 * Nothing crosses modules by design — per-module DB isolation. The Crypto /
 * Ratio / Merchants / OAuth / Webhooks providers are built by the shared
 * `createAppProviders` factory; everything else (config + sdk services,
 * controllers, bootstrap, handler, guards) is wired here directly because
 * those pieces are app-specific.
 */
@Module({
  imports: [PosthogKyselyModule],
  controllers: [
    PosthogConfigController,
    PosthogSdkController,
    PosthogOAuthController,
    PosthogWebhooksController,
    PosthogMerchantsController,
  ],
  providers: [
    PosthogConfigService,
    PosthogSdkService,
    PosthogBootstrap,
    PosthogAppUninstalledHandler,
    // Guards are concrete @Injectable classes that defer to the per-module
    // factories internally (see ./guards.ts). They are class-shaped so
    // controllers can reference them in @UseGuards(GuardClass).
    PosthogWebhookSignatureGuard,
    PosthogMerchantTokenGuard,
    ...createAppProviders<PosthogDatabase>(
      {
        slug: 'posthog',
        dbToken: POSTHOG_DB_TOKEN,
        bootstrapClass: PosthogBootstrap,
        handlerClass: PosthogAppUninstalledHandler,
      },
      {
        CRYPTO: POSTHOG_CRYPTO,
        RATIO: POSTHOG_RATIO,
        MERCHANTS: POSTHOG_MERCHANTS,
        OAUTH: POSTHOG_OAUTH,
        WEBHOOKS: POSTHOG_WEBHOOKS,
      },
    ),
  ],
  // Nothing crosses modules by design — per-module DB isolation.
  exports: [],
})
export class PosthogModule {}
