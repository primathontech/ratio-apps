import { Controller, Get, Header, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MerchantIdPipe } from '../../../core/common/pipes/merchant-id.pipe';
import { MetaSdkService } from './sdk.service';

@Controller('meta/sdk')
export class MetaSdkController {
  constructor(private readonly sdk: MetaSdkService) {}

  /**
   * Storefront-facing endpoint to get event mappings.
   * GET /meta/sdk/:merchantId/events returns the configured event map so the
   * storefront can automatically fire events without manual instrumentation.
   */
  @Get(':merchantId/events')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Content-Type', 'application/json')
  async getEventMap(@Param('merchantId', MerchantIdPipe) merchantId: string) {
    return this.sdk.getEventMap(merchantId);
  }

  /**
   * Browser-facing endpoint. The merchant pastes
   *   <script src="https://.../meta/sdk/<merchantId>.js" defer></script>
   * into their storefront. `merchantId` here is the Ratio merchant id directly.
   *
   * `MerchantIdPipe` validates `:merchantId` against `^[A-Za-z0-9_-]{1,128}$`
   * before any DB lookup (Finding #4) — guards against path-traversal,
   * control characters, and pathological length attacks.
   *
   * Bypasses the global ResponseInterceptor by sending raw JS via reply.
   *
   * NOTE: `Cache-Control` is intentionally NOT a route-level `@Header()`
   * here — that would cache 404 (MERCHANT_INACTIVE / CONFIG_INCOMPLETE)
   * and 503 (PIXEL_MISSING) responses for 5 minutes, poisoning CDNs
   * during installation races. The header is set on the success path
   * inside `MetaSdkService.render`, after every error branch has
   * already thrown.
   */
  @Get(':merchantId.js')
  @Header('Access-Control-Allow-Origin', '*')
  async serve(
    @Param('merchantId', MerchantIdPipe) merchantId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Public origin this SDK was served from — used to build an ABSOLUTE
    // capiPath so Call B reaches this backend, not the storefront. Behind
    // nginx, x-forwarded-proto carries the real https scheme; the Host header
    // carries the public domain (meta-g4.primathontech.co.in).
    const fwdProto = req.headers['x-forwarded-proto'];
    const proto = (typeof fwdProto === 'string' ? fwdProto.split(',')[0]?.trim() : req.protocol) || 'https';
    const host = req.headers.host ?? req.hostname;
    const baseUrl = `${proto}://${host}`;
    const js = await this.sdk.render(merchantId, reply, baseUrl);
    reply.header('content-type', 'application/javascript; charset=utf-8').send(js);
  }
}
