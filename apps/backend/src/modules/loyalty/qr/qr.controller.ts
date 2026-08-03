import { Body, Controller, Get, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { FastifyReply } from 'fastify';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { LoyaltyMerchantTokenGuard } from '../guards';
import { QrService } from './qr.service';

const DEFAULT_POSTER_SIZE = 600;

/**
 * Merchant-token-guarded QR admin routes. The poster endpoints stream binary
 * bodies via `@Res()` (`reply.send`) to bypass the global ResponseInterceptor
 * envelope — a PNG/PDF wrapped in `{status_code, data}` is garbage.
 */
@Controller('loyalty/api/qr-codes')
@UseGuards(LoyaltyMerchantTokenGuard)
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Get()
  list(@CurrentMerchant() merchant: Merchant) {
    return this.qr.list(merchant.id);
  }

  @Post()
  create(@CurrentMerchant() merchant: Merchant, @Body() body: unknown) {
    return this.qr.create(merchant.id, body);
  }

  @Get(':id')
  detail(@CurrentMerchant() merchant: Merchant, @Param('id') id: string) {
    return this.qr.detail(merchant.id, id);
  }

  @Put(':id')
  update(@CurrentMerchant() merchant: Merchant, @Param('id') id: string, @Body() body: unknown) {
    return this.qr.update(merchant.id, id, body);
  }

  @Post(':id/status')
  setStatus(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Body() body: { status?: unknown } | undefined,
  ) {
    return this.qr.setStatus(merchant.id, id, body?.status);
  }

  @Get(':id/scans')
  scans(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.qr.scans(merchant.id, id, Number(page) || 1, Number(limit) || 20);
  }

  @Get(':id/poster.png')
  async posterPng(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
    @Query('size') size?: string,
  ): Promise<void> {
    const parsedSize = size === undefined ? DEFAULT_POSTER_SIZE : Number(size);
    const png = await this.qr.posterPng(merchant.id, id, parsedSize);
    reply
      .header('content-type', 'image/png')
      .header('content-disposition', `attachment; filename="loyalty-qr-${id}-${parsedSize}.png"`)
      .send(png);
  }

  @Get(':id/poster.pdf')
  async posterPdf(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pdf = await this.qr.posterPdf(merchant.id, id);
    reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="loyalty-qr-${id}.pdf"`)
      .send(pdf);
  }
}
