import { Controller, Get, Header, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MerchantIdPipe } from '../../../core/common/pipes/merchant-id.pipe';
import { FormsSdkService } from './sdk.service';

@Controller('forms/sdk')
export class FormsSdkController {
  constructor(private readonly sdk: FormsSdkService) {}

  /** Browser-facing SDK endpoint; `MerchantIdPipe` validates `:merchantId` pre-DB (Finding #4: path-traversal / control-char / length guard); Cache-Control set on the success path, never route-level (would cache 404s). */
  @Get(':merchantId.js')
  @Header('Access-Control-Allow-Origin', '*')
  async serve(
    @Param('merchantId', MerchantIdPipe) merchantId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Reconstruct the fetch origin for the absolute API base; `req.protocol` honors X-Forwarded-Proto only for trusted proxies (main.ts trustProxy), so it can't be spoofed.
    const origin = `${req.protocol}://${req.headers.host ?? 'localhost'}`;
    const js = await this.sdk.render(merchantId, reply, origin);
    reply.header('content-type', 'application/javascript; charset=utf-8').send(js);
  }
}
