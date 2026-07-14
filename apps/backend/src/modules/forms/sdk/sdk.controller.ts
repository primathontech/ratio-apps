import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MerchantIdPipe } from '../../../core/common/pipes/merchant-id.pipe';
import { FormsSdkService } from './sdk.service';

@Controller('forms/sdk')
export class FormsSdkController {
  constructor(private readonly sdk: FormsSdkService) {}

  /**
   * Browser-facing endpoint. The merchant pastes
   *   <script src="https://.../forms/sdk/<merchantId>.js" defer></script>
   * into their storefront. `merchantId` here is the Ratio merchant id directly.
   *
   * `MerchantIdPipe` validates `:merchantId` against `^[A-Za-z0-9_-]{1,128}$`
   * before any DB lookup (Finding #4) — guards against path-traversal,
   * control characters, and pathological length attacks.
   *
   * Bypasses the global ResponseInterceptor by sending raw JS via reply.
   *
   * NOTE: `Cache-Control` is intentionally NOT a route-level `@Header()`
   * here — that would cache 404 (MERCHANT_INACTIVE) responses for
   * 5 minutes, poisoning CDNs during installation races. The header is
   * set on the success path inside `FormsSdkService.render`, after the
   * error branch has already thrown.
   */
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
