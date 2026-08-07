import { describe, expect, it } from 'vitest';
import { ClevertapForwardingService } from '../../../../src/modules/clevertap/events/forwarding.service';
import { ClevertapLoyaltyPointsDebitedHandler } from '../../../../src/modules/clevertap/webhooks/loyalty-points-debited.handler';
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

const LOYALTY_TXN_ID = 'ltxn_3003';
const LOYALTY_EXPECTED_IDENTITY = '+919876543210';

const pointsDebitedPayload: Record<string, unknown> = {
  transaction_id: LOYALTY_TXN_ID,
  customer: { phone: '9876543210', email: 'shopper@example.com' },
  points_delta: 75,
  points_balance: 925,
  reason_code: 'redemption',
  timestamp: '2026-07-30T12:00:00Z',
};

function harness() {
  const fake = makeFakeTrx({ config: CONFIG });
  const uploader = makeFakeUploader();
  const forwarding = new ClevertapForwardingService(makeFakeCrypto(), () => uploader);
  return { ...fake, uploader, handler: new ClevertapLoyaltyPointsDebitedHandler(forwarding) };
}

describe('ClevertapLoyaltyPointsDebitedHandler', () => {
  it('subscribes to the loyalty/points_debited topic', () => {
    expect(harness().handler.topic).toBe(CLEVERTAP_WEBHOOK_TOPICS.loyaltyPointsDebited);
    expect(harness().handler.topic).toBe('loyalty/points_debited');
  });

  it('forwards Points Debited via the client', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(pointsDebitedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0]?.records[0]?.evtName).toBe('Points Debited');
    expect(uploader.calls[0]?.records[0]?.type).toBe('event');
  });

  it('carries the points delta and balance as event properties', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(pointsDebitedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    const evtData = uploader.calls[0]?.records[0]?.evtData ?? {};
    expect(evtData.Points).toBe(75);
    expect(evtData.Balance).toBe(925);
    expect(evtData['Transaction ID']).toBe(LOYALTY_TXN_ID);
  });

  it('identifies the shopper by the nested customer +91 phone', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(pointsDebitedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(uploader.calls[0]?.records[0]?.identity).toBe(LOYALTY_EXPECTED_IDENTITY);
  });

  it('records a sent row keyed `loyalty/points_debited:<txn id>`', async () => {
    const { handler, trx, rows } = harness();
    await handler.handle(pointsDebitedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(rows[0]).toMatchObject({
      idempotencyKey: `loyalty/points_debited:${LOYALTY_TXN_ID}`,
      clevertapEvent: 'Points Debited',
      status: 'sent',
    });
  });

  it('is a no-op for an unknown merchant', async () => {
    const { handler, trx, uploader, ops } = harness();
    await handler.handle(pointsDebitedPayload, null, trx);
    expect(uploader.calls).toHaveLength(0);
    expect(ops).toEqual([]);
  });
});
