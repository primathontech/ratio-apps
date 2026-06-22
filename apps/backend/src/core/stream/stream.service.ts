import { Injectable, Logger } from '@nestjs/common';
import {
  GetRecordsCommand, GetShardIteratorCommand, KinesisClient, ListShardsCommand, PutRecordsCommand,
} from '@aws-sdk/client-kinesis';

export interface StreamRecord {
  partitionKey: string;
  data: unknown;
}

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);
  readonly client: KinesisClient;

  constructor() {
    const endpoint = process.env.KINESIS_ENDPOINT;
    this.client = new KinesisClient({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      ...(endpoint ? { endpoint } : {}),
      ...(endpoint
        ? { credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'x', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'x' } }
        : {}),
    });
  }

  /** PutRecords in ≤500-record chunks. Throws if any chunk fully fails. */
  async produce(stream: string, records: StreamRecord[]): Promise<void> {
    if (!records.length) return;
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const res = await this.client.send(
        new PutRecordsCommand({
          StreamName: stream,
          Records: chunk.map((r) => ({ PartitionKey: r.partitionKey, Data: Buffer.from(JSON.stringify(r.data)) })),
        }),
      );
      if (res.FailedRecordCount && res.FailedRecordCount === chunk.length) {
        throw new Error(`Kinesis PutRecords: all ${chunk.length} records failed for stream "${stream}"`);
      }
      if (res.FailedRecordCount) {
        this.logger.warn({ msg: 'partial PutRecords failure', stream, failed: res.FailedRecordCount });
      }
    }
  }

  async listShards(stream: string): Promise<string[]> {
    const out: string[] = [];
    let next: string | undefined;
    do {
      const res = await this.client.send(new ListShardsCommand({ StreamName: next ? undefined : stream, NextToken: next }));
      for (const s of res.Shards ?? []) if (s.ShardId) out.push(s.ShardId);
      next = res.NextToken;
    } while (next);
    return out;
  }

  async iterator(stream: string, shardId: string, afterSeq?: string): Promise<string> {
    const res = await this.client.send(new GetShardIteratorCommand({
      StreamName: stream,
      ShardId: shardId,
      ShardIteratorType: afterSeq ? 'AFTER_SEQUENCE_NUMBER' : 'TRIM_HORIZON',
      ...(afterSeq ? { StartingSequenceNumber: afterSeq } : {}),
    }));
    if (!res.ShardIterator) throw new Error(`no shard iterator for ${stream}/${shardId}`);
    return res.ShardIterator;
  }

  async getRecords(iterator: string): Promise<{ records: { seq: string; data: unknown }[]; nextIterator?: string }> {
    const res = await this.client.send(new GetRecordsCommand({ ShardIterator: iterator, Limit: 1000 }));
    const records = (res.Records ?? []).map((r) => ({ seq: r.SequenceNumber!, data: JSON.parse(Buffer.from(r.Data!).toString()) }));
    const out: { records: { seq: string; data: unknown }[]; nextIterator?: string } = { records };
    if (res.NextShardIterator) out.nextIterator = res.NextShardIterator;
    return out;
  }
}
