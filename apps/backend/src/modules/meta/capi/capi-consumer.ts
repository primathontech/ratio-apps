import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StreamService } from '../../../core/stream/stream.service';
import { ShardLeaseRepository } from './shard-lease.repository';
import { MetaCapiService, type CapiContext, type RawCapiEvent } from './capi.service';
import { CapiRateLimiter } from './rate-limit';
import { CapiDlq } from './dlq';

interface RecordPayload { merchantId: string; events: RawCapiEvent[]; ctx: CapiContext }

@Injectable()
export class MetaCapiConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetaCapiConsumer.name);
  private running = false;
  private readonly owner = `${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly stream = process.env.KINESIS_STREAM_NAME ?? 'meta-capi';
  private readonly LEASE_MS = 60_000;
  private readonly MAX_POLLS_PER_LEASE = 10;

  constructor(
    private readonly streamSvc: StreamService,
    private readonly leases: ShardLeaseRepository,
    private readonly dispatch: MetaCapiService,
    private readonly rate: CapiRateLimiter,
    private readonly dlq: CapiDlq,
  ) {}

  onModuleInit(): void {
    if (process.env.META_CAPI_CONSUMER_ENABLED !== 'true') {
      this.logger.log('Meta CAPI Kinesis consumer disabled (META_CAPI_CONSUMER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'Meta CAPI Kinesis consumer started', owner: this.owner, stream: this.stream });
    void this.loop();
  }

  onModuleDestroy(): void { this.running = false; }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const shards = await this.streamSvc.listShards(this.stream);
        for (const shardId of shards) {
          if (!this.running) break;
          if (!(await this.leases.tryAcquire(this.stream, shardId, this.owner, this.LEASE_MS))) continue;
          await this.drainShard(shardId);
        }
        if (!shards.length) await this.sleep(1000);
      } catch (err) {
        this.logger.error({ msg: 'consumer loop error', err: `${err}` });
        await this.sleep(1000);
      }
    }
  }

  private async drainShard(shardId: string): Promise<void> {
    const after = (await this.leases.lastCheckpoint(this.stream, shardId)) ?? undefined;
    let iterator: string | undefined = await this.streamSvc.iterator(this.stream, shardId, after);
    let polls = 0;
    while (this.running && iterator && polls < this.MAX_POLLS_PER_LEASE) {
      const { records, nextIterator } = await this.streamSvc.getRecords(iterator);
      for (const rec of records) {
        const payload = rec.data as RecordPayload;
        if (await this.rate.tripped(payload.merchantId)) { await this.sleep(500); return; } // back off, no checkpoint
        if (!(await this.rate.take(payload.merchantId, payload.events.length))) {
          await this.sleep(500);
          return; // over per-minute budget — stop draining this shard, no checkpoint
        }
        await this.processRecord(payload);
        await this.leases.checkpoint(this.stream, shardId, this.owner, rec.seq);
      }
      iterator = nextIterator;
      polls += 1;
      if (!records.length) { await this.sleep(1000); }
    }
  }

  /** Group one record's events through the existing Meta dispatch; DLQ non-retryables. */
  async processRecord(p: RecordPayload): Promise<{ dispatched: number; failed: number }> {
    const res = await this.dispatch.dispatch(p.merchantId, p.events, p.ctx);
    if (res.failed > 0 && res.dispatched === 0 && res.errors.some((e) => e.includes('non-retryable'))) {
      try {
        await this.dlq.put(p.merchantId, { events: p.events, errors: res.errors });
      } catch (err) {
        this.logger.error({ msg: 'DLQ write failed (event dropped)', merchantId: p.merchantId, err: `${err}` });
      }
    }
    if (res.errors.some((e) => e.includes('429') || e.toLowerCase().includes('rate limit'))) {
      await this.rate.trip(p.merchantId, 30_000); // back off this merchant ~30s on Meta 429
    }
    return { dispatched: res.dispatched, failed: res.failed };
  }

  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
}
