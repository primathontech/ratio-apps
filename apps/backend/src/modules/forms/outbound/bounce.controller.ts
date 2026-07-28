import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { FormsBounceService } from './bounce.service';

/** Inbound SES bounce via SNS (PRD AC9) — necessarily UNAUTHENTICATED, so security is the SNS signature check in FormsBounceService; reads captured rawBody (SNS sends JSON as text/plain), falling back to the parsed body. */
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
