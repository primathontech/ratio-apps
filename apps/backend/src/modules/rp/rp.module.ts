import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { CryptoService } from '../../core/crypto/crypto.service';
import { RatioClient } from '../../core/ratio-client/ratio.client';
import { RatioOAuthHttp, type RatioOAuthCreds } from '../../core/oauth/ratio-oauth.http';
import { RpAuthController } from './auth/rp-auth.controller';
import { RpCustomersController } from './customers/customers.controller';
import { RpCustomersService } from './customers/customers.service';
import { RpDiscountsController } from './discounts/discounts.controller';
import { RpDiscountsService } from './discounts/discounts.service';
import { RpRequestGuard } from './guards';
import { RpKyselyModule } from './kysely.module';
import { RpMerchantsService } from './merchants/merchants.service';
import { RpRatioTokenProvider } from './oauth/ratio-token.provider';
import { RpOrdersController } from './orders/orders.controller';
import { RpOrdersService } from './orders/orders.service';
import { RpProductsController } from './products/products.controller';
import { RpProductsService } from './products/products.service';
import { RpRatioClientService } from './ratio-client/ratio-client.service';
import { RpRefundsController } from './refunds/refunds.controller';
import { RpRefundsService } from './refunds/refunds.service';
import { RpClientService } from './rp-client/rp-client.service';
import { RP_CRYPTO, RP_RATIO_CLIENT, RP_RATIO_OAUTH_CREDS, RP_RATIO_OAUTH_HTTP } from './tokens';
import { RpTransformerService } from './transformer/transformer.service';

@Module({
  imports: [RpKyselyModule],
  controllers: [
    RpAuthController,
    RpOrdersController,
    RpRefundsController,
    RpCustomersController,
    RpProductsController,
    RpDiscountsController,
  ],
  providers: [
    RpMerchantsService,
    RpClientService,
    RpTransformerService,
    RpRatioTokenProvider,
    RpRatioClientService,
    RpRequestGuard,
    RpOrdersService,
    RpRefundsService,
    RpCustomersService,
    RpProductsService,
    RpDiscountsService,
    {
      provide: RP_CRYPTO,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): CryptoService => {
        const key = config.get('RATIO_RP_DATA_ENCRYPTION_KEY' as never, { infer: true }) as string;
        return new CryptoService(Buffer.from(key, 'base64'));
      },
    },
    {
      provide: RP_RATIO_OAUTH_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthHttp =>
        new RatioOAuthHttp(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: RP_RATIO_OAUTH_CREDS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioOAuthCreds => ({
        clientId: config.get('RATIO_RP_CLIENT_ID' as never, { infer: true }) as string,
        clientSecret: config.get('RATIO_RP_CLIENT_SECRET' as never, { infer: true }) as string,
      }),
    },
    {
      provide: RP_RATIO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioClient =>
        new RatioClient(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
  ],
})
export class RpModule {}
