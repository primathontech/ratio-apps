import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { QueueService } from '../../core/queue/queue.service';
import { FormsConfigController } from './config/config.controller';
import { FormsConfigService } from './config/config.service';
import type { FormsDatabase } from './db/types';
import { DeliverySweeperService } from './delivery/delivery-sweeper.service';
import { FormsEmailService } from './delivery/email.service';
import { FormsEmailWorker } from './delivery/email.worker';
import { WebhookDeliveryService } from './delivery/webhook-delivery.service';
import { WebhookDeliveryWorker } from './delivery/webhook-delivery.worker';
import { FormsController } from './forms/forms.controller';
import { FormsService } from './forms/forms.service';
import { FormsBootstrap } from './forms.bootstrap';
import { FormsMerchantTokenGuard, FormsWebhookSignatureGuard } from './guards';
import { FORMS_DB_TOKEN, FormsKyselyModule } from './kysely.module';
import { FormsMerchantsController } from './merchants/merchants.controller';
import { FormsOAuthController } from './oauth/oauth.controller';
import { FormsEmbedController } from './sdk/embed.controller';
import { FormsEmbedService } from './sdk/embed.service';
import { FormsSdkController } from './sdk/sdk.controller';
import { FormsSdkService } from './sdk/sdk.service';
import { FormsRecaptchaService } from './spam/recaptcha.service';
import { SubmitRateLimitService } from './spam/submit-rate-limit.service';
import { CsvExportService } from './submissions/csv-export.service';
import { ExportJobService } from './submissions/export-job.service';
import { FormsExportWorker } from './submissions/forms-export.worker';
import { IdempotencyService } from './submissions/idempotency.service';
import { PublicSubmissionsController } from './submissions/public-submissions.controller';
import { SchemaValidatorService } from './submissions/schema-validator.service';
import { SubmissionsController } from './submissions/submissions.controller';
import { SubmissionsService } from './submissions/submissions.service';
import { FORMS_CRYPTO, FORMS_MERCHANTS, FORMS_OAUTH, FORMS_RATIO, FORMS_WEBHOOKS } from './tokens';
import { FormsS3Service } from './uploads/s3.service';
import { UploadsController } from './uploads/uploads.controller';
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
  // ScheduleModule.forRoot() powers the minute delivery-sweeper cron
  // (google reconcile precedent — forRoot() is idempotent across modules).
  imports: [FormsKyselyModule, ScheduleModule.forRoot()],
  controllers: [
    FormsConfigController,
    FormsController,
    FormsSdkController,
    FormsEmbedController,
    PublicSubmissionsController,
    SubmissionsController,
    UploadsController,
    FormsOAuthController,
    FormsWebhooksController,
    FormsMerchantsController,
  ],
  providers: [
    FormsConfigService,
    FormsService,
    FormsSdkService,
    FormsEmbedService,
    FormsBootstrap,
    FormsAppUninstalledHandler,
    // Public intake chain (TRD §2): rate limit → form state → spam →
    // schema validation → idempotency → persist + delivery rows.
    SubmitRateLimitService,
    FormsRecaptchaService,
    SchemaValidatorService,
    IdempotencyService,
    SubmissionsService,
    CsvExportService,
    FormsS3Service,
    // Async CSV export: POST enqueues a job → self-gated worker streams the
    // CSV into S3 via lib-storage → GET polls for the signed download URL.
    ExportJobService,
    FormsExportWorker,
    // Delivery engine: minute sweeper (DB is the scheduler) → SQS →
    // self-gated workers → executors.
    QueueService,
    WebhookDeliveryService,
    FormsEmailService,
    WebhookDeliveryWorker,
    FormsEmailWorker,
    DeliverySweeperService,
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
