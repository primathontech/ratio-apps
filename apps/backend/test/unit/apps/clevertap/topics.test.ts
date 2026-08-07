import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLEVERTAP_WEBHOOK_EVENT_NAMES } from '@ratio-app/shared/constants/clevertap-events';
import { describe, expect, it } from 'vitest';
import { ClevertapAppUninstalledHandler } from '../../../../src/modules/clevertap/webhooks/app-uninstalled.handler';
import { ClevertapCustomerCreatedHandler } from '../../../../src/modules/clevertap/webhooks/customer-created.handler';
import { ClevertapCustomerUpdatedHandler } from '../../../../src/modules/clevertap/webhooks/customer-updated.handler';
import { ClevertapLoyaltyPointsCreditedHandler } from '../../../../src/modules/clevertap/webhooks/loyalty-points-credited.handler';
import { ClevertapLoyaltyPointsDebitedHandler } from '../../../../src/modules/clevertap/webhooks/loyalty-points-debited.handler';
import { ClevertapOrderCancelledHandler } from '../../../../src/modules/clevertap/webhooks/order-cancelled.handler';
import { ClevertapOrderCreatedHandler } from '../../../../src/modules/clevertap/webhooks/order-created.handler';
import { ClevertapOrderFulfilledHandler } from '../../../../src/modules/clevertap/webhooks/order-fulfilled.handler';
import { ClevertapOrderPaidHandler } from '../../../../src/modules/clevertap/webhooks/order-paid.handler';
import { ClevertapOrderPartiallyFulfilledHandler } from '../../../../src/modules/clevertap/webhooks/order-partially-fulfilled.handler';
import { ClevertapOrderUpdatedHandler } from '../../../../src/modules/clevertap/webhooks/order-updated.handler';
import { ClevertapProductCreatedHandler } from '../../../../src/modules/clevertap/webhooks/product-created.handler';
import { ClevertapProductDeletedHandler } from '../../../../src/modules/clevertap/webhooks/product-deleted.handler';
import { ClevertapProductUpdatedHandler } from '../../../../src/modules/clevertap/webhooks/product-updated.handler';
import { ClevertapReviewCreatedHandler } from '../../../../src/modules/clevertap/webhooks/review-created.handler';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';

// biome-ignore lint/suspicious/noExplicitAny: only `.topic` is exercised here
const noDeps = null as any;
const HANDLERS = [
  new ClevertapAppUninstalledHandler(noDeps),
  new ClevertapOrderPaidHandler(noDeps),
  new ClevertapOrderCreatedHandler(noDeps),
  new ClevertapOrderCancelledHandler(noDeps),
  new ClevertapOrderFulfilledHandler(noDeps),
  new ClevertapOrderPartiallyFulfilledHandler(noDeps),
  new ClevertapOrderUpdatedHandler(noDeps),
  new ClevertapCustomerCreatedHandler(noDeps),
  new ClevertapCustomerUpdatedHandler(noDeps),
  new ClevertapLoyaltyPointsCreditedHandler(noDeps),
  new ClevertapLoyaltyPointsDebitedHandler(noDeps),
  new ClevertapReviewCreatedHandler(noDeps),
  new ClevertapProductCreatedHandler(noDeps),
  new ClevertapProductUpdatedHandler(noDeps),
  new ClevertapProductDeletedHandler(noDeps),
];

function stateWebhooks(): string[] {
  const path = join(__dirname, '../../../../../../docs/agent/apps/clevertap/STATE.json');
  const state = JSON.parse(readFileSync(path, 'utf8')) as { webhooks: string[] };
  return state.webhooks;
}

describe('CLEVERTAP_WEBHOOK_TOPICS', () => {
  it('declares exactly the fifteen topics, in slash form', () => {
    expect(Object.values(CLEVERTAP_WEBHOOK_TOPICS)).toEqual([
      'app/uninstalled',
      'orders/paid',
      'orders/create',
      'orders/cancelled',
      'orders/fulfilled',
      'orders/partially_fulfilled',
      'orders/updated',
      'customers/create',
      'customers/update',
      'loyalty/points_credited',
      'loyalty/points_debited',
      'reviews/create',
      'products/create',
      'products/update',
      'products/delete',
    ]);
  });

  it('matches STATE.json.webhooks exactly — no drift in either direction (R1)', () => {
    const declared = [...Object.values(CLEVERTAP_WEBHOOK_TOPICS)].sort();
    expect(declared).toEqual([...stateWebhooks()].sort());
  });

  it('uses slash separators and never the _template dot form', () => {
    for (const topic of Object.values(CLEVERTAP_WEBHOOK_TOPICS)) {
      expect(topic).toContain('/');
      expect(topic).not.toContain('.');
    }
  });

  it('keeps the platform underscore in orders/partially_fulfilled', () => {
    expect(CLEVERTAP_WEBHOOK_TOPICS.ordersPartiallyFulfilled).toBe('orders/partially_fulfilled');
  });
});

describe('handler topic registration', () => {
  it('every handler topic is a member of CLEVERTAP_WEBHOOK_TOPICS', () => {
    const known = new Set<string>(Object.values(CLEVERTAP_WEBHOOK_TOPICS));
    for (const handler of HANDLERS) {
      expect(known, `${handler.constructor.name} topic '${handler.topic}'`).toContain(
        handler.topic,
      );
    }
  });

  it('covers every declared topic with exactly one handler', () => {
    const topics = HANDLERS.map((h) => h.topic);
    expect(new Set(topics).size).toBe(topics.length);
    expect([...topics].sort()).toEqual([...Object.values(CLEVERTAP_WEBHOOK_TOPICS)].sort());
  });

  it('maps every order topic through the shared CLEVERTAP_WEBHOOK_EVENT_NAMES table', () => {
    const orderTopics = Object.values(CLEVERTAP_WEBHOOK_TOPICS).filter((t) =>
      t.startsWith('orders/'),
    );
    const orderEventNameKeys = Object.keys(CLEVERTAP_WEBHOOK_EVENT_NAMES).filter((t) =>
      t.startsWith('orders/'),
    );
    expect(orderEventNameKeys.sort()).toEqual([...orderTopics].sort());
  });
});
