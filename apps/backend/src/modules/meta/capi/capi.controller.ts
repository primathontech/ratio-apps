import { Body, Controller, Logger, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { capiIngestSchema, type CapiIngestBody } from '@ratio-app/shared';
import { MerchantIdPipe } from '../../../core/common/pipes/merchant-id.pipe';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { QUEUE_NAMES, QueueService } from '../queue/queue.service';
import { type CapiContext, MetaCapiService, type RawCapiEvent } from './capi.service';
import { CapiHmacGuard } from './capi-hmac.guard';

/**
 * Browser-facing Conversions API ingest (Call B). The per-merchant SDK posts
 * batched events here (path comes from the SDK prelude's `capiPath`). We read
 * the client IP + User-Agent server-side (never trust the client for these),
 * then hand off to {@link MetaCapiService.dispatch} which hashes PII and
 * forwards to Meta (Call C).
 *
 * `MerchantIdPipe` validates `:merchantId` format before any DB work.
 * `ZodValidationPipe(capiIngestSchema)` caps batch at 100 events and validates
 * all field types — prevents DoS via oversized batches or malformed payloads.
 */
@Controller('meta/api/v1/capi')
export class MetaCapiController {
  private readonly logger = new Logger(MetaCapiController.name);

  constructor(
    private readonly capi: MetaCapiService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Enqueue-and-ack: validate, capture server IP/UA, push one message to the
   * `meta-capi` queue, and return immediately. A worker pod drains the queue,
   * batches, and dispatches to Meta (Call C) — so ingest latency never depends
   * on Meta. If the queue is unavailable, fall back to inline dispatch so events
   * are never silently dropped.
   */
  @UseGuards(CapiHmacGuard)
  @Post(':merchantId')
  async ingest(
    @Param('merchantId', MerchantIdPipe) merchantId: string,
    @Body(new ZodValidationPipe(capiIngestSchema)) body: CapiIngestBody,
    @Req() req: FastifyRequest,
  ): Promise<{ received: number; queued: boolean }> {
    const ua = req.headers['user-agent'];
    const ctx: CapiContext = { clientIp: req.ip };
    if (typeof ua === 'string') ctx.userAgent = ua;
    const events = body.events as RawCapiEvent[];

    // [CAPI-TRACE] TEMP debug — remove after the dropped-events investigation.
    const ids = events.map((e) => `${e.event_name}:${e.event_id}`);
    this.logger.log({ msg: '[CAPI-TRACE] 1. ingest received (Call B)', merchantId, count: events.length, ids });

    try {
      await this.queue.sendBatch(QUEUE_NAMES.capi, [{ merchantId, events, ctx }]);
      this.logger.log({ msg: '[CAPI-TRACE] 2. enqueued to SQS', merchantId, count: events.length, ids });
      return { received: events.length, queued: true };
    } catch (err) {
      this.logger.warn({ msg: '[CAPI-TRACE] 2x. enqueue FAILED — inline dispatch fallback', merchantId, count: events.length, ids, err });
      await this.capi.dispatch(merchantId, events, ctx);
      return { received: events.length, queued: false };
    }
  }
}
