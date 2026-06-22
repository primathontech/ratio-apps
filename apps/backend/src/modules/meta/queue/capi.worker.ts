import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { CapiStatsService, classifyCapiError } from '../capi/capi-stats.service';
import { MetaCapiService, type CapiContext, type RawCapiEvent } from '../capi/capi.service';
import { QUEUE_NAMES, QueueService } from './queue.service';

/** Shape enqueued by the ingest controller (one message per Call B POST, ~10 events). */
interface CapiQueueMessage {
  merchantId: string;
  events: RawCapiEvent[];
  ctx: CapiContext;
}

interface Buffer {
  events: RawCapiEvent[];
  handles: string[];
  firstAt: number;
  ctx: CapiContext;
}

/**
 * Drains `meta-capi` and dispatches to Meta in BIG batches.
 *
 * Each SQS message carries ~10 events; SQS returns ≤10 messages/poll (~100
 * events). To use Meta's 1,000-event batch and stay under its ~100 req/s limit,
 * the worker ACCUMULATES per merchant across polls and flushes on whichever
 * fires first:
 *   - BATCH_SIZE events (default 800), or
 *   - WINDOW_MS since the first buffered event (default 5 min).
 * It holds the messages' receipt handles un-acked until the flush succeeds, so
 * VISIBILITY (default 360s > window) keeps them from redelivering mid-batch.
 *
 * Runs only when META_WORKER_ENABLED=true.
 */
@Injectable()
export class MetaCapiWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetaCapiWorker.name);
  private running = false;
  private readonly buffers = new Map<string, Buffer>();

  private readonly BATCH_SIZE = Number(process.env.META_CAPI_BATCH_SIZE ?? 800);
  private readonly WINDOW_MS = Number(process.env.META_CAPI_BATCH_WINDOW_MS ?? 300_000);
  private readonly VISIBILITY = Number(process.env.META_CAPI_VISIBILITY ?? 360);

  constructor(
    private readonly queue: QueueService,
    private readonly capi: MetaCapiService,
    private readonly stats: CapiStatsService,
  ) {}

  onModuleDestroy(): void {
    this.running = false;
  }

  onModuleInit(): void {
    if (process.env.META_WORKER_ENABLED !== 'true') {
      this.logger.log('CAPI worker disabled (META_WORKER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'CAPI worker started', batchSize: this.BATCH_SIZE, windowMs: this.WINDOW_MS });
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const msgs = await this.queue.receive<CapiQueueMessage>(QUEUE_NAMES.capi, 10, 5, this.VISIBILITY);
        for (const m of msgs) this.buffer(m.body, m.receiptHandle);
        await this.flushReady();
      } catch (err) {
        this.logger.error({ msg: 'CAPI worker loop error', err });
        await this.sleep(1000);
      }
    }
  }

  private buffer(body: CapiQueueMessage, handle: string): void {
    if (!body?.merchantId || !Array.isArray(body.events)) return;
    const b = this.buffers.get(body.merchantId) ?? { events: [], handles: [], firstAt: Date.now(), ctx: body.ctx ?? {} };
    b.events.push(...body.events);
    b.handles.push(handle);
    this.buffers.set(body.merchantId, b);
  }

  /** Flush merchants that hit the size OR time threshold (whichever first). */
  private async flushReady(): Promise<void> {
    const now = Date.now();
    for (const [merchantId, b] of [...this.buffers]) {
      const ready = b.events.length >= this.BATCH_SIZE || now - b.firstAt >= this.WINDOW_MS;
      if (!ready) continue;
      this.buffers.delete(merchantId);
      try {
        const res = await this.capi.dispatch(merchantId, b.events, b.ctx);
        if (res.failed > 0) {
          // A pixel send failed. Leave the messages un-acked so they redeliver
          // after VISIBILITY and re-buffer (Meta dedupes on event_id). Acking
          // here would silently drop the events — no retry, no DLQ.
          this.logger.error({ msg: 'CAPI batch had send failures — not acked, will retry', merchantId, events: b.events.length, ...res });
          // Best-effort error-signal counters (these events are retried, not lost).
          // Attribute the batch to the first error's reason for the "why" breakdown.
          const message = res.errors[0] ?? 'unknown error';
          void this.stats.record(merchantId, { failed: b.events.length }).catch(() => undefined);
          void this.stats
            .recordFailure(merchantId, classifyCapiError(message), message, b.events.length)
            .catch(() => undefined);
          continue;
        }
        this.logger.log({ msg: 'CAPI batch dispatched', merchantId, events: b.events.length, messages: b.handles.length, ...res });
        await this.queue.ack(QUEUE_NAMES.capi, b.handles); // ack only on success
        // Record AFTER the ack so we only count delivered-and-acked events.
        void this.stats.record(merchantId, { dispatched: b.events.length, batches: 1 }).catch(() => undefined);
      } catch (err) {
        // Not acked → messages redeliver after VISIBILITY and re-buffer. No loss.
        this.logger.error({ msg: 'CAPI batch failed (will retry)', merchantId, events: b.events.length, err });
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
