import { wrapEnvelope } from '@ratio-app/shared/schemas/queue-envelope';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeBackoffMs,
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
    toDlq: vi.fn(async () => {}),
    logger: silentLogger,
    sleep: vi.fn(async () => {}),
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
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.toDlq).not.toHaveBeenCalled();
  });

  it('retries the handler in place with backoff, then succeeds (no re-enqueue, no DLQ)', async () => {
    let calls = 0;
    const deps = makeDeps({
      handler: vi.fn(async () => {
        calls += 1;
        if (calls < 3) throw new Error('boom');
      }),
    });
    await processKafkaMessage(JSON.stringify(wrapEnvelope({ id: 1 }, 'now', 0)), AT, deps);
    expect(deps.handler).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.toDlq).not.toHaveBeenCalled();
  });

  it('passes the per-message heartbeat into the backoff sleep', async () => {
    const heartbeat = vi.fn(async () => {});
    let calls = 0;
    const deps = makeDeps({
      handler: vi.fn(async () => {
        calls += 1;
        if (calls < 2) throw new Error('x');
      }),
    });
    await processKafkaMessage(
      JSON.stringify(wrapEnvelope({ m: 'm1' }, 'now', 0)),
      { ...AT, heartbeat },
      deps,
    );
    expect(deps.sleep).toHaveBeenCalledWith(expect.any(Number), heartbeat);
  });

  it('routes to DLQ after exhausting maxAttempts (handler runs exactly maxAttempts times)', async () => {
    const deps = makeDeps({
      handler: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await processKafkaMessage(JSON.stringify(wrapEnvelope({ id: 1 }, 'now', 0)), AT, deps);
    expect(deps.handler).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.toDlq).toHaveBeenCalledWith(
      AT.topic,
      expect.objectContaining({ payload: { id: 1 }, attempt: 2 }),
      'max attempts (3)',
    );
  });

  it('routes an invalid-JSON message to DLQ with reason invalid-json (never dropped)', async () => {
    const deps = makeDeps();
    await processKafkaMessage('not json', AT, deps);
    expect(deps.toDlq).toHaveBeenCalledWith(AT.topic, { raw: 'not json' }, 'invalid-json');
    expect(deps.handler).not.toHaveBeenCalled();
  });

  it('routes a schema-mismatch message (valid JSON, wrong shape) to DLQ with reason schema-mismatch', async () => {
    const deps = makeDeps();
    await processKafkaMessage(JSON.stringify({ not: 'an envelope' }), AT, deps);
    expect(deps.toDlq).toHaveBeenCalledWith(
      AT.topic,
      { raw: JSON.stringify({ not: 'an envelope' }) },
      'schema-mismatch',
    );
    expect(deps.handler).not.toHaveBeenCalled();
  });

  it('never throws even if the handler always rejects (partition must progress)', async () => {
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

describe('computeBackoffMs', () => {
  it('grows exponentially, is capped at maxMs, and stays within the jitter band', () => {
    for (const retry of [1, 2, 3, 10]) {
      const base = 1000;
      const max = 8000;
      const exp = Math.min(max, base * 2 ** (retry - 1));
      const v = computeBackoffMs(retry, base, max);
      expect(v).toBeGreaterThanOrEqual(Math.floor(exp / 2));
      expect(v).toBeLessThanOrEqual(exp);
    }
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
      toDlq: vi.fn(async () => {}),
      ensureTopics: vi.fn(async () => {}),
      clientFactory: () => fake.client,
      logger: silentLogger,
      sleep: vi.fn(async () => {}),
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

  it('commits (progresses) even for an undecodable message, routing it to DLQ', async () => {
    const worker = new KafkaWorker(deps, {
      topics: ['t'],
      groupId: 'g',
      handler: vi.fn(async () => {}),
    });
    await worker.start();
    await fake.deliver('t', 2, 7, 'garbage');
    expect(deps.toDlq).toHaveBeenCalledWith('t', { raw: 'garbage' }, 'invalid-json');
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
