import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MerchantIdPipe } from '../../../core/common/pipes/merchant-id.pipe';
import { ClevertapSdkService } from './sdk.service';

@Controller('clevertap/sdk')
export class ClevertapSdkController {
  constructor(private readonly sdk: ClevertapSdkService) {}

  @Get(':merchantId.js')
  @Header('Access-Control-Allow-Origin', '*')
  async serve(
    @Param('merchantId', MerchantIdPipe) merchantId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const js = await this.sdk.render(merchantId, reply);
    reply.header('content-type', 'application/javascript; charset=utf-8').send(js);
  }
}
