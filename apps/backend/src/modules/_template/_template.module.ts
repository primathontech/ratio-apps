import { Module } from '@nestjs/common';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { TemplateBootstrap } from './_template.bootstrap';
import { TemplateConfigController } from './config/config.controller';
import { TemplateConfigService } from './config/config.service';
import type { TemplateDatabase } from './db/types';
import { TemplateMerchantTokenGuard, TemplateWebhookSignatureGuard } from './guards';
import { TEMPLATE_DB_TOKEN, TemplateKyselyModule } from './kysely.module';
import { TemplateMerchantsController } from './merchants/merchants.controller';
import { TemplateOAuthController } from './oauth/oauth.controller';
import { TemplateSdkController } from './sdk/sdk.controller';
import { TemplateSdkService } from './sdk/sdk.service';
import {
  TEMPLATE_CRYPTO,
  TEMPLATE_MERCHANTS,
  TEMPLATE_OAUTH,
  TEMPLATE_RATIO,
  TEMPLATE_WEBHOOKS,
} from './tokens';
import { TemplateAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { TemplateWebhooksController } from './webhooks/webhooks.controller';

// Re-export guards so external consumers (e.g. e2e setup) can import from
// the barrel; controllers internal to this module pull from ./guards.
export { TemplateMerchantTokenGuard, TemplateWebhookSignatureGuard } from './guards';
// Re-export the tokens from the module barrel so existing
// `import { TEMPLATE_MERCHANTS } from './_template.module'` call sites keep
// working. The symbols themselves live in `./tokens.ts` to break the
// circular import between this file and its sibling services/guards.
export {
  TEMPLATE_CRYPTO,
  TEMPLATE_MERCHANTS,
  TEMPLATE_OAUTH,
  TEMPLATE_RATIO,
  TEMPLATE_WEBHOOKS,
} from './tokens';

/**
 * Template feature module.
 *
 * Nothing crosses modules by design — per-module DB isolation. The Crypto /
 * Ratio / Merchants / OAuth / Webhooks providers are built by the shared
 * `createAppProviders` factory; everything else (config + sdk services,
 * controllers, bootstrap, handler, guards) is wired here directly because
 * those pieces are app-specific.
 */
@Module({
  imports: [TemplateKyselyModule],
  controllers: [
    TemplateConfigController,
    TemplateSdkController,
    TemplateOAuthController,
    TemplateWebhooksController,
    TemplateMerchantsController,
  ],
  providers: [
    TemplateConfigService,
    TemplateSdkService,
    TemplateBootstrap,
    TemplateAppUninstalledHandler,
    // Guards are concrete @Injectable classes that defer to the per-module
    // factories internally (see ./guards.ts). They are class-shaped so
    // controllers can reference them in @UseGuards(GuardClass).
    TemplateWebhookSignatureGuard,
    TemplateMerchantTokenGuard,
    ...createAppProviders<TemplateDatabase>(
      {
        slug: '_template',
        dbToken: TEMPLATE_DB_TOKEN,
        bootstrapClass: TemplateBootstrap,
        handlerClass: TemplateAppUninstalledHandler,
      },
      {
        CRYPTO: TEMPLATE_CRYPTO,
        RATIO: TEMPLATE_RATIO,
        MERCHANTS: TEMPLATE_MERCHANTS,
        OAUTH: TEMPLATE_OAUTH,
        WEBHOOKS: TEMPLATE_WEBHOOKS,
      },
    ),
  ],
  // Nothing crosses modules by design — per-module DB isolation.
  exports: [],
})
export class TemplateModule {}
