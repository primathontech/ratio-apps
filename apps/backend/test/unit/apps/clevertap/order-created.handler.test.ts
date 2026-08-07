import { CLEVERTAP_CHARGED_EVENT } from '@ratio-app/shared/constants/clevertap-events';
import { describe, expect, it } from 'vitest';
import { ClevertapForwardingService } from '../../../../src/modules/clevertap/events/forwarding.service';
import { ClevertapOrderCreatedHandler } from '../../../../src/modules/clevertap/webhooks/order-created.handler';
import { ClevertapOrderPaidHandler } from '../../../../src/modules/clevertap/webhooks/order-paid.handler';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';
import {
  type ClevertapConfigRowFake,
  makeFakeCrypto,
  makeFakeTrx,
  makeFakeUploader,
} from './helpers/fake-forwarding-trx';
import { CLEVERTAP_TEST_MERCHANT_ID } from './helpers/fixtures/envelopes';
import {
  ORDER_ID,
  ORDER_TOTAL_RUPEES,
  ordersCreatePayload,
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
  return {
    ...fake,
    uploader,
    created: new ClevertapOrderCreatedHandler(forwarding),
    paidHandler: new ClevertapOrderPaidHandler(forwarding),
  };
}

describe('ClevertapOrderCreatedHandler', () => {
  it('subscribes to the orders/create topic', () => {
    expect(harness().created.topic).toBe(CLEVERTAP_WEBHOOK_TOPICS.ordersCreate);
    expect(harness().created.topic).toBe('orders/create');
  });

  it('forwards Order Created', async () => {
    const { created, trx, uploader } = harness();
    await created.handle(ordersCreatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(uploader.calls[0]?.records[0]?.evtName).toBe('Order Created');
  });

  it('NEVER emits Charged — not as the event name, not anywhere in the body', async () => {
    const { created, trx, uploader, rows } = harness();
    await created.handle(ordersCreatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    expect(uploader.calls[0]?.records[0]?.evtName).not.toBe(CLEVERTAP_CHARGED_EVENT);
    expect(uploader.calls[0]?.records[0]?.evtData).not.toHaveProperty('Charged ID');
    expect(JSON.stringify(uploader.calls)).not.toContain(CLEVERTAP_CHARGED_EVENT);
    expect(rows[0]?.clevertapEvent).not.toBe(CLEVERTAP_CHARGED_EVENT);
  });

  it('still sends the rupee Amount on the non-Charged event', async () => {
    const { created, trx, uploader } = harness();
    await created.handle(ordersCreatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(uploader.calls[0]?.records[0]?.evtData?.Amount).toBe(ORDER_TOTAL_RUPEES);
  });

  it('both topics firing for ONE order sends exactly one Charged and one Order Created', async () => {
    const { created, paidHandler, trx, uploader, rows } = harness();
    await created.handle(ordersCreatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    await paidHandler.handle(ordersPaidPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    const names = uploader.calls.map((c) => c.records[0]?.evtName);
    expect(names).toEqual(['Order Created', 'Charged']);
    expect(names.filter((n) => n === CLEVERTAP_CHARGED_EVENT)).toHaveLength(1);
    expect(rows.map((r) => r.idempotencyKey)).toEqual([
      `orders/create:${ORDER_ID}`,
      `orders/paid:${ORDER_ID}`,
    ]);
  });

  it('is a no-op for an unknown merchant', async () => {
    const { created, trx, uploader } = harness();
    await created.handle(ordersCreatePayload, null, trx);
    expect(uploader.calls).toHaveLength(0);
  });
});
