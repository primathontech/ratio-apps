// apps/backend/test/integration/stream.produce.test.ts
// Gated: only runs when KINESIS_ENDPOINT is set (LocalStack). Skipped otherwise.
import { CreateStreamCommand, DescribeStreamSummaryCommand, GetRecordsCommand, GetShardIteratorCommand, ListShardsCommand } from '@aws-sdk/client-kinesis';
import { beforeAll, describe, expect, it } from 'vitest';
import { StreamService } from '../../src/core/stream/stream.service';

const RUN = !!process.env.KINESIS_ENDPOINT;
const d = RUN ? describe : describe.skip;

d('StreamService.produce (LocalStack)', () => {
  const svc = new StreamService();
  const stream = 'meta-capi-itest';
  beforeAll(async () => {
    await svc.client.send(new CreateStreamCommand({ StreamName: stream, ShardCount: 1 })).catch(() => undefined);
    // wait until ACTIVE
    let active = false;
    for (let i = 0; i < 20; i++) {
      const s = await svc.client.send(new DescribeStreamSummaryCommand({ StreamName: stream }));
      if (s.StreamDescriptionSummary?.StreamStatus === 'ACTIVE') { active = true; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!active) throw new Error(`Kinesis stream ${stream} did not become ACTIVE`);
  });
  it('puts records that are readable back', async () => {
    await svc.produce(stream, [{ partitionKey: 'm1', data: { hello: 'world' } }]);
    const shards = await svc.client.send(new ListShardsCommand({ StreamName: stream }));
    const shardId = shards.Shards![0].ShardId!;
    const it0 = await svc.client.send(new GetShardIteratorCommand({ StreamName: stream, ShardId: shardId, ShardIteratorType: 'TRIM_HORIZON' }));
    const recs = await svc.client.send(new GetRecordsCommand({ ShardIterator: it0.ShardIterator! }));
    const bodies = (recs.Records ?? []).map((r) => JSON.parse(Buffer.from(r.Data!).toString()));
    expect(bodies).toContainEqual({ hello: 'world' });
  });
});
