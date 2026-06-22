// apps/backend/test/integration/stream.consume.test.ts
import { CreateStreamCommand, DescribeStreamSummaryCommand } from '@aws-sdk/client-kinesis';
import { beforeAll, describe, expect, it } from 'vitest';
import { StreamService } from '../../src/core/stream/stream.service';

const RUN = !!process.env.KINESIS_ENDPOINT;
(RUN ? describe : describe.skip)('StreamService consume (LocalStack)', () => {
  const svc = new StreamService();
  const stream = 'meta-capi-consume-itest';
  beforeAll(async () => {
    await svc.client.send(new CreateStreamCommand({ StreamName: stream, ShardCount: 1 })).catch(() => undefined);
    for (let i = 0; i < 20; i++) {
      const s = await svc.client.send(new DescribeStreamSummaryCommand({ StreamName: stream }));
      if (s.StreamDescriptionSummary?.StreamStatus === 'ACTIVE') break;
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  it('reads back produced records via listShards/iterator/getRecords', async () => {
    await svc.produce(stream, [{ partitionKey: 'm1', data: { n: 1 } }, { partitionKey: 'm1', data: { n: 2 } }]);
    const [shardId] = await svc.listShards(stream);
    const it0 = await svc.iterator(stream, shardId);
    const { records } = await svc.getRecords(it0);
    expect(records.map((r) => (r.data as { n: number }).n)).toEqual(expect.arrayContaining([1, 2]));
    expect(records[0].seq).toBeTypeOf('string');
  });
});
