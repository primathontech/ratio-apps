import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../../src/config/env.schema';
import type { KafkaService } from '../../../../src/core/kafka/kafka.service';
import type { ClevertapEventsClientFactory } from '../../../../src/modules/clevertap/events/clevertap-events.client';
import { ClevertapForwardingWorker } from '../../../../src/modules/clevertap/events/clevertap-forwarding.worker';
import { type FakeClevertapDb, makeFakeClevertapHandle } from './helpers/fake-clevertap-db';
import {
  ACCOUNT_ID,
  MERCHANT_ID,
  makeConfig,
  makeCrypto,
  makeForwardedEvent,
  PASSCODE,
} from './helpers/fakes';

const IDEMP = 'orders/paid:o1';

function message(records: unknown[] = [{ evtName: 'Charged', evtData: {} }]) {
  return {
    merchantId: MERCHANT_ID,
    topic: 'orders/paid',
    idempotencyKey: IDEMP,
    clevertapEvent: 'Charged',
    records: records as never,
  };
}

describe('ClevertapForwardingWorker.deliver', () => {
  let fake: FakeClevertapDb;
  let handle: ReturnType<typeof makeFakeClevertapHandle>['handle'];
  let uploader: { upload: ReturnType<typeof vi.fn> };
  const crypto = makeCrypto();

  function build() {
    const factory = (() => uploader) as unknown as ClevertapEventsClientFactory;
    return new ClevertapForwardingWorker(
      handle,
      crypto,
      factory,
      {} as unknown as KafkaService,
      {} as unknown as ConfigService<Env, true>,
      true,
      true,
    );
  }

  beforeEach(() => {
    const built = makeFakeClevertapHandle();
    fake = built.fake;
    handle = built.handle;
    uploader = { upload: vi.fn(async () => ({ ok: true, status: 200 })) };
    fake.seed(
      'clevertap_configs',
      makeConfig({ passcodeEnc: crypto.encrypt(PASSCODE), serverEventsEnabled: true }),
    );
    fake.seed(
      'clevertap_forwarded_events',
      makeForwardedEvent({ idempotencyKey: IDEMP, status: 'queued' }),
    );
  });

  it('uploads with the decrypted passcode and marks the row sent', async () => {
    await build().deliver(message());
    expect(uploader.upload).toHaveBeenCalledTimes(1);
    expect(uploader.upload.mock.calls[0][0]).toMatchObject({
      accountId: ACCOUNT_ID,
      passcode: PASSCODE,
    });
    expect(fake.forwarded(MERCHANT_ID)[0]?.status).toBe('sent');
  });

  it('skips a redelivery when the row is already sent (no second upload)', async () => {
    fake.table('clevertap_forwarded_events').length = 0;
    fake.seed(
      'clevertap_forwarded_events',
      makeForwardedEvent({ idempotencyKey: IDEMP, status: 'sent' }),
    );
    await build().deliver(message());
    expect(uploader.upload).not.toHaveBeenCalled();
  });

  it('marks skipped and never uploads when the kill switch is off', async () => {
    fake.table('clevertap_configs').length = 0;
    fake.seed(
      'clevertap_configs',
      makeConfig({
        passcodeEnc: crypto.encrypt(PASSCODE),
        serverEventsEnabled: true,
        clevertapEnabled: false,
      }),
    );
    await build().deliver(message());
    expect(uploader.upload).not.toHaveBeenCalled();
    expect(fake.forwarded(MERCHANT_ID)[0]?.status).toBe('skipped');
  });

  it('marks the row failed and throws on upload failure (so the worker retries/DLQs)', async () => {
    uploader.upload = vi.fn(async () => ({ ok: false, status: 500, error: 'clevertap 500' }));
    await expect(build().deliver(message())).rejects.toThrow('clevertap 500');
    expect(fake.forwarded(MERCHANT_ID)[0]?.status).toBe('failed');
  });
});

describe('ClevertapForwardingWorker.drainOutbox (outbox poller)', () => {
  let fake: FakeClevertapDb;
  let handle: ReturnType<typeof makeFakeClevertapHandle>['handle'];
  let produce: ReturnType<typeof vi.fn>;
  const crypto = makeCrypto();

  function build() {
    const factory = (() => ({ upload: vi.fn() })) as unknown as ClevertapEventsClientFactory;
    return new ClevertapForwardingWorker(
      handle,
      crypto,
      factory,
      { produce } as unknown as KafkaService,
      {} as unknown as ConfigService<Env, true>,
      true,
      true,
    );
  }

  beforeEach(() => {
    const built = makeFakeClevertapHandle();
    fake = built.fake;
    handle = built.handle;
    produce = vi.fn(async () => {});
  });

  it('produces queued rows, parsing the stored payload, and marks them enqueued', async () => {
    fake.seed(
      'clevertap_forwarded_events',
      makeForwardedEvent({
        idempotencyKey: IDEMP,
        status: 'queued',
        payload: JSON.stringify([{ evtName: 'Charged', evtData: { x: 1 } }]) as never,
      }),
    );

    await build().drainOutbox();

    expect(produce).toHaveBeenCalledTimes(1);
    const [topic, payloads] = produce.mock.calls[0] as [string, Record<string, unknown>[]];
    expect(topic).toBe('clevertap.forwarding');
    expect(payloads[0]).toMatchObject({
      merchantId: MERCHANT_ID,
      topic: 'orders/paid',
      clevertapEvent: 'Charged',
    });
    expect(payloads[0]?.records).toEqual([{ evtName: 'Charged', evtData: { x: 1 } }]);
    expect(fake.forwarded(MERCHANT_ID)[0]?.status).toBe('enqueued');
  });

  it('reverts the row to queued when produce throws (retried on the next poll)', async () => {
    produce = vi.fn(async () => {
      throw new Error('broker down');
    });
    fake.seed(
      'clevertap_forwarded_events',
      makeForwardedEvent({
        idempotencyKey: IDEMP,
        status: 'queued',
        payload: JSON.stringify([{ evtName: 'Charged', evtData: {} }]) as never,
      }),
    );

    await build().drainOutbox();

    expect(fake.forwarded(MERCHANT_ID)[0]?.status).toBe('queued');
  });
});
