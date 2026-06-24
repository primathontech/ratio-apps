import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { FastifyReply } from 'fastify';
import type { Env } from '../../../config/env.schema';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
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
    // The admin opens this flow in a POPUP and stays inside the Ratio dashboard
    // iframe — so instead of navigating anywhere, we hand the popup a tiny page
    // that signals the opener (the admin SPA) via postMessage and closes itself.
    // The merchant never leaves the dashboard. If there's no opener (popup was
    // blocked → opened top-level), we fall back to the old redirect.
    reply.header('content-type', 'text/html; charset=utf-8');
    await reply.send(renderOAuthClosePage(adminBase));
  }
}

/**
 * The popup-close page served to the OAuth callback. Posts `{ source:
 * 'ratio-google-oauth', connected: true }` to the opener (the admin SPA, which
 * listens for it and refetches config) then closes. Falls back to a redirect
 * when opened without an opener (popup blocked / top-level navigation).
 *
 * `targetOrigin` is `'*'` deliberately: the Ratio dashboard embeds the admin
 * under a host we can't predict, so pinning the target origin would cause the
 * browser to silently drop the message. The opener validates the message by its
 * `source` field instead, and the payload (a "connected" boolean) is not
 * sensitive — so a wildcard target is safe here.
 */
function renderOAuthClosePage(adminBase: string): string {
  const fallbackUrl = JSON.stringify(`${adminBase}/config?connected=1`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Google connected</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem">Google connected — you can close this window.
<script>
(function () {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ source: 'ratio-google-oauth', connected: true }, '*');
      window.close();
      return;
    }
  } catch (e) {}
  location.replace(${fallbackUrl});
})();
</script></body></html>`;
}
