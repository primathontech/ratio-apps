import { parseEnvelope } from '@ratio-app/shared/schemas/queue-envelope';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KafkaService } from '../../../src/core/kafka/kafka.service';

interface SentRecord {
  topic: string;
  messages: { key: string | null; value: string }[];
}

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
    await ctx.svc.onModuleInit();
  });

  it('connects the producer on module init', () => {
    expect(ctx.producer.connect).toHaveBeenCalledOnce();
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
