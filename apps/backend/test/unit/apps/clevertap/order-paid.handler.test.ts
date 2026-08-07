import { describe, expect, it } from 'vitest';
import { ClevertapForwardingService } from '../../../../src/modules/clevertap/events/forwarding.service';
import { ClevertapOrderPaidHandler } from '../../../../src/modules/clevertap/webhooks/order-paid.handler';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';
import {
  type ClevertapConfigRowFake,
  makeFakeCrypto,
  makeFakeTrx,
  makeFakeUploader,
} from './helpers/fake-forwarding-trx';
import { CLEVERTAP_TEST_MERCHANT_ID, makeEnvelope } from './helpers/fixtures/envelopes';
import {
  ORDER_EXPECTED_IDENTITY,
  ORDER_ID,
  ORDER_TOTAL_RUPEES,
  ordersPaidPayload,
} from './helpers/fixtures/order-payloads';

const CONFIG: ClevertapConfigRowFake = {
  merchantId: CLEVERTAP_TEST_MERCHANT_ID,
  accountId: 'ACCT-123',
  passcodeEnc: 'enc:passcode',
  region: 'in1',
  serverEventsEnabled: true,
};

function harness() {
  const fake = makeFakeTrx({ config: CONFIG });
  const uploader = makeFakeUploader();
  const forwarding = new ClevertapForwardingService(makeFakeCrypto(), () => uploader);
  return { ...fake, uploader, handler: new ClevertapOrderPaidHandler(forwarding) };
}

describe('ClevertapOrderPaidHandler', () => {
  it('subscribes to the orders/paid topic', () => {
    expect(harness().handler.topic).toBe(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid);
    expect(harness().handler.topic).toBe('orders/paid');
  });

  it('forwards Charged via the client', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(ordersPaidPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0]?.records[0]?.evtName).toBe('Charged');
  });

  it('carries the RUPEE Amount, the charge id, and Items[] (never scaled by 100)', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(ordersPaidPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    const evtData = uploader.calls[0]?.records[0]?.evtData ?? {};
    expect(evtData.Amount).toBe(ORDER_TOTAL_RUPEES);
    expect(evtData.Amount).toBe(1200);
    expect(evtData['Charged ID']).toBe(ORDER_ID);
    expect((evtData.Items as unknown[]).length).toBe(1);
  });

  it('identifies the shopper by the TOP-LEVEL +91 phone (customer is null)', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(ordersPaidPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(uploader.calls[0]?.records[0]?.identity).toBe(ORDER_EXPECTED_IDENTITY);
  });

  it('records a sent row keyed `orders/paid:<order id>`', async () => {
    const { handler, trx, rows } = harness();
    await handler.handle(ordersPaidPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(rows[0]).toMatchObject({
      idempotencyKey: `orders/paid:${ORDER_ID}`,
      clevertapEvent: 'Charged',
      status: 'sent',
    });
  });

  it('reads the order from the envelope position core forwards (`order`)', () => {
    const envelope = makeEnvelope('orders/paid', ordersPaidPayload);
    expect(envelope.order).toBe(ordersPaidPayload);
  });

  it('is a no-op for an unknown merchant', async () => {
    const { handler, trx, uploader, ops } = harness();
    await handler.handle(ordersPaidPayload, null, trx);
    expect(uploader.calls).toHaveLength(0);
    expect(ops).toEqual([]);
  });
});
