import { Controller, Get, Inject, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import type { Env } from '../../../config/env.schema';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { GoogleMerchantTokenGuard } from '../guards';
import { GoogleAuthService } from './google-auth.service';

/**
 * Google account connection (distinct from the Ratio install OAuth in
 * `oauth/oauth.controller.ts`). `connect` is merchant-guarded and returns the
 * Google consent URL as JSON (the SPA calls it with its Bearer header, then
 * navigates the browser to that URL); `callback` is public (Google redirects
 * the browser here) and exchanges the code, then bounces back to the admin.
 */
@Controller('google/api/v1/google-oauth')
export class GoogleConnectController {
  constructor(
    private readonly auth: GoogleAuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('connect')
  @UseGuards(GoogleMerchantTokenGuard)
  connect(@CurrentMerchant() merchant: Merchant): { url: string } {
    return { url: this.auth.buildAuthUrl(merchant.id) };
  }

  /**
   * Disconnect the Google account: clears stored OAuth credentials and reverts
   * the config to manual. Merchant-guarded; the SPA calls it with its Bearer
   * header, then refetches the config to render the not-connected (manual) state.
   */
  @Post('disconnect')
  @UseGuards(GoogleMerchantTokenGuard)
  async disconnect(@CurrentMerchant() merchant: Merchant): Promise<{ disconnected: true }> {
    await this.auth.disconnect(merchant.id);
    return { disconnected: true };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // `state` carries the Ratio merchant id we minted in `connect`.
    await this.auth.handleCallback(code, state);
    const adminBase = this.config.get('RATIO_GOOGLE_ADMIN_BASE_URL' as never, {
      infer: true,
    }) as string;
    await reply.redirect(`${adminBase}/config?connected=1`, 302);
  }
}
