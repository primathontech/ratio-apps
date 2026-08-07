import { type QueueEnvelope, wrapEnvelope } from '@ratio-app/shared/schemas/queue-envelope';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KafkaWorker,
  type KafkaWorkerDeps,
  processKafkaMessage,
} from '../../../src/core/kafka/kafka.worker';
import { makeFakeKafka } from '../../helpers/fake-kafka';

const silentLogger = { warn: vi.fn(), error: vi.fn() };

function makeDeps(over: Partial<Parameters<typeof processKafkaMessage>[2]> = {}) {
  return {
    handler: vi.fn(async () => {}),
    maxAttempts: 3,
    reproduce: vi.fn(async () => {}),
    toDlq: vi.fn(async () => {}),
    logger: silentLogger,
    ...over,
  };
}

const AT = { topic: 'clevertap.forwarding', partition: 0 };

describe('processKafkaMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes the handler with the payload + attempt; no retry/DLQ on success', async () => {
    const deps = makeDeps();
    await processKafkaMessage(JSON.stringify(wrapEnvelope({ orderId: 'o1' }, 'now')), AT, deps);
    expect(deps.handler).toHaveBeenCalledWith({ orderId: 'o1' }, { ...AT, attempt: 0 });
    expect(deps.reproduce).not.toHaveBeenCalled();
    expect(deps.toDlq).not.toHaveBeenCalled();
  });

  it('re-enqueues with attempt+1 when the handler throws below maxAttempts', async () => {
    const deps = makeDeps({
      handler: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await processKafkaMessage(JSON.stringify(wrapEnvelope({ id: 1 }, 'now', 0)), AT, deps);
    expect(deps.reproduce).toHaveBeenCalledTimes(1);
    const [, env] = deps.reproduce.mock.calls[0] as [string, QueueEnvelope];
    expect(env.attempt).toBe(1);
    expect(deps.toDlq).not.toHaveBeenCalled();
  });

  it('routes to DLQ when the handler throws at the last attempt', async () => {
    const deps = makeDeps({
      handler: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    // attempt 2, maxAttempts 3 → next (3) is NOT < 3 → DLQ
    await processKafkaMessage(JSON.stringify(wrapEnvelope({ id: 1 }, 'now', 2)), AT, deps);
    expect(deps.toDlq).toHaveBeenCalledWith(AT.topic, { id: 1 }, 'max attempts (3)');
    expect(deps.reproduce).not.toHaveBeenCalled();
  });

  it('routes an unparseable message to DLQ (never silently dropped)', async () => {
    const deps = makeDeps();
    await processKafkaMessage('not json', AT, deps);
    expect(deps.toDlq).toHaveBeenCalledWith(AT.topic, { raw: 'not json' }, 'unparseable');
    expect(deps.handler).not.toHaveBeenCalled();
  });

  it('never throws even if the handler rejects (partition must progress)', async () => {
    const deps = makeDeps({
      handler: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(
      processKafkaMessage(JSON.stringify(wrapEnvelope({}, 'now', 0)), AT, deps),
    ).resolves.toBeUndefined();
  });
});

describe('KafkaWorker (wiring)', () => {
  let fake: ReturnType<typeof makeFakeKafka>;
  let deps: KafkaWorkerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    fake = makeFakeKafka();
    deps = {
      kafkaConfig: { clientId: 'test', brokers: ['localhost:9092'] },
      reproduce: vi.fn(async () => {}),
      toDlq: vi.fn(async () => {}),
      ensureTopics: vi.fn(async () => {}),
      clientFactory: () => fake.client,
      logger: silentLogger,
    };
  });

  it('ensures topics, connects, subscribes and runs on start', async () => {
    const worker = new KafkaWorker(deps, {
      topics: ['clevertap.forwarding'],
      groupId: 'clevertap-forwarding',
      handler: vi.fn(async () => {}),
    });
    await worker.start();
    expect(deps.ensureTopics).toHaveBeenCalledWith(['clevertap.forwarding']);
    expect(fake.consumer.connect).toHaveBeenCalledOnce();
    expect(fake.consumer.subscribe).toHaveBeenCalledWith({
      topics: ['clevertap.forwarding'],
      fromBeginning: false,
    });
  });

  it('processes a delivered message through the handler and commits offset+1', async () => {
    const handler = vi.fn(async () => {});
    const worker = new KafkaWorker(deps, {
      topics: ['clevertap.forwarding'],
      groupId: 'g',
      handler,
    });
    await worker.start();
    await fake.deliver(
      'clevertap.forwarding',
      0,
      41,
      JSON.stringify(wrapEnvelope({ ok: true }, 'now')),
    );

    expect(handler).toHaveBeenCalledWith({ ok: true }, expect.objectContaining({ attempt: 0 }));
    expect(fake.commits).toEqual([{ topic: 'clevertap.forwarding', partition: 0, offset: '42' }]);
  });

  it('commits (progresses) even for an unparseable message, routing it to DLQ', async () => {
    const worker = new KafkaWorker(deps, {
      topics: ['t'],
      groupId: 'g',
      handler: vi.fn(async () => {}),
    });
    await worker.start();
    await fake.deliver('t', 2, 7, 'garbage');
    expect(deps.toDlq).toHaveBeenCalledWith('t', { raw: 'garbage' }, 'unparseable');
    expect(fake.commits).toEqual([{ topic: 't', partition: 2, offset: '8' }]);
  });

  it('disconnects on stop', async () => {
    const worker = new KafkaWorker(deps, {
      topics: ['t'],
      groupId: 'g',
      handler: vi.fn(async () => {}),
    });
    await worker.start();
    await worker.stop();
    expect(fake.consumer.disconnect).toHaveBeenCalledOnce();
  });
});
