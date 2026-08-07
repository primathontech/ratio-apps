import { describe, expect, it } from 'vitest';
import { ClevertapForwardingService } from '../../../../src/modules/clevertap/events/forwarding.service';
import { ClevertapLoyaltyPointsCreditedHandler } from '../../../../src/modules/clevertap/webhooks/loyalty-points-credited.handler';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';
import {
  type ClevertapConfigRowFake,
  makeFakeCrypto,
  makeFakeTrx,
  makeFakeUploader,
} from './helpers/fake-forwarding-trx';
import { CLEVERTAP_TEST_MERCHANT_ID } from './helpers/fixtures/envelopes';

const CONFIG: ClevertapConfigRowFake = {
  merchantId: CLEVERTAP_TEST_MERCHANT_ID,
  accountId: 'ACCT-123',
  passcodeEnc: 'enc:passcode',
  region: 'in1',
  serverEventsEnabled: true,
};

const LOYALTY_TXN_ID = 'ltxn_1001';
const LOYALTY_EXPECTED_IDENTITY = '+919876543210';

const pointsCreditedPayload: Record<string, unknown> = {
  id: LOYALTY_TXN_ID,
  phone: '9876543210',
  email: 'shopper@example.com',
  points: 150,
  balance: 1150,
  reason: 'order_reward',
  created_at: '2026-07-30T10:00:00Z',
};

function harness() {
  const fake = makeFakeTrx({ config: CONFIG });
  const uploader = makeFakeUploader();
  const forwarding = new ClevertapForwardingService(makeFakeCrypto(), () => uploader);
  return { ...fake, uploader, handler: new ClevertapLoyaltyPointsCreditedHandler(forwarding) };
}

describe('ClevertapLoyaltyPointsCreditedHandler', () => {
  it('subscribes to the loyalty/points_credited topic', () => {
    expect(harness().handler.topic).toBe(CLEVERTAP_WEBHOOK_TOPICS.loyaltyPointsCredited);
    expect(harness().handler.topic).toBe('loyalty/points_credited');
  });

  it('forwards Points Credited via the client', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(pointsCreditedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0]?.records[0]?.evtName).toBe('Points Credited');
    expect(uploader.calls[0]?.records[0]?.type).toBe('event');
  });

  it('carries the points delta and balance as event properties', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(pointsCreditedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    const evtData = uploader.calls[0]?.records[0]?.evtData ?? {};
    expect(evtData.Points).toBe(150);
    expect(evtData.Balance).toBe(1150);
    expect(evtData['Transaction ID']).toBe(LOYALTY_TXN_ID);
  });

  it('identifies the shopper by the top-level +91 phone', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(pointsCreditedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(uploader.calls[0]?.records[0]?.identity).toBe(LOYALTY_EXPECTED_IDENTITY);
  });

  it('records a sent row keyed `loyalty/points_credited:<txn id>`', async () => {
    const { handler, trx, rows } = harness();
    await handler.handle(pointsCreditedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(rows[0]).toMatchObject({
      idempotencyKey: `loyalty/points_credited:${LOYALTY_TXN_ID}`,
      clevertapEvent: 'Points Credited',
      status: 'sent',
    });
  });

  it('derives identity from a nested customer object when top-level is absent', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(
      { id: 'ltxn_2002', customer: { phone: '9876543210' }, points: 20, balance: 40 },
      CLEVERTAP_TEST_MERCHANT_ID,
      trx,
    );
    expect(uploader.calls[0]?.records[0]?.identity).toBe(LOYALTY_EXPECTED_IDENTITY);
  });

  it('is a no-op for an unknown merchant', async () => {
    const { handler, trx, uploader, ops } = harness();
    await handler.handle(pointsCreditedPayload, null, trx);
    expect(uploader.calls).toHaveLength(0);
    expect(ops).toEqual([]);
  });
});
