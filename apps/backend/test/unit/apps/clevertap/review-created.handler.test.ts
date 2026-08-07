import { describe, expect, it } from 'vitest';
import { ClevertapForwardingService } from '../../../../src/modules/clevertap/events/forwarding.service';
import { ClevertapReviewCreatedHandler } from '../../../../src/modules/clevertap/webhooks/review-created.handler';
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

const REVIEW_ID = 'rev_17810776574055715';
const REVIEW_RATING = 5;
const REVIEW_PRODUCT_ID = 'prod_10155084972338';
const REVIEW_PRODUCT_TITLE = 'Cotton T-Shirt';
const REVIEW_EXPECTED_IDENTITY = '+919800000000';

const reviewCreatedPayload: Record<string, unknown> = {
  id: REVIEW_ID,
  event_type: 'reviews/create',
  rating: REVIEW_RATING,
  title: 'Great fit',
  body: 'Loved the fabric.',
  product_id: REVIEW_PRODUCT_ID,
  product_title: REVIEW_PRODUCT_TITLE,
  phone: REVIEW_EXPECTED_IDENTITY,
  email: 'buyer@example.com',
  customer: null,
  customer_id: null,
  created_at: '2026-06-10T08:30:00.000Z',
  updated_at: '2026-06-10T08:30:05.000Z',
};

function harness() {
  const fake = makeFakeTrx({ config: CONFIG });
  const uploader = makeFakeUploader();
  const forwarding = new ClevertapForwardingService(makeFakeCrypto(), () => uploader);
  return { ...fake, uploader, handler: new ClevertapReviewCreatedHandler(forwarding) };
}

describe('ClevertapReviewCreatedHandler', () => {
  it('subscribes to the reviews/create topic', () => {
    expect(harness().handler.topic).toBe(CLEVERTAP_WEBHOOK_TOPICS.reviewsCreate);
    expect(harness().handler.topic).toBe('reviews/create');
  });

  it('forwards Review Submitted via the client', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(reviewCreatedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0]?.records[0]?.evtName).toBe('Review Submitted');
  });

  it('carries the rating, product id/title, and review id as event properties', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(reviewCreatedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    const evtData = uploader.calls[0]?.records[0]?.evtData ?? {};
    expect(evtData['Review ID']).toBe(REVIEW_ID);
    expect(evtData.Rating).toBe(REVIEW_RATING);
    expect(evtData['Product ID']).toBe(REVIEW_PRODUCT_ID);
    expect(evtData['Product name']).toBe(REVIEW_PRODUCT_TITLE);
  });

  it('identifies the reviewer by the TOP-LEVEL +91 phone', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(reviewCreatedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(uploader.calls[0]?.records[0]?.identity).toBe(REVIEW_EXPECTED_IDENTITY);
  });

  it('records a sent row keyed `reviews/create:<review id>`', async () => {
    const { handler, trx, rows } = harness();
    await handler.handle(reviewCreatedPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(rows[0]).toMatchObject({
      idempotencyKey: `reviews/create:${REVIEW_ID}`,
      clevertapEvent: 'Review Submitted',
      status: 'sent',
    });
  });

  it('reads the review from the position core forwards, not the raw envelope', () => {
    const envelope = {
      event_type: 'reviews/create',
      merchant_id: CLEVERTAP_TEST_MERCHANT_ID,
      review: reviewCreatedPayload,
    };
    expect(envelope.review).toBe(reviewCreatedPayload);
  });

  it('is a no-op for an unknown merchant', async () => {
    const { handler, trx, uploader, ops } = harness();
    await handler.handle(reviewCreatedPayload, null, trx);
    expect(uploader.calls).toHaveLength(0);
    expect(ops).toEqual([]);
  });
});
