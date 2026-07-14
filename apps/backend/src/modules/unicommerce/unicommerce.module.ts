import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { createAppProviders } from '../../core/factories/app-module.factory';
import { UnicommerceDatabase } from './db/types';
import { UC_DB_TOKEN, UnicommerceKyselyModule } from './kysely.module';
import {
  UC_CRYPTO,
  UC_MERCHANTS,
  UC_OAUTH,
  UC_RATIO,
  UC_WEBHOOKS,
  UC_MOCK_UNICOMMERCE,
  UC_MOCK_RATIO,
} from './tokens';
import { UcWebhookSignatureGuard, UcAdminTokenGuard } from './guards';

import { UcCredentialsService } from './services/credentials.service';
import { UcOauthService } from './services/oauth.service';
import { UcOrderPushService } from './services/order-push.service';
import { UcOrderCancelService } from './services/order-cancel.service';
import { UcFulfillmentPollService } from './services/fulfillment-poll.service';
import { UcInventoryPollService } from './services/inventory-poll.service';
import { UcSyncQueueService } from './services/sync-queue.service';
import { UcCircuitBreakerService } from './services/circuit-breaker.service';

import { MockUnicommerceService } from './mock/mock-unicommerce.service';
import { MockRatioOrderService } from './mock/mock-ratio-order.service';

import { UcAdminController } from './controllers/admin.controller';
import { UcWebhookController } from './controllers/webhook.controller';
import { UcOrderConfirmedHandler } from './webhooks/order-confirmed.handler';
import { UcOrderCancelledHandler } from './webhooks/order-cancelled.handler';
import { UnicommerceBootstrap } from './unicommerce.bootstrap';

export { UC_CRYPTO, UC_MERCHANTS, UC_OAUTH, UC_RATIO, UC_WEBHOOKS } from './tokens';
export { UcWebhookSignatureGuard, UcAdminTokenGuard } from './guards';

@Module({
  imports: [UnicommerceKyselyModule, ScheduleModule.forRoot()],
  controllers: [
    UcAdminController,
    UcWebhookController,
  ],
  providers: [
    UcCredentialsService,
    UcOauthService,
    UcOrderPushService,
    UcOrderCancelService,
    UcFulfillmentPollService,
    UcInventoryPollService,
    UcSyncQueueService,
    UcCircuitBreakerService,
    MockUnicommerceService,
    MockRatioOrderService,
    UcWebhookSignatureGuard,
    UcAdminTokenGuard,
    UcOrderConfirmedHandler,
    UcOrderCancelledHandler,
    {
      provide: UC_MOCK_UNICOMMERCE,
      useClass: MockUnicommerceService,
    },
    {
      provide: UC_MOCK_RATIO,
      useClass: MockRatioOrderService,
    },
    ...createAppProviders<UnicommerceDatabase>(
      {
        slug: 'unicommerce',
        dbToken: UC_DB_TOKEN,
        bootstrapClass: UnicommerceBootstrap,
        handlerClasses: [
          UcOrderConfirmedHandler,
          UcOrderCancelledHandler,
        ],
      },
      {
        CRYPTO: UC_CRYPTO,
        RATIO: UC_RATIO,
        MERCHANTS: UC_MERCHANTS,
        OAUTH: UC_OAUTH,
        WEBHOOKS: UC_WEBHOOKS,
      },
    ),
  ],
  exports: [],
})
export class UnicommerceModule {}
