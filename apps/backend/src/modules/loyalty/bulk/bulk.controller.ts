import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { FastifyReply } from 'fastify';
import { type ZodType, z } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { LoyaltyMerchantTokenGuard } from '../guards';
import { type BulkOperationSummary, type BulkRowInput, BulkService } from './bulk.service';

/** POST /loyalty/api/bulk-operations body (TRD §2). */
const createBulkOperationSchema = z.object({
  type: z.enum(['credit', 'debit']),
  fileName: z.string().max(255).optional(),
  /** Advisory only — authoritative totals come from ingested chunks. */
  totalRows: z.number().int().nonnegative().optional(),
});
type CreateBulkOperationDto = z.infer<typeof createBulkOperationSchema>;

/** POST /loyalty/api/bulk-operations/:id/rows body — chunked CSV rows. */
const ingestRowsSchema = z.object({
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().positive(),
        phone: z.string(),
        points: z.number(),
        reason: z.string().max(500).optional(),
      }),
    )
    .min(1),
});
type IngestRowsDto = z.infer<typeof ingestRowsSchema>;

/**
 * Bulk credit/debit CSV operations — create → chunked row ingest → confirm →
 * progress + errors CSV. All routes merchant-token guarded (TRD §2).
 */
@Controller('loyalty/api')
@UseGuards(LoyaltyMerchantTokenGuard)
export class LoyaltyBulkController {
  constructor(private readonly bulk: BulkService) {}

  @Post('bulk-operations')
  create(
    @CurrentMerchant() merchant: Merchant,
    @Body(
      new ZodValidationPipe(
        createBulkOperationSchema as unknown as ZodType<CreateBulkOperationDto>,
      ),
    )
    body: CreateBulkOperationDto,
  ): Promise<BulkOperationSummary> {
    return this.bulk.createOperation(merchant.id, body);
  }

  @Post('bulk-operations/:id/rows')
  ingest(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ingestRowsSchema as unknown as ZodType<IngestRowsDto>))
    body: IngestRowsDto,
  ): Promise<{ received: number; validRows: number; invalidRows: number }> {
    return this.bulk.ingestRows(merchant.id, id, body.rows as BulkRowInput[]);
  }

  @Post('bulk-operations/:id/confirm')
  confirm(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
  ): Promise<BulkOperationSummary & { duplicateWarnings: number }> {
    return this.bulk.confirm(merchant.id, id);
  }

  @Get('bulk-operations')
  list(
    @CurrentMerchant() merchant: Merchant,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: BulkOperationSummary[]; total: number; page: number; limit: number }> {
    return this.bulk.list(merchant.id, Number(page ?? 1), Number(limit ?? 20));
  }

  @Get('bulk-operations/:id')
  get(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
  ): Promise<BulkOperationSummary> {
    return this.bulk.get(merchant.id, id);
  }

  /**
   * Raw CSV of failed + skipped rows. Sent via `@Res()` so the global response
   * envelope interceptor is bypassed (wizzy storefront.controller pattern).
   */
  @Get('bulk-operations/:id/errors.csv')
  async errorsCsv(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const csv = await this.bulk.errorsCsv(merchant.id, id);
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="bulk-${id}-errors.csv"`)
      .send(csv);
  }
}
