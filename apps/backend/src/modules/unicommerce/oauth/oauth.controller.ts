import { Controller, Delete, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { Env } from '../../../config/env.schema';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { type CallbackDto, callbackDtoSchema } from '../../../core/oauth/dto/callback.dto';
import type { OAuthService } from '../../../core/oauth/oauth.service';
import type { UnicommerceDatabase } from '../db/types';
import { UcCredentialsService } from '../services/credentials.service';
import { UC_OAUTH } from '../tokens';

/**
 * Short-lived HttpOnly cookie name the admin SPA reads (via the
 * `GET /unicommerce/api/v1/oauth/install/session` endpoint below) to discover
 * the merchant id after a successful install. Same S4 pattern as every other
 * module in this codebase (see meta/oauth/oauth.controller.ts) — a
 * `?merchant=<id>` query param would leak the id into browser history,
 * Referer headers, and any 3rd-party JS loaded by the admin shell.
 *
 * The `_unicommerce` suffix scopes this cookie per-module: every vendor
 * controller serves from the same backend host on `path: '/'`, so a shared
 * cookie name would let a second install callback overwrite the first while
 * its admin SPA was still polling `install/session`.
 */
const INSTALL_COOKIE = 'ratio_install_merchant_unicommerce';
const INSTALL_COOKIE_MAX_AGE_SECONDS = 60;

/**
 * `setCookie`/`cookies` come from `@fastify/cookie`'s module-augmentation of
 * `fastify`'s `FastifyReply` and `FastifyRequest`, registered globally in
 * `configureApp` (src/config/configure-app.ts) — no per-module setup needed.
 *
 * This controller was missing entirely until now: every other vendor module
 * (google/meta/moengage/posthog/wizzy) has its own `<slug>/oauth/oauth.
 * controller.ts` exposing this same 3-route shape, but unicommerce never got
 * one across the original 16-task build — meaning a merchant could never
 * actually complete a REAL Ratio-marketplace install for this app, even with
 * a registered OAuth client, since nothing ever called `OAuthService.
 * handleCallback()`. This fixes that gap, mirroring meta's controller exactly.
 */
@Controller('unicommerce/api/v1/oauth')
export class UcOAuthController {
  constructor(
    @Inject(UC_OAUTH) private readonly oauth: OAuthService<UnicommerceDatabase>,
    private readonly config: ConfigService<Env, true>,
    private readonly credentials: UcCredentialsService,
  ) {}

  /**
   * Ratio redirects the merchant's browser here after they click Install on
   * the Unicommerce app card. The per-module OAuthService handles the token
   * exchange + bootstrap (UnicommerceBootstrap.run, currently a no-op); we
   * then issue a short-lived HttpOnly cookie that the admin SPA exchanges
   * (server-side) for the merchant id via the `install/session` endpoint
   * below, and finally redirect to the admin SPA root with NO query string.
   *
   * `state` is accepted (Ratio mints and echoes its own opaque value) but
   * NOT validated — same documented gap as every sibling module's callback;
   * we don't sign it on the authorize side, so we have nothing to verify
   * against. Wire up state issuance + signature check here when we own the
   * authorize URL.
   */
  @Get('callback')
  async callback(
    @Query(new ZodValidationPipe(callbackDtoSchema as unknown as ZodType<CallbackDto>))
    query: CallbackDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { merchantId, storeDomain } = await this.oauth.handleCallback(query.code);
    // Persist the merchant's real storefront domain (from the token response's
    // `merchantStoreId`, or the access-token JWT) so the catalog pull builds
    // product URLs per-merchant instead of from the single global env var.
    if (storeDomain) {
      await this.credentials.setStoreDomain(merchantId, storeDomain);
    }
    const adminBase = this.config.get('RATIO_UNICOMMERCE_ADMIN_BASE_URL' as never, {
      infer: true,
    }) as string;

    reply.setCookie(INSTALL_COOKIE, merchantId, {
      httpOnly: true,
      // In development (HTTP localhost) the browser drops Secure cookies, so
      // the install-session round trip would break. In every other env we
      // require HTTPS and keep Secure on.
      secure: process.env.NODE_ENV !== 'development',
      // SameSite=None is required for cross-site cookie delivery — admin SPAs
      // on `*.cloudfront.net` fetch backend on `*.primathontech.co.in`. `Lax`
      // would drop the cookie on those cross-site requests. `None` mandates
      // Secure (already true in non-dev above).
      sameSite: 'none',
      path: '/',
      maxAge: INSTALL_COOKIE_MAX_AGE_SECONDS,
      signed: false, // routing info, not a secret — signature would just add weight
    });
    await reply.redirect(`${adminBase}/`, 302);
  }

  /**
   * Bridges the HttpOnly `ratio_install_merchant_unicommerce` cookie to the
   * admin SPA. The SPA can't read HttpOnly cookies via `document.cookie`, so
   * it GETs this endpoint on first mount to discover the merchant id, then
   * stores it in its own (non-shared) session and DELETEs to clear the
   * cookie. The 60s TTL is a fallback in case the SPA never calls DELETE.
   */
  @Get('install/session')
  installSession(@Req() req: FastifyRequest): { merchantId: string | null } {
    // `req.cookies` is populated by `@fastify/cookie`. When the plugin isn't
    // registered (test bootstraps that skip it, misconfigured prod) we get
    // `undefined` here — fall through to `null` rather than throw.
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
      .cookies;
    const merchantId = cookies?.[INSTALL_COOKIE] ?? null;
    return { merchantId };
  }

  /**
   * Clears the `ratio_install_merchant_unicommerce` cookie. The admin SPA
   * SHOULD call this after reading the install session, but the 60s TTL
   * means it's also fine to skip.
   */
  @Delete('install/session')
  clearInstallSession(@Res() reply: FastifyReply): void {
    reply.setCookie(INSTALL_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'none',
      path: '/',
      maxAge: 0,
    });
    reply.status(204).send();
  }
}
