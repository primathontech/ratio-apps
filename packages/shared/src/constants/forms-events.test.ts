import { describe, expect, it } from 'vitest';
import {
  FORM_SUBMITTED_EVENT,
  FORM_SUBMITTED_SCHEMA_VERSION,
  FORMS_EMAIL_RETRY_DELAY_MS,
  FORMS_WEBHOOK_MAX_ATTEMPTS,
  FORMS_WEBHOOK_RETRY_DELAYS_MS,
  formSubmittedPayloadSchema,
} from './forms-events';

/** The documented `form.submitted` contract (PRD AC10) — golden payload. */
const goldenPayload = {
  event: 'form.submitted',
  merchant_id: 'mer_123',
  form_id: 'form_abc123',
  form_name: 'Contact us',
  submitted_at: '2026-07-14T10:15:30.000Z',
  submission_id: 'sub_xyz789',
  schema_version: '1.0',
  fields: {
    first_name: 'Jane',
    email: 'jane@example.com',
    interests: ['Apparel', 'Footwear'],
    attachment: 'https://s3.example/signed-url?expires=…',
  },
};

describe('formSubmittedPayloadSchema', () => {
  it('parses the golden payload', () => {
    const parsed = formSubmittedPayloadSchema.parse(goldenPayload);
    expect(parsed.event).toBe(FORM_SUBMITTED_EVENT);
    expect(parsed.schema_version).toBe(FORM_SUBMITTED_SCHEMA_VERSION);
    expect(parsed.fields.first_name).toBe('Jane');
  });

  it('rejects a wrong schema_version', () => {
    expect(
      formSubmittedPayloadSchema.safeParse({ ...goldenPayload, schema_version: '2.0' }).success,
    ).toBe(false);
  });

  it('rejects a wrong event name', () => {
    expect(
      formSubmittedPayloadSchema.safeParse({ ...goldenPayload, event: 'form.created' }).success,
    ).toBe(false);
  });

  it('rejects a non-ISO submitted_at', () => {
    expect(
      formSubmittedPayloadSchema.safeParse({ ...goldenPayload, submitted_at: 'yesterday' }).success,
    ).toBe(false);
  });
});

describe('retry/queue constants', () => {
  it('webhook retries at 5m / 20m / 1h', () => {
    expect(FORMS_WEBHOOK_RETRY_DELAYS_MS).toEqual([300_000, 1_200_000, 3_600_000]);
  });

  it('email retries once after 10 minutes', () => {
    expect(FORMS_EMAIL_RETRY_DELAY_MS).toBe(600_000);
  });

  it('webhook deliveries cap at 3 attempts', () => {
    expect(FORMS_WEBHOOK_MAX_ATTEMPTS).toBe(3);
  });
});
