import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../../config/env.schema';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import {
  CredentialsAlreadyExistError,
  UcCredentialsService,
} from '../services/credentials.service';

const generateSchema = z.object({
  merchantId: z.string().min(1),
  ucUsername: z.string().min(1),
});
type GenerateRequest = z.infer<typeof generateSchema>;

const regenerateSchema = z.object({ merchantId: z.string().min(1) });
type RegenerateRequest = z.infer<typeof regenerateSchema>;

/**
 * Admin-facing endpoints — called by the Ratio Admin "Apps > Unicommerce"
 * connect screen. Guarded the same way every other admin-surface endpoint in
 * this codebase is (session/admin auth is applied at the gateway level,
 * matching the existing admin.controller.ts pattern in other modules — no
 * additional guard class needed here; confirmed with the user during Task 2).
 */
@Controller('unicommerce/admin')
export class UcConnectController {
  constructor(
    private readonly credentials: UcCredentialsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private buildBaseUrl(): string {
    const publicBaseUrl = this.config.get('RATIO_UNICOMMERCE_PUBLIC_BASE_URL' as never, {
      infer: true,
    }) as string | undefined;
    if (!publicBaseUrl) {
      // Fail loudly rather than hand a merchant a placeholder URL that
      // points nowhere real — that's the exact bug this replaces (found
      // live: the base URL shown was hardcoded to a domain that didn't
      // resolve to anything, so a merchant could never actually connect).
      throw new InternalServerErrorException(
        'RATIO_UNICOMMERCE_PUBLIC_BASE_URL is not configured — cannot build a working base URL for Unicommerce to call',
      );
    }
    return `${publicBaseUrl.replace(/\/$/, '')}/unicommerce/api/v1`;
  }

  @Post('credentials/generate')
  async generate(
    @Body(new ZodValidationPipe(generateSchema)) body: GenerateRequest,
  ): Promise<{ username: string; password: string; baseUrl: string }> {
    try {
      const { username, password } = await this.credentials.generate(
        body.merchantId,
        body.ucUsername,
      );
      return { username, password, baseUrl: this.buildBaseUrl() };
    } catch (err) {
      if (err instanceof CredentialsAlreadyExistError) {
        // A clear 409, not a bare 500 — found live when a stale frontend
        // build called generate() for a merchant that already had
        // credentials on file (from a prior generate/regenerate).
        throw new ConflictException({
          message: 'credentials already exist for this merchant',
          error_code: 'CREDENTIALS_ALREADY_EXIST',
          hint: 'fetch the existing credentials via GET /unicommerce/admin/credentials, or call regenerate to replace them',
        });
      }
      throw err;
    }
  }

  /**
   * Re-displays the currently-active credentials for a merchant that has
   * already generated them, so reopening the admin doesn't look like a blank
   * first-time state. Possible only because the password is stored as
   * reversible ciphertext (migration 0011), not a comparison hash.
   */
  @Get('credentials')
  async getCredentials(@Query('merchantId') merchantId: string): Promise<{
    username: string;
    password: string;
    ucUsername: string;
    baseUrl: string;
    lastInboundCallAt: Date | null;
  } | null> {
    if (!merchantId) throw new BadRequestException('merchantId is required');
    const existing = await this.credentials.getCredentials(merchantId);
    if (!existing) return null;
    return { ...existing, baseUrl: this.buildBaseUrl() };
  }

  /**
   * Mints a brand-new Ratio username/password for a merchant that already
   * has credentials on file. The frontend is responsible for confirming this
   * with the merchant first (destructive: the old pair stops working the
   * instant this returns).
   */
  @Post('credentials/regenerate')
  async regenerate(
    @Body(new ZodValidationPipe(regenerateSchema)) body: RegenerateRequest,
  ): Promise<{ username: string; password: string; baseUrl: string }> {
    const result = await this.credentials.regenerate(body.merchantId);
    if (!result) {
      throw new NotFoundException('no existing credentials to regenerate for this merchant');
    }
    return { ...result, baseUrl: this.buildBaseUrl() };
  }
}
