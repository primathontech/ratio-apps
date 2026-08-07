import { describe, expect, it } from 'vitest';
import { ClevertapForwardingService } from '../../../../src/modules/clevertap/events/forwarding.service';
import { ClevertapCustomerCreatedHandler } from '../../../../src/modules/clevertap/webhooks/customer-created.handler';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';
import {
  type ClevertapConfigRowFake,
  makeFakeCrypto,
  makeFakeTrx,
  makeFakeUploader,
} from './helpers/fake-forwarding-trx';
import {
  customersCreatePayload,
  customerWithoutContactPayload,
  customerWithoutIdPayload,
} from './helpers/fixtures/customer-payloads';
import {
  CLEVERTAP_TEST_MERCHANT_ID,
  makeCustomerEnvelope,
  makeCustomerEnvelopeAsDelivered,
} from './helpers/fixtures/envelopes';

const CONFIG: ClevertapConfigRowFake = {
  merchantId: CLEVERTAP_TEST_MERCHANT_ID,
  accountId: 'ACCT-123',
  passcodeEnc: 'enc:passcode',
  region: 'in1',
  serverEventsEnabled: true,
};

function harness(config: ClevertapConfigRowFake | undefined = CONFIG) {
  const fake = makeFakeTrx(config ? { config } : {});
  const uploader = makeFakeUploader();
  const forwarding = new ClevertapForwardingService(makeFakeCrypto(), () => uploader);
  return { ...fake, uploader, handler: new ClevertapCustomerCreatedHandler(forwarding) };
}

describe('ClevertapCustomerCreatedHandler', () => {
  it('subscribes to the customers/create topic', () => {
    expect(harness().handler.topic).toBe(CLEVERTAP_WEBHOOK_TOPICS.customersCreate);
    expect(harness().handler.topic).toBe('customers/create');
  });

  it('upserts a CleverTap profile (type: profile, not an event)', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(customersCreatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);

    const record = uploader.calls[0]?.records[0];
    expect(record?.type).toBe('profile');
    expect(record?.evtName).toBeUndefined();
    expect(record?.identity).toBe('+919876543210');
    expect(record?.profileData).toMatchObject({
      Phone: '+919876543210',
      Email: 'priya@example.com',
      Name: 'Priya Sharma',
    });
    expect(record?.profileData).not.toHaveProperty('Identity');
  });

  it('records the row as Customer Created keyed on the customer id', async () => {
    const { handler, trx, rows } = harness();
    await handler.handle(customersCreatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(rows[0]).toMatchObject({
      topic: 'customers/create',
      clevertapEvent: 'Customer Created',
      idempotencyKey: 'customers/create:cus_501',
      status: 'sent',
    });
  });

  it('omits consent keys entirely when the payload carries none', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(customersCreatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    const body = JSON.stringify(uploader.calls[0]?.records[0]?.profileData);
    expect(body).not.toContain('MSG-email');
    expect(body).not.toContain('MSG-sms');
  });

  it('is inert-safe: no throw and no call for a customer with no contact details', async () => {
    const { handler, trx, uploader } = harness();
    await expect(
      handler.handle(customerWithoutContactPayload, CLEVERTAP_TEST_MERCHANT_ID, trx),
    ).resolves.toBeUndefined();
    expect(uploader.calls).toHaveLength(0);
  });

  it('is inert-safe: no throw for a payload with no id', async () => {
    const { handler, trx, uploader } = harness();
    await expect(
      handler.handle(customerWithoutIdPayload, CLEVERTAP_TEST_MERCHANT_ID, trx),
    ).resolves.toBeUndefined();
    expect(uploader.calls).toHaveLength(0);
  });

  it('is inert-safe: degrades to a no-op on an empty resource', async () => {
    const { handler, trx, uploader } = harness();
    const delivered = makeCustomerEnvelopeAsDelivered('customers/create', customersCreatePayload);
    expect(delivered.customer).toBe(customersCreatePayload);
    await expect(handler.handle({}, CLEVERTAP_TEST_MERCHANT_ID, trx)).resolves.toBeUndefined();
    expect(uploader.calls).toHaveLength(0);
  });

  it('reads the customer from the resource position core will forward', () => {
    const envelope = makeCustomerEnvelope('customers/create', customersCreatePayload);
    expect(envelope.customer).toBe(customersCreatePayload);
  });

  it('respects the server-events skip switch like the order handlers', async () => {
    const { handler, trx, uploader, rows } = harness({ ...CONFIG, serverEventsEnabled: false });
    await handler.handle(customersCreatePayload, CLEVERTAP_TEST_MERCHANT_ID, trx);
    expect(uploader.calls).toHaveLength(0);
    expect(rows[0]?.status).toBe('skipped');
  });

  it('is a no-op for an unknown merchant', async () => {
    const { handler, trx, uploader } = harness();
    await handler.handle(customersCreatePayload, null, trx);
    expect(uploader.calls).toHaveLength(0);
  });
});
