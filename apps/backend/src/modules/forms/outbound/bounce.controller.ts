import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { FormsBounceService } from './bounce.service';

/**
 * Inbound SES bounce notifications delivered via AWS SNS (PRD AC9). Necessarily
 * UNAUTHENTICATED — SNS posts here — so security is the SNS signature check in
 * FormsBounceService, not a guard. SNS delivers JSON as `text/plain`, so we read
 * the captured raw body (`rawBody`, enabled globally) and fall back to the parsed
 * body; the service rebuilds the canonical string from fields either way.
 */
@Controller('forms/public/v1/ses-bounce')
export class FormsBounceController {
  constructor(private readonly bounce: FormsBounceService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: FastifyRequest & { rawBody?: Buffer | string },
  ): Promise<{ ok: true }> {
    return this.bounce.ingest(req.rawBody ?? req.body);
  }
}
