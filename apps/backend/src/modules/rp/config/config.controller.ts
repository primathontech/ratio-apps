import { BadRequestException, Body, Controller, Get, Header, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RpRequestGuard, type RpRequest } from '../guards';
import { RpMerchantsService } from '../merchants/merchants.service';

/**
 * Per-merchant Return Prime storefront config — the OS/headless equivalent of RP's Shopify
 * "Account Page" snippet enable/disable. RP has no theme to inject for OS stores, so instead:
 *  - RP toggles the flag here (POST /rp/config, authenticated) on enable/disable, and
 *  - the headless storefront reads it (GET /rp/config?shop=…, public) to show/hide the
 *    Return/Exchange entry point.
 */
@Controller('rp')
export class RpConfigController {
  constructor(private readonly merchants: RpMerchantsService) {}

  /**
   * Public — the storefront needs this without an RP token. Wildcard CORS (bypassing the
   * app's ALLOWED_ORIGINS allowlist): the response carries no secret, just a boolean, and
   * the rp-sdk script tag must work from ANY merchant storefront without a per-merchant
   * allowlist entry or backend proxy.
   */
  @Get('config')
  @Header('Access-Control-Allow-Origin', '*')
  async getConfig(@Query('shop') shop?: string): Promise<{ returnExchangeEnabled: boolean }> {
    if (!shop) throw new BadRequestException('shop is required');
    const merchant = await this.merchants.findByDomain(shop);
    // Fail-open when the merchant is unknown, matching RP's scriptVisibility default (true).
    return { returnExchangeEnabled: merchant ? Boolean(merchant.returnExchangeEnabled) : true };
  }

  /** Guarded — only the RP backend (with its internal token) may change the flag. */
  @Post('config')
  @UseGuards(RpRequestGuard)
  async setConfig(
    @Req() req: RpRequest,
    @Body() body: { returnExchangeEnabled?: boolean },
  ): Promise<{ returnExchangeEnabled: boolean }> {
    const enabled = Boolean(body?.returnExchangeEnabled);
    await this.merchants.setReturnExchangeEnabled(req.rpMerchant.merchantId, enabled);
    return { returnExchangeEnabled: enabled };
  }
}
