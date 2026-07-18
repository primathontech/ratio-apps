import { Controller, Get, HttpException, Inject, Logger, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import {
  ratioOauthTokenResponseSchema,
} from '@ratio-app/shared/schemas/merchant';
import type { Env } from '../../../config/env.schema';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import { extractMerchantIdFromJwt } from '../../../core/oauth/oauth.service';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import { RpMerchantsService } from '../merchants/merchants.service';
import { RP_CRYPTO, RP_RATIO_CLIENT } from '../tokens';

function extractDomainFromJwt(token: string): string | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const payload = Buffer.from(parts[1]!, 'base64').toString('utf-8');
    const decoded = JSON.parse(payload) as Record<string, unknown>;
    const domain = decoded.domain ?? decoded.store_url ?? decoded.store;
    return typeof domain === 'string' ? domain : undefined;
  } catch {
    return undefined;
  }
}

@Controller('rp/auth')
export class RpAuthController {
  private readonly logger = new Logger(`RP:${RpAuthController.name}`);

  constructor(
    private readonly merchants: RpMerchantsService,
    @Inject(RP_CRYPTO) private readonly crypto: CryptoService,
    @Inject(RP_RATIO_CLIENT) private readonly ratio: RatioClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Ratio redirects here after the merchant approves OAuth on the app store.
   * Exchanges the code for tokens, stores the merchant, and calls RP register.
   */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!code) throw new HttpException('missing code', 400);

    const clientId = this.config.get('RATIO_RP_CLIENT_ID' as never, { infer: true }) as string;
    const clientSecret = this.config.get('RATIO_RP_CLIENT_SECRET' as never, { infer: true }) as string;
    const callbackUrl = this.config.get('RATIO_RP_CALLBACK_URL' as never, { infer: true }) as string;

    const tokenRes = await this.ratio.request(
      '/api/v1/oauth/token',
      ratioOauthTokenResponseSchema,
      {
        method: 'POST',
        body: {
          grant_type: 'authorization_code',
          code,
          clientId,
          clientSecret,
          redirectUri: callbackUrl,
        },
      },
    );

    const merchantId =
      tokenRes.merchant_id ?? extractMerchantIdFromJwt(tokenRes.access_token);
    if (!merchantId) {
      throw new HttpException('no merchant_id in token response', 502);
    }

    const domain =
      (tokenRes as Record<string, unknown>).domain as string | undefined ??
      extractDomainFromJwt(tokenRes.access_token) ??
      merchantId;

    const expiresAt = new Date(Date.now() + Math.max(0, tokenRes.expires_in - 60) * 1000);

    await this.merchants.upsert({
      merchantId,
      domain,
      accessTokenEnc: this.crypto.encrypt(tokenRes.access_token),
      refreshTokenEnc: this.crypto.encrypt(tokenRes.refresh_token),
      expiresAt,
    });

    const adminBase = this.config.get('RATIO_RP_ADMIN_BASE_URL' as never, { infer: true }) as string;
    await reply.redirect(adminBase, 302);
  }
}
