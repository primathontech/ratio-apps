import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { FastifyReply } from 'fastify';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { S3Service } from '../../../core/storage/s3.service';
import { LoyaltyMerchantTokenGuard } from '../guards';
import { type ExportSummary, ExportsService } from './exports.service';

/**
 * Customer-mirror export jobs (TRD §2/§2c). Body validation happens in
 * `ExportsService.create` via `loyaltyExportRequestSchema` — the service owns
 * the whole contract (count gates included).
 */
@Controller('loyalty/api')
@UseGuards(LoyaltyMerchantTokenGuard)
export class LoyaltyExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly s3: S3Service,
  ) {}

  @Post('exports')
  create(
    @CurrentMerchant() merchant: Merchant,
    @Body() body: unknown,
  ): Promise<ExportSummary & { rowCountEstimate: number }> {
    return this.exports.create(merchant.id, body);
  }

  @Get('exports')
  list(
    @CurrentMerchant() merchant: Merchant,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: ExportSummary[]; total: number; page: number; limit: number }> {
    return this.exports.list(merchant.id, Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('exports/:id')
  get(@CurrentMerchant() merchant: Merchant, @Param('id') id: string): Promise<ExportSummary> {
    return this.exports.get(merchant.id, id);
  }

  /** 302 to a fresh 15-minute presigned S3 URL — no proxying of CSV bytes. */
  @Get('exports/:id/download')
  async download(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const url = await this.exports.downloadUrl(merchant.id, id, this.s3);
    await reply.redirect(url, 302);
  }
}
