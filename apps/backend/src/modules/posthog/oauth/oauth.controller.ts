import { Controller, Delete, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { Env } from '../../../config/env.schema';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { type CallbackDto, callbackDtoSchema } from '../../../core/oauth/dto/callback.dto';
import type { OAuthService } from '../../../core/oauth/oauth.service';
import type { PosthogDatabase } from '../db/types';
import { POSTHOG_OAUTH } from '../tokens';

/**
 * Short-lived HttpOnly cookie name the admin SPA reads (via the
 * `GET /posthog/api/v1/oauth/install/session` endpoint below) to discover
 * the merchant id after a successful install. Replaces the previous
 * `?merchant=<id>` query string, which leaked the id into browser history,
 * Referer headers, and any 3rd-party JS loaded by the admin shell.
 *
 * The `_posthog` suffix scopes this cookie per-module: both PostHog and
 * MoEngage controllers serve from the same backend host on `path: '/'`,
 * so a shared cookie name would let the second install callback overwrite
 * the first while its admin SPA was still polling `install/session`.
 */
const INSTALL_COOKIE = 'ratio_install_merchant_posthog';
const INSTALL_COOKIE_MAX_AGE_SECONDS = 60;

/**
 * `setCookie`/`cookies` come from `@fastify/cookie`'s module-augmentation of
 * `fastify`'s `FastifyReply` and `FastifyRequest`. The plugin must be
 * registered in `configureApp`/`main.ts` before this controller can serve
 * traffic — see the TODO on `callback()` below.
 */

@Controller('posthog/api/v1/oauth')
export class PosthogOAuthController {
  constructor(
    @Inject(POSTHOG_OAUTH) private readonly oauth: OAuthService<PosthogDatabase>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Ratio redirects the merchant's browser here after they click Install on
   * the PostHog app card. The per-module OAuthService handles the token
   * exchange + bootstrap; we then issue a short-lived HttpOnly cookie that
   * the admin SPA exchanges (server-side) for the merchant id via the
   * `install/session` endpoint below, and finally redirect to the admin SPA
   * root with NO query string.
   *
   * `state` is accepted (Ratio mints and echoes its own opaque value) but
   * NOT validated — we don't sign it on the authorize side, so we have
   * nothing to verify against. Wire up state issuance + signature check
   * here when we own the authorize URL.
   */
  @Get('callback')
  async callback(
    @Query(new ZodValidationPipe(callbackDtoSchema as unknown as ZodType<CallbackDto>))
    query: CallbackDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { merchantId } = await this.oauth.handleCallback(query.code);
    const adminBase = this.config.get('RATIO_POSTHOG_ADMIN_BASE_URL' as never, {
      infer: true,
    }) as string;

    // S4: replace `?merchant=<id>` query param with a short-lived HttpOnly
    // cookie. The admin SPA reads the merchant id via the `install/session`
    // endpoint below on its first mount, then clears the cookie.
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
   * S4: Bridges the HttpOnly `ratio_install_merchant_posthog` cookie to
   * the admin SPA. The SPA can't read HttpOnly cookies via `document.cookie`,
   * so it GETs this endpoint on first mount to discover the merchant id,
   * then stores it in its own (non-shared) session and DELETEs to clear the
   * cookie. The 60s TTL is a fallback in case the SPA never calls DELETE.
   *
   * TODO admin: read /install/session on root mount.
   */
  @Get('install/session')
  installSession(@Req() req: FastifyRequest): { merchantId: string | null } {
    // `req.cookies` is populated by `@fastify/cookie`. When the plugin
    // isn't registered (test bootstraps that skip it, misconfigured prod)
    // we get `undefined` here — fall through to `null` rather than throw.
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
      .cookies;
    const merchantId = cookies?.[INSTALL_COOKIE] ?? null;
    return { merchantId };
  }

  /**
   * Clears the `ratio_install_merchant_posthog` cookie. The admin SPA SHOULD
   * call this after reading the install session, but the 60s TTL means it's
   * also fine to skip.
   */
  @Delete('install/session')
  clearInstallSession(@Res() reply: FastifyReply): void {
    reply.setCookie(INSTALL_COOKIE, '', {
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
      maxAge: 0,
    });
    reply.status(204).send();
  }
}
