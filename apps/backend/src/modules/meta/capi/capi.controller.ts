import { Body, Controller, Logger, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { capiIngestSchema, type CapiIngestBody } from '@ratio-app/shared';
import { MerchantIdPipe } from '../../../core/common/pipes/merchant-id.pipe';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { StreamService } from '../../../core/stream/stream.service';
import { QUEUE_NAMES, QueueService } from '../queue/queue.service';
import { type CapiContext, MetaCapiService, type RawCapiEvent } from './capi.service';
import { hashEventPii, parseWhaleBuckets, partitionKey } from './edge';
import { aggregate } from '../../../core/stream/aggregation';

@Controller('meta/api/v1/capi')
export class MetaCapiController {
  private readonly logger = new Logger(MetaCapiController.name);
  constructor(
    private readonly capi: MetaCapiService,
    private readonly queue: QueueService,
    private readonly stream: StreamService,
  ) {}

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
    const bus = process.env.META_CAPI_BUS ?? 'sqs';

    // META_CAPI_BUS routes ingestion: 'sqs' (today), 'kinesis' (new pipeline), or
    // 'both' (dual-write during migration). The kinesis path hashes PII at the edge
    // (raw PII never crosses Kinesis); the SQS path carries raw events as before and
    // hashes downstream in the worker. 'both' is a transient migration mode.
    if (bus === 'kinesis' || bus === 'both') {
      const stream = process.env.KINESIS_STREAM_NAME ?? 'meta-capi';
      const max = Math.max(1, Number(process.env.META_CAPI_AGG_MAX ?? 100) || 100);
      const whales = parseWhaleBuckets(process.env.META_CAPI_WHALE_BUCKETS ?? '');
      const hashed = events.map(hashEventPii);
      // one record per aggregated group; key by the FIRST event's id (same merchant)
      const records = aggregate(hashed, max).map((group) => ({
        partitionKey: partitionKey(merchantId, group[0]?.event_id, whales),
        data: { merchantId, events: group, ctx },
      }));
      await this.stream.produce(stream, records);
    }

    if (bus === 'sqs' || bus === 'both') {
      try {
        await this.queue.sendBatch(QUEUE_NAMES.capi, [{ merchantId, events, ctx }]);
      } catch (err) {
        if (bus === 'sqs') {
          this.logger.warn({ msg: 'enqueue failed — inline dispatch fallback', merchantId, err });
          await this.capi.dispatch(merchantId, events, ctx);
          return { received: events.length, queued: false };
        }
        throw err; // in 'both' mode the kinesis write already succeeded; surface SQS error
      }
    }
    return { received: events.length, queued: true };
  }
}
