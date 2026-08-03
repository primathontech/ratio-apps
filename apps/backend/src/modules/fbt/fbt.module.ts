import { Module } from '@nestjs/common';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { FbtBootstrap } from './fbt.bootstrap';
import { FbtConfigController } from './config/config.controller';
import { FbtConfigService } from './config/config.service';
import type { FbtDatabase } from './db/types';
import { FbtMerchantTokenGuard, FbtWebhookSignatureGuard } from './guards';
import { FBT_DB_TOKEN, FbtKyselyModule } from './kysely.module';
import { FbtMerchantsController } from './merchants/merchants.controller';
import { FbtOAuthController } from './oauth/oauth.controller';
import { FbtSdkController } from './sdk/sdk.controller';
import { FbtSdkService } from './sdk/sdk.service';
import {
  FBT_CRYPTO,
  FBT_MERCHANTS,
  FBT_OAUTH,
  FBT_RATIO,
  FBT_WEBHOOKS,
} from './tokens';
import { FbtAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
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
 * `createAppProviders` factory; everything else (config + sdk services,
 * controllers, bootstrap, handler, guards) is wired here directly because
 * those pieces are app-specific.
 */
@Module({
  imports: [FbtKyselyModule],
  controllers: [
    FbtConfigController,
    FbtSdkController,
    FbtOAuthController,
    FbtWebhooksController,
    FbtMerchantsController,
  ],
  providers: [
    FbtConfigService,
    FbtSdkService,
    FbtBootstrap,
    FbtAppUninstalledHandler,
    // Guards are concrete @Injectable classes that defer to the per-module
    // factories internally (see ./guards.ts). They are class-shaped so
    // controllers can reference them in @UseGuards(GuardClass).
    FbtWebhookSignatureGuard,
    FbtMerchantTokenGuard,
    ...createAppProviders<FbtDatabase>(
      {
        slug: 'fbt',
        dbToken: FBT_DB_TOKEN,
        bootstrapClass: FbtBootstrap,
        handlerClass: FbtAppUninstalledHandler,
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
