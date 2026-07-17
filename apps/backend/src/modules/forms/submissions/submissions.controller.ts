import { Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isOriginAllowed } from '../../../core/common/cors';
import { type ZodType, z } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { WebhookDeliveryService } from '../delivery/webhook-delivery.service';
import { FormsMerchantTokenGuard } from '../guards';
import { CsvExportService } from './csv-export.service';
import {
  type SubmissionDetail,
  type SubmissionListResult,
  SubmissionsService,
} from './submissions.service';

/** `?page&limit` — default 20, hard max 100 (TRD §6). */
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const listQueryPipe = new ZodValidationPipe(listQuerySchema as unknown as ZodType<ListQuery>);

/**
 * Merchant-guarded submission reads + delivery management (TRD §2):
 * paginated list, detail with signed file URLs, streaming CSV export
 * (deleted forms included — submissions outlive the form), the delivery
 * log, manual re-trigger, and the webhook "send test payload" probe.
 */
@Controller('forms/api')
@UseGuards(FormsMerchantTokenGuard)
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly csv: CsvExportService,
    private readonly webhookDelivery: WebhookDeliveryService,
  ) {}

  @Get('forms/:id/submissions')
  async list(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') formId: string,
    @Query(listQueryPipe) query: ListQuery,
  ): Promise<SubmissionListResult> {
    return this.submissions.list(merchant.id, formId, query.page, query.limit);
  }

  @Get('submissions/:id')
  async detail(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') submissionId: string,
  ): Promise<SubmissionDetail> {
    return this.submissions.detail(merchant.id, submissionId);
  }

  /**
   * Streaming CSV export. `reply.hijack()` streams rows as they page out of
   * the DB and bypasses the JSON-enveloping ResponseInterceptor — but it also
   * bypasses @fastify/cors, so we reapply CORS here (shared allowlist,
   * core/common/cors) for the cross-origin admin fetch.
   */
  @Get('forms/:id/submissions/export')
  async export(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') formId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Validate existence + ownership BEFORE hijacking so a 404 still renders
    // as the standard error envelope.
    await this.submissions.requireOwnForm(merchant.id, formId);

    const headers: Record<string, string> = {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${formId}-submissions.csv"`,
    };
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin, process.env.ALLOWED_ORIGINS ?? '')) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-credentials'] = 'true';
      headers.vary = 'Origin';
    }

    reply.hijack();
    reply.raw.writeHead(200, headers);
    try {
      await this.csv.export(merchant.id, formId, {
        write: (chunk) => {
          reply.raw.write(chunk);
        },
      });
    } finally {
      reply.raw.end();
    }
  }

  @Get('forms/:id/deliveries')
  async deliveries(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') formId: string,
    @Query(listQueryPipe) query: ListQuery,
  ): Promise<unknown> {
    return this.submissions.deliveries(merchant.id, formId, query.page, query.limit);
  }

  @Post('deliveries/:id/retrigger')
  async retrigger(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') deliveryId: string,
  ): Promise<{ status: string }> {
    return this.submissions.retriggerDelivery(merchant.id, Number(deliveryId));
  }

  @Post('forms/:id/webhook-test')
  async webhookTest(
    @CurrentMerchant() merchant: Merchant,
    @Param('id') formId: string,
  ): Promise<{ statusCode: number | null }> {
    return this.webhookDelivery.sendTest(merchant.id, formId);
  }
}
