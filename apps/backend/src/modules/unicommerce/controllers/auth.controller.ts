import { Body, Controller, Get, HttpCode, Logger, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
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
@ApiTags('unicommerce')
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
  @ApiOperation({
    summary: 'Authenticate (GET variant)',
    description:
      'Called BY Unicommerce at connect time to exchange its Ratio-issued username/password for a 48h access token. ' +
      'No `apikey` header — this is the only inbound endpoint that does not require one. ' +
      'The returned `accessToken` is echoed back by Unicommerce as the `apikey` header on every other inbound call.',
  })
  @ApiQuery({
    name: 'username',
    required: true,
    description: 'Ratio-issued Unicommerce channel username (e.g. `ratio-<hex>`).',
    example: 'ratio-59d590d97ffd',
  })
  @ApiQuery({
    name: 'password',
    required: true,
    description: 'Ratio-issued password for the channel username above.',
    example: '7f3KpQ!x9zWc',
  })
  @ApiResponse({
    status: 200,
    description:
      '`SUCCESS` carries the `accessToken` (TTL ~48h) to send back as the `apikey` header on all other calls; ' +
      '`INVALID_CREDENTIALS` when the username/password pair is wrong (the attempt is not event-logged).',
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['SUCCESS'] },
            accessToken: {
              type: 'string',
              example: 'pX7vK2mQ9nL4wR8tY5bH1cJ3dF6gS0zA7eU2iM4k',
              description:
                'Opaque token, base64url; TTL ~48h. Send as the `apikey` header on every other inbound call.',
            },
          },
          required: ['status', 'accessToken'],
        },
        {
          type: 'object',
          properties: { status: { type: 'string', enum: ['INVALID_CREDENTIALS'] } },
          required: ['status'],
        },
      ],
    },
  })
  async getAuthToken(
    @Query(new ZodValidationPipe(authQuerySchema)) query: z.infer<typeof authQuerySchema>,
    @Req() req: FastifyRequest,
  ) {
    logInboundRequest(req);
    return this.recordAndRespond(query.username, query.password);
  }

  @Post('authToken')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Authenticate (POST variant)',
    description:
      'Called BY Unicommerce at connect time to exchange its Ratio-issued username/password for a 48h access token. ' +
      "Identical to the GET variant — Unicommerce's spec offers both HTTP methods for the same operation. " +
      'No `apikey` header — this is the only inbound endpoint that does not require one.',
  })
  @ApiBody({
    required: true,
    description: 'Ratio-issued Unicommerce channel credentials.',
    schema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          example: 'ratio-59d590d97ffd',
          description: 'Ratio-issued channel username (e.g. `ratio-<hex>`).',
        },
        password: {
          type: 'string',
          example: '7f3KpQ!x9zWc',
          description: 'Ratio-issued password for the channel username above.',
        },
      },
      required: ['username', 'password'],
    },
  })
  @ApiResponse({
    status: 200,
    description:
      '`SUCCESS` carries the `accessToken` (TTL ~48h) to send back as the `apikey` header on all other calls; ' +
      '`INVALID_CREDENTIALS` when the username/password pair is wrong (the attempt is not event-logged).',
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['SUCCESS'] },
            accessToken: {
              type: 'string',
              example: 'pX7vK2mQ9nL4wR8tY5bH1cJ3dF6gS0zA7eU2iM4k',
              description:
                'Opaque token, base64url; TTL ~48h. Send as the `apikey` header on every other inbound call.',
            },
          },
          required: ['status', 'accessToken'],
        },
        {
          type: 'object',
          properties: { status: { type: 'string', enum: ['INVALID_CREDENTIALS'] } },
          required: ['status'],
        },
      ],
    },
  })
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
        this.logger.error({
          msg: 'event-log write failed for auth success',
          err: err instanceof Error ? err.message : String(err),
        });
      }
      // Never echo `merchantId` back to Unicommerce — it's internal-only,
      // added to `AuthResult` solely so this write has it without a second lookup.
      return { status: result.status, accessToken: result.accessToken };
    }
    return result;
  }
}
