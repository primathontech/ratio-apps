import { Controller, Delete, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { Env } from '../../../config/env.schema';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { type CallbackDto, callbackDtoSchema } from '../../../core/oauth/dto/callback.dto';
import type { OAuthService } from '../../../core/oauth/oauth.service';
import type { WizzyDatabase } from '../db/types';
import { WIZZY_OAUTH } from '../tokens';

/**
 * Short-lived HttpOnly cookie name the admin SPA reads to discover the
 * merchant id after a successful Wizzy install.
 */
const INSTALL_COOKIE = 'ratio_install_merchant_wizzy';
const INSTALL_COOKIE_MAX_AGE_SECONDS = 60;

@Controller('wizzy/api/v1/oauth')
export class WizzyOAuthController {
  constructor(
    @Inject(WIZZY_OAUTH) private readonly oauth: OAuthService<WizzyDatabase>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Ratio redirects the merchant's browser here after they click Install on
   * the Wizzy app card. The per-module OAuthService handles the token
   * exchange + bootstrap; we then issue a short-lived HttpOnly cookie and
   * redirect to the admin SPA root.
   */
  @Get('callback')
  async callback(
    @Query(new ZodValidationPipe(callbackDtoSchema as unknown as ZodType<CallbackDto>))
    query: CallbackDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { merchantId } = await this.oauth.handleCallback(query.code);
    const adminBase = this.config.get('RATIO_WIZZY_ADMIN_BASE_URL' as never, {
      infer: true,
    }) as string;

    reply.setCookie(INSTALL_COOKIE, merchantId, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'none',
      path: '/',
      maxAge: INSTALL_COOKIE_MAX_AGE_SECONDS,
      signed: false,
    });
    await reply.redirect(`${adminBase}/`, 302);
  }

  @Get('install/session')
  installSession(@Req() req: FastifyRequest): { merchantId: string | null } {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
      .cookies;
    const merchantId = cookies?.[INSTALL_COOKIE] ?? null;
    return { merchantId };
  }

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
