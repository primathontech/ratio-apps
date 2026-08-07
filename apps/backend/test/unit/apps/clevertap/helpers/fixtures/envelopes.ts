import { createHmac } from 'node:crypto';

export const CLEVERTAP_TEST_MERCHANT_ID = 'mrc_clevertap_1';

export interface WebhookEnvelopeFixture extends Record<string, unknown> {
  event_type: string;
  merchant_id: string | null;
}

export function makeEnvelope(
  eventType: string,
  order: Record<string, unknown>,
  merchantId: string | null = CLEVERTAP_TEST_MERCHANT_ID,
): WebhookEnvelopeFixture {
  return { event_type: eventType, merchant_id: merchantId, order };
}

export function makeCustomerEnvelope(
  eventType: string,
  customer: Record<string, unknown>,
  merchantId: string | null = CLEVERTAP_TEST_MERCHANT_ID,
): WebhookEnvelopeFixture {
  return { event_type: eventType, merchant_id: merchantId, customer };
}

export function makeCustomerEnvelopeAsDelivered(
  eventType: string,
  customer: Record<string, unknown>,
  merchantId: string | null = CLEVERTAP_TEST_MERCHANT_ID,
): WebhookEnvelopeFixture {
  return { event_type: eventType, merchant_id: merchantId, customer };
}

export function makeLifecycleEnvelope(
  eventType: string,
  merchantId: string | null = CLEVERTAP_TEST_MERCHANT_ID,
): WebhookEnvelopeFixture {
  return { event_type: eventType, merchant_id: merchantId };
}

export function signEnvelope(
  body: unknown,
  secret: string,
): { rawBody: string; headers: Record<string, string> } {
  const rawBody = JSON.stringify(body);
  const hex = createHmac('sha256', secret).update(rawBody).digest('hex');
  return {
    rawBody,
    headers: {
      'x-ratio-hmac-sha256': hex,
      'x-openstore-signature': `sha256=${hex}`,
    },
  };
}

export function invalidSignatureHeaders(): Record<string, string> {
  const wrong = 'a'.repeat(64);
  return {
    'x-ratio-hmac-sha256': wrong,
    'x-openstore-signature': `sha256=${wrong}`,
  };
}
