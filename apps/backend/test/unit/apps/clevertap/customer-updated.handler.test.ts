import { describe, expect, it } from 'vitest';
import { ClevertapForwardingService } from '../../../../src/modules/clevertap/events/forwarding.service';
import { ClevertapCustomerUpdatedHandler } from '../../../../src/modules/clevertap/webhooks/customer-updated.handler';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';
import {
  type ClevertapConfigRowFake,
  makeFakeCrypto,
  makeFakeTrx,
  makeFakeUploader,
} from './helpers/fake-forwarding-trx';
import {
  customersCreatePayload,
  customersUpdatePayload,
  customersUpdateStringConsentPayload,
} from './helpers/fixtures/customer-payloads';
import { CLEVERTAP_TEST_MERCHANT_ID } from './helpers/fixtures/envelopes';

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
  return { ...fake, uploader, handler: new ClevertapCustomerUpdatedHandler(forwarding) };
}

describe('ClevertapCustomerUpdatedHandler', () => {
  it('subscribes to the customers/update topic', () => {
    expect(harness().handler.topic).toBe(CLEVERTAP_WEBHOOK_TOPICS.customersUpdate);
    expect(harness().handler.topic).toBe('customers/update');
  });

  it('includes email_marketing_consent and sms_marketing_consent when present', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(customersUpdatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    expect(uploader.calls[0]?.records[0]?.profileData).toMatchObject({
      'MSG-email': true,
      'MSG-sms': false,
    });
  });

  it('propagates an SMS opt-OUT as the boolean false, not a missing key', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(customersUpdatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    const profile = uploader.calls[0]?.records[0]?.profileData ?? {};
    expect(Object.hasOwn(profile, 'MSG-sms')).toBe(true);
    expect(profile['MSG-sms']).toBe(false);
  });

  it('handles the string consent encoding as well as booleans', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(customersUpdateStringConsentPayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(uploader.calls[0]?.records[0]?.profileData).toMatchObject({
      'MSG-email': true,
      'MSG-sms': false,
    });
  });

  it('OMITS consent keys when the payload has none — never opts a subscriber out', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(customersCreatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    const profile = uploader.calls[0]?.records[0]?.profileData ?? {};
    expect(Object.hasOwn(profile, 'MSG-email')).toBe(false);
    expect(Object.hasOwn(profile, 'MSG-sms')).toBe(false);
  });

  it('records the row as Customer Updated keyed on the customer id', async () => {
    const { handler, trx, rows } = harness();
    await handler.handle(customersUpdatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(rows[0]).toMatchObject({
      topic: 'customers/update',
      clevertapEvent: 'Customer Updated',
      idempotencyKey: 'customers/update:cus_501',
      status: 'sent',
    });
  });

  it('does not collide with the customers/create key for the same customer', async () => {
    const { handler, trx, rows } = harness();
    await handler.handle(customersUpdatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(rows[0]?.idempotencyKey).not.toBe('customers/create:cus_501');
  });

  it('is inert-safe: no throw and no call for the empty resource core produces today', async () => {
    const { handler, trx, uploader } = harness();
    await expect(handler.handle({}, CLEVERTAP_TEST_MERCHANT_ID, trx)).resolves.toBeUndefined();
    expect(uploader.calls).toHaveLength(0);
  });

  it('is a no-op for an unknown merchant', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(customersUpdatePayload, null, trx);
    expect(uploader.calls).toHaveLength(0);
  });
});
