import { parseEnvelope } from '@ratio-app/shared/schemas/queue-envelope';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KafkaService } from '../../../src/core/kafka/kafka.service';

interface SentRecord {
  topic: string;
  messages: { key: string | null; value: string }[];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeService() {
  const sent: SentRecord[] = [];
  const producer = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    send: vi.fn(async (r: SentRecord) => {
      sent.push(r);
      return [];
    }),
  };
  const client = { producer: () => producer, admin: () => ({}) };
  // biome-ignore lint/suspicious/noExplicitAny: fake client/config for a no-broker unit test
  const svc = new KafkaService({} as any, client as any);
  return { svc, producer, sent };
}

describe('KafkaService', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(async () => {
    ctx = makeService();
    ctx.svc.onModuleInit();
    await flush();
  });

  it('connects the producer on module init', () => {
    expect(ctx.producer.connect).toHaveBeenCalledOnce();
  });

  it('onModuleInit connects in the background and never blocks boot when the broker is unreachable', async () => {
    let resolveConnect: () => void = () => {};
    const gate = new Promise<void>((r) => {
      resolveConnect = r;
    });
    const producer = {
      connect: vi.fn(() => gate.then(() => Promise.reject(new Error('ECONNREFUSED')))),
      disconnect: vi.fn(async () => {}),
      send: vi.fn(async () => []),
    };
    const client = { producer: () => producer, admin: () => ({}) };
    // biome-ignore lint/suspicious/noExplicitAny: fake client/config for a no-broker unit test
    const svc = new KafkaService({} as any, client as any);

    expect(svc.onModuleInit()).toBeUndefined();
    resolveConnect();
    await flush();
    expect(producer.connect).toHaveBeenCalledOnce();
  });

  it('dedupes concurrent connects — a burst of sends connects the producer once', async () => {
    const fresh = makeService();
    await Promise.all([
      fresh.svc.send({ topic: 't', messages: [{ key: 'k', value: 'v' }] }),
      fresh.svc.send({ topic: 't', messages: [{ key: 'k', value: 'v' }] }),
      fresh.svc.send({ topic: 't', messages: [{ key: 'k', value: 'v' }] }),
    ]);
    expect(fresh.producer.connect).toHaveBeenCalledOnce();
    expect(fresh.producer.send).toHaveBeenCalledTimes(3);
  });

  it('produce() wraps each payload in a queue envelope (v1, attempt 0)', async () => {
    await ctx.svc.produce('clevertap.forwarding', [{ orderId: 'o1' }, { orderId: 'o2' }]);

    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].topic).toBe('clevertap.forwarding');
    const envelopes = ctx.sent[0].messages.map((m) => parseEnvelope(m.value));
    expect(envelopes.map((e) => e?.payload)).toEqual([{ orderId: 'o1' }, { orderId: 'o2' }]);
    expect(envelopes.every((e) => e?.v === 1 && e?.attempt === 0)).toBe(true);
  });

  it('produce() sets the partition key from keyFn', async () => {
    await ctx.svc.produce(
      'clevertap.forwarding',
      [{ merchantId: 'm1' }, { merchantId: 'm2' }],
      (p) => (p as { merchantId: string }).merchantId,
    );
    expect(ctx.sent[0].messages.map((m) => m.key)).toEqual(['m1', 'm2']);
  });

  it('produce() is a no-op for an empty batch (no send)', async () => {
    await ctx.svc.produce('t', []);
    expect(ctx.producer.send).not.toHaveBeenCalled();
  });

  it('sendToDlq() routes to the topic.dlq queue with a reason and the original payload', async () => {
    await ctx.svc.sendToDlq('clevertap.forwarding', { orderId: 'bad' }, 'max attempts');

    expect(ctx.sent[0].topic).toBe('clevertap.forwarding.dlq');
    const body = JSON.parse(ctx.sent[0].messages[0].value);
    expect(body).toMatchObject({ reason: 'max attempts', payload: { orderId: 'bad' } });
    expect(typeof body.failedAt).toBe('string');
  });
});

function makeAdmin(existing: string[] = []) {
  const created: { topic: string; numPartitions: number; replicationFactor: number }[] = [];
  const admin = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    listTopics: vi.fn(async () => existing),
    createTopics: vi.fn(
      async (arg: {
        topics: { topic: string; numPartitions: number; replicationFactor: number }[];
      }) => {
        created.push(...arg.topics);
        return true;
      },
    ),
  };
  return { admin, created };
}

const noopProducer = () => ({
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  send: vi.fn(async () => []),
});

describe('KafkaService.ensureTopic', () => {
  it('creates a missing topic with the configured partitions + replication factor', async () => {
    const { admin, created } = makeAdmin([]);
    const config = {
      get: (k: string) =>
        (
          ({ KAFKA_TOPIC_PARTITIONS: 5, KAFKA_TOPIC_REPLICATION_FACTOR: 3 }) as Record<
            string,
            number
          >
        )[k],
    };
    const client = { producer: noopProducer, admin: () => admin };
    // biome-ignore lint/suspicious/noExplicitAny: fake client/config for a no-broker unit test
    const svc = new KafkaService(config as any, client as any);
    await svc.ensureTopic('t1');
    expect(created).toEqual([{ topic: 't1', numPartitions: 5, replicationFactor: 3 }]);
    expect(admin.disconnect).toHaveBeenCalledOnce();
  });

  it('does not create a topic that already exists, and still disconnects', async () => {
    const { admin, created } = makeAdmin(['t1']);
    const client = { producer: noopProducer, admin: () => admin };
    // biome-ignore lint/suspicious/noExplicitAny: fake client/config for a no-broker unit test
    const svc = new KafkaService({} as any, client as any);
    await svc.ensureTopic('t1');
    expect(created).toHaveLength(0);
    expect(admin.disconnect).toHaveBeenCalledOnce();
  });

  it('does not cache the topic on admin failure (retries next call) and disconnects each time', async () => {
    const admin = {
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      listTopics: vi.fn(async () => {
        throw new Error('admin unreachable');
      }),
      createTopics: vi.fn(async () => true),
    };
    const client = { producer: noopProducer, admin: () => admin };
    // biome-ignore lint/suspicious/noExplicitAny: fake client/config for a no-broker unit test
    const svc = new KafkaService({} as any, client as any);
    await svc.ensureTopic('t1');
    await svc.ensureTopic('t1');
    expect(admin.listTopics).toHaveBeenCalledTimes(2);
    expect(admin.disconnect).toHaveBeenCalledTimes(2);
  });
});
