import { Controller, Delete, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { Env } from '../../../config/env.schema';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { type CallbackDto, callbackDtoSchema } from '../../../core/oauth/dto/callback.dto';
import type { OAuthService } from '../../../core/oauth/oauth.service';
import type { FormsDatabase } from '../db/types';
import { FORMS_OAUTH } from '../tokens';

/** Short-lived HttpOnly cookie carrying the merchant id post-install (read via install/session); avoids leaking the id in the URL, and the `_forms` suffix scopes it per-module so parallel installs can't clobber each other. */
const INSTALL_COOKIE = 'ratio_install_merchant_forms';
const INSTALL_COOKIE_MAX_AGE_SECONDS = 60;

// setCookie/cookies come from @fastify/cookie augmentation; the plugin must be registered in configureApp/main.ts before this controller serves traffic.

@Controller('forms/api/v1/oauth')
export class FormsOAuthController {
  constructor(
    @Inject(FORMS_OAUTH) private readonly oauth: OAuthService<FormsDatabase>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** OAuth install callback: OAuthService does token exchange, then we set a short-lived HttpOnly cookie the SPA exchanges via install/session before redirecting to the SPA root. `state` is accepted but NOT validated — we don't sign the authorize URL yet; add issuance + signature check when we own it. */
  @Get('callback')
  async callback(
    @Query(new ZodValidationPipe(callbackDtoSchema as unknown as ZodType<CallbackDto>))
    query: CallbackDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { merchantId } = await this.oauth.handleCallback(query.code);
    const adminBase = this.config.get('RATIO_FORMS_ADMIN_BASE_URL' as never, {
      infer: true,
    }) as string;

    // S4: swap the `?merchant=<id>` param for a short-lived HttpOnly cookie the SPA reads via install/session.
    reply.setCookie(INSTALL_COOKIE, merchantId, {
      httpOnly: true,
      // Dev is HTTP localhost where browsers drop Secure cookies; keep Secure everywhere else.
      secure: process.env.NODE_ENV !== 'development',
      // SameSite=None: admin SPA and backend are cross-site, so Lax would drop the cookie; None mandates Secure (set above).
      sameSite: 'none',
      path: '/',
      maxAge: INSTALL_COOKIE_MAX_AGE_SECONDS,
      signed: false, // routing info, not a secret — signature would just add weight
    });
    await reply.redirect(`${adminBase}/`, 302);
  }

  /** S4: bridges the HttpOnly install cookie to the SPA (which can't read HttpOnly via document.cookie); the 60s TTL is the fallback if the SPA never DELETEs. */
  @Get('install/session')
  installSession(@Req() req: FastifyRequest): { merchantId: string | null } {
    // `req.cookies` needs @fastify/cookie; fall through to null when the plugin isn't registered rather than throw.
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
      .cookies;
    const merchantId = cookies?.[INSTALL_COOKIE] ?? null;
    return { merchantId };
  }

  /** Clears the install cookie; optional for the SPA since the 60s TTL also expires it. */
  @Delete('install/session')
  clearInstallSession(@Res() reply: FastifyReply): void {
    // Secure/SameSite must match the attributes callback() set or the browser won't match the clear.
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
