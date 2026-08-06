import { Body, Controller, Get, HttpCode, Logger, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RawResponse } from '../../../core/common/decorators/raw-response.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { logInboundRequest } from '../guards';
import { UcEventLogService } from '../services/event-log.service';
import { UcAuthService } from '../services/uc-auth.service';

const authQuerySchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
const authBodySchema = authQuerySchema;

/** Both endpoints do the exact same thing — Unicommerce's spec offers both HTTP methods for the same operation. */
@Controller('unicommerce/api/v1')
@RawResponse()
export class UcAuthController {
  private readonly logger = new Logger(UcAuthController.name);

  constructor(
    private readonly auth: UcAuthService,
    private readonly eventLog: UcEventLogService,
  ) {}

  @Get('authToken')
  @HttpCode(200)
  async getAuthToken(
    @Query(new ZodValidationPipe(authQuerySchema)) query: z.infer<typeof authQuerySchema>,
    @Req() req: FastifyRequest,
  ) {
    logInboundRequest(req);
    return this.recordAndRespond(query.username, query.password);
  }

  @Post('authToken')
  @HttpCode(200)
  async postAuthToken(
    @Body(new ZodValidationPipe(authBodySchema)) body: z.infer<typeof authBodySchema>,
    @Req() req: FastifyRequest,
  ) {
    logInboundRequest(req);
    return this.recordAndRespond(body.username, body.password);
  }

  // Shared by both methods (Unicommerce's spec offers GET and POST for the
  // same operation) — pulled out rather than duplicated so the event-log
  // write only lives in one place.
  private async recordAndRespond(username: string, password: string) {
    const result = await this.auth.authenticate(username, password);
    if (result.status === 'SUCCESS') {
      // `merchantId` is only known on a successful auth (see AuthResult's
      // doc) — on INVALID_CREDENTIALS we can't attribute an event-log row to
      // any merchant without violating the table's FK, so those attempts are
      // intentionally not logged here.
      // Fix 2: the real auth result is already known here — an event-log
      // write failure must never turn a successful auth into a 500 for
      // Unicommerce, so it's logged-and-swallowed, not left to reject the
      // request handler.
      try {
        await this.eventLog.record({
          merchantId: result.merchantId,
          direction: 'inbound',
          flow: 'auth',
          reference: username,
          result: 'success',
          payload: { username },
          response: { status: result.status },
        });
      } catch (err) {
        this.logger.error({ msg: 'event-log write failed for auth success', err: err instanceof Error ? err.message : String(err) });
      }
      // Never echo `merchantId` back to Unicommerce — it's internal-only,
      // added to `AuthResult` solely so this write has it without a second lookup.
      return { status: result.status, accessToken: result.accessToken };
    }
    return result;
  }
}
