import { Module } from '@nestjs/common';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { FormsConfigController } from './config/config.controller';
import { FormsConfigService } from './config/config.service';
import type { FormsDatabase } from './db/types';
import { FormsController } from './forms/forms.controller';
import { FormsService } from './forms/forms.service';
import { FormsBootstrap } from './forms.bootstrap';
import { FormsMerchantTokenGuard, FormsWebhookSignatureGuard } from './guards';
import { FORMS_DB_TOKEN, FormsKyselyModule } from './kysely.module';
import { FormsMerchantsController } from './merchants/merchants.controller';
import { FormsOAuthController } from './oauth/oauth.controller';
import { FormsSdkController } from './sdk/sdk.controller';
import { FormsSdkService } from './sdk/sdk.service';
import { FORMS_CRYPTO, FORMS_MERCHANTS, FORMS_OAUTH, FORMS_RATIO, FORMS_WEBHOOKS } from './tokens';
import { FormsAppUninstalledHandler } from './webhooks/app-uninstalled.handler';
import { FormsWebhooksController } from './webhooks/webhooks.controller';

// Re-export guards so external consumers (e.g. e2e setup) can import from
// the barrel; controllers internal to this module pull from ./guards.
export { FormsMerchantTokenGuard, FormsWebhookSignatureGuard } from './guards';
// Re-export the tokens from the module barrel so existing
// `import { FORMS_MERCHANTS } from './forms.module'` call sites keep
// working. The symbols themselves live in `./tokens.ts` to break the
// circular import between this file and its sibling services/guards.
export {
  FORMS_CRYPTO,
  FORMS_MERCHANTS,
  FORMS_OAUTH,
  FORMS_RATIO,
  FORMS_WEBHOOKS,
} from './tokens';

/**
 * Forms feature module.
 *
 * Nothing crosses modules by design — per-module DB isolation. The Crypto /
 * Ratio / Merchants / OAuth / Webhooks providers are built by the shared
 * `createAppProviders` factory; everything else (config + sdk services,
 * controllers, bootstrap, handler, guards) is wired here directly because
 * those pieces are app-specific.
 */
@Module({
  imports: [FormsKyselyModule],
  controllers: [
    FormsConfigController,
    FormsController,
    FormsSdkController,
    FormsOAuthController,
    FormsWebhooksController,
    FormsMerchantsController,
  ],
  providers: [
    FormsConfigService,
    FormsService,
    FormsSdkService,
    FormsBootstrap,
    FormsAppUninstalledHandler,
    // Guards are concrete @Injectable classes that defer to the per-module
    // factories internally (see ./guards.ts). They are class-shaped so
    // controllers can reference them in @UseGuards(GuardClass).
    FormsWebhookSignatureGuard,
    FormsMerchantTokenGuard,
    ...createAppProviders<FormsDatabase>(
      {
        slug: 'forms',
        dbToken: FORMS_DB_TOKEN,
        bootstrapClass: FormsBootstrap,
        handlerClass: FormsAppUninstalledHandler,
      },
      {
        CRYPTO: FORMS_CRYPTO,
        RATIO: FORMS_RATIO,
        MERCHANTS: FORMS_MERCHANTS,
        OAUTH: FORMS_OAUTH,
        WEBHOOKS: FORMS_WEBHOOKS,
      },
    ),
  ],
  // Nothing crosses modules by design — per-module DB isolation.
  exports: [],
})
export class FormsModule {}
