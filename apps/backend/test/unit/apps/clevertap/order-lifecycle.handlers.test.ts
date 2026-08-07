import type { Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../../src/core/webhooks/webhooks.types';
import { ClevertapForwardingService } from '../../../../src/modules/clevertap/events/forwarding.service';
import { ClevertapOrderCancelledHandler } from '../../../../src/modules/clevertap/webhooks/order-cancelled.handler';
import { ClevertapOrderFulfilledHandler } from '../../../../src/modules/clevertap/webhooks/order-fulfilled.handler';
import { ClevertapOrderPartiallyFulfilledHandler } from '../../../../src/modules/clevertap/webhooks/order-partially-fulfilled.handler';
import { ClevertapOrderUpdatedHandler } from '../../../../src/modules/clevertap/webhooks/order-updated.handler';
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
  ordersCancelledPayload,
  ordersFulfilledPayload,
  ordersPartiallyFulfilledPayload,
  ordersUpdatedPayload,
} from './helpers/fixtures/order-payloads';

const CONFIG: ClevertapConfigRowFake = {
  merchantId: CLEVERTAP_TEST_MERCHANT_ID,
  accountId: 'ACCT-123',
  passcodeEnc: 'enc:passcode',
  region: 'in1',
  serverEventsEnabled: true,
};

type Trx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;
type Ctor = new (forwarding: ClevertapForwardingService) => WebhookHandler;

const CASES: [
  name: string,
  Ctor: Ctor,
  topic: string,
  event: string,
  payload: Record<string, unknown>,
][] = [
  [
    'ClevertapOrderCancelledHandler',
    ClevertapOrderCancelledHandler,
    CLEVERTAP_WEBHOOK_TOPICS.ordersCancelled,
    'Order Cancelled',
    ordersCancelledPayload,
  ],
  [
    'ClevertapOrderFulfilledHandler',
    ClevertapOrderFulfilledHandler,
    CLEVERTAP_WEBHOOK_TOPICS.ordersFulfilled,
    'Order Fulfilled',
    ordersFulfilledPayload,
  ],
  [
    'ClevertapOrderPartiallyFulfilledHandler',
    ClevertapOrderPartiallyFulfilledHandler,
    CLEVERTAP_WEBHOOK_TOPICS.ordersPartiallyFulfilled,
    'Order Partially Fulfilled',
    ordersPartiallyFulfilledPayload,
  ],
  [
    'ClevertapOrderUpdatedHandler',
    ClevertapOrderUpdatedHandler,
    CLEVERTAP_WEBHOOK_TOPICS.ordersUpdated,
    'Order Updated',
    ordersUpdatedPayload,
  ],
];

function harness(Ctor: Ctor) {
  const fake = makeFakeTrx({ config: CONFIG });
  const uploader = makeFakeUploader();
  const forwarding = new ClevertapForwardingService(makeFakeCrypto(), () => uploader);
  return { ...fake, uploader, handler: new Ctor(forwarding) };
}

describe('order lifecycle handlers (A10)', () => {
  it.each(CASES)('%s subscribes to %s', (_name, Ctor, topic) => {
    expect(harness(Ctor).handler.topic).toBe(topic);
  });

  it.each(CASES)('%s forwards "%s" for its topic', async (_name, Ctor, topic, event, payload) => {
    const { handler, trx, uploader, rows } = harness(Ctor);
    await handler.handle(payload, CLEVERTAP_TEST_MERCHANT_ID, trx as Trx);

    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0]?.records[0]?.evtName).toBe(event);
    expect(rows[0]).toMatchObject({
      topic,
      clevertapEvent: event,
      idempotencyKey: `${topic}:${ORDER_ID}`,
      status: 'sent',
    });
  });

  it.each(CASES)('%s sends the RUPEE Amount unscaled', async (_name, Ctor, _t, _e, payload) => {
    const { handler, trx, uploader } = harness(Ctor);
    await handler.handle(payload, CLEVERTAP_TEST_MERCHANT_ID, trx as Trx);
    expect(uploader.calls[0]?.records[0]?.evtData?.Amount).toBe(ORDER_TOTAL_RUPEES);
  });

  it.each(CASES)('%s never emits Charged', async (_name, Ctor, _topic, _event, payload) => {
    const { handler, trx, uploader } = harness(Ctor);
    await handler.handle(payload, CLEVERTAP_TEST_MERCHANT_ID, trx as Trx);
    expect(JSON.stringify(uploader.calls)).not.toContain('Charged');
  });

  it.each(CASES)('%s is a no-op for an unknown merchant', async (_name, Ctor, _t, _e, payload) => {
    const { handler, trx, uploader } = harness(Ctor);
    await handler.handle(payload, null, trx as Trx);
    expect(uploader.calls).toHaveLength(0);
  });

  it('the four handlers cover four DISTINCT topics (no copy-paste collision)', () => {
    const topics = CASES.map(([, Ctor]) => harness(Ctor).handler.topic);
    expect(new Set(topics).size).toBe(4);
  });
});
