import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailService } from '../../core/email/email.service';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { QueueService } from '../../core/queue/queue.service';
import { S3Service } from '../../core/storage/s3.service';
import { FormsConfigController } from './config/config.controller';
import { FormsConfigService } from './config/config.service';
import type { FormsDatabase } from './db/types';
import { FormsBounceController } from './outbound/bounce.controller';
import { FormsBounceService } from './outbound/bounce.service';
import { DeliverySweeperService } from './outbound/delivery-sweeper.service';
import { FormsEmailService } from './outbound/email.service';
import { FormsEmailWorker } from './outbound/email.worker';
import { WebhookDeliveryService } from './outbound/webhook-delivery.service';
import { WebhookDeliveryWorker } from './outbound/webhook-delivery.worker';
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

// Re-export guards from the barrel for external consumers (e.g. e2e setup).
export { FormsMerchantTokenGuard, FormsWebhookSignatureGuard } from './guards';
// Re-export tokens from the barrel; symbols live in ./tokens.ts to break the circular import.
export {
  FORMS_CRYPTO,
  FORMS_MERCHANTS,
  FORMS_OAUTH,
  FORMS_RATIO,
  FORMS_WEBHOOKS,
} from './tokens';

/** Forms feature module; per-module DB isolation, shared providers via createAppProviders. */
@Module({
  // ScheduleModule.forRoot() powers the minute delivery-sweeper cron (idempotent across modules).
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
    FormsBounceController,
  ],
  providers: [
    FormsConfigService,
    FormsService,
    FormsSdkService,
    FormsEmbedService,
    FormsBootstrap,
    FormsAppUninstalledHandler,
    // Public intake chain (TRD §2): rate limit → form state → spam → validation → idempotency → persist.
    SubmitRateLimitService,
    FormsRecaptchaService,
    SchemaValidatorService,
    IdempotencyService,
    SubmissionsService,
    CsvExportService,
    // Core S3 transport pinned to FORMS_S3_REGION (default ap-south-1) so forms S3 isn't bound to bare AWS_REGION (local SQS emulator).
    {
      provide: S3Service,
      useFactory: () =>
        new S3Service(
          new S3Client({ region: process.env.FORMS_S3_REGION?.trim() || 'ap-south-1' }),
        ),
    },
    FormsS3Service,
    // Async CSV export: POST enqueues → worker streams CSV to S3 → GET polls for the signed URL.
    ExportJobService,
    FormsExportWorker,
    // Delivery engine: minute sweeper (DB is the scheduler) → SQS → self-gated workers → executors.
    QueueService,
    EmailService,
    WebhookDeliveryService,
    FormsEmailService,
    // Inbound SES/SNS bounce endpoint → markBounced (PRD AC9).
    FormsBounceService,
    WebhookDeliveryWorker,
    FormsEmailWorker,
    DeliverySweeperService,
    // Class-shaped guards so controllers can reference them in @UseGuards (see ./guards.ts).
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
  exports: [],
})
export class FormsModule {}
