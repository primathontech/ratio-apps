import type { FormField } from '@ratio-app/shared/schemas/form-schema';
import type { Row } from './fake-db';

/**
 * Fixture factories (TDD §7): the minimal contact form, the kitchen-sink
 * form (all 8 field types + validations), the misconfigured empty-schema
 * form, and the merchant config row. All return plain DB-shaped rows for
 * the fake handle; override anything per test.
 */

export const MERCHANT_ID = 'm_1';
export const OTHER_MERCHANT_ID = 'm_other';

export const CONTACT_FORM_FIELDS: FormField[] = [
  { key: 'name', type: 'text', label: 'Name', required: true },
  { key: 'email', type: 'email', label: 'Email', required: true },
  {
    key: 'message',
    type: 'textarea',
    label: 'Message',
    required: false,
    validation: { maxLength: 5000 },
  },
];

export const KITCHEN_SINK_FIELDS: FormField[] = [
  {
    key: 'name',
    type: 'text',
    label: 'Name',
    required: true,
    validation: { minLength: 2, maxLength: 40, pattern: '^[A-Za-z ]+$' },
  },
  {
    key: 'bio',
    type: 'textarea',
    label: 'Bio',
    required: false,
    validation: { maxLength: 100 },
  },
  { key: 'email', type: 'email', label: 'Email', required: true },
  { key: 'phone', type: 'phone', label: 'Phone', required: true },
  { key: 'topic', type: 'dropdown', label: 'Topic', required: true, options: ['sales', 'support'] },
  {
    key: 'channels',
    type: 'multi_select',
    label: 'Channels',
    required: false,
    options: ['email', 'sms', 'whatsapp'],
  },
  { key: 'visit_date', type: 'date', label: 'Visit date', required: false },
  {
    key: 'resume',
    type: 'file',
    label: 'Resume',
    required: true,
    validation: { allowedMimeTypes: ['application/pdf'], maxBytes: 1024 * 1024 },
  },
];

export function contactForm(overrides: Row = {}): Row {
  return {
    id: 'form_contact',
    merchantId: MERCHANT_ID,
    name: 'Contact us',
    description: null,
    schemaJson: JSON.stringify(CONTACT_FORM_FIELDS),
    submitLabel: 'Submit',
    successMessage: 'Thanks!',
    spamProtection: 'honeypot',
    notificationEmail: null,
    webhookUrl: null,
    redirectUrl: null,
    status: 'active',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function kitchenSinkForm(overrides: Row = {}): Row {
  return contactForm({
    id: 'form_sink',
    name: 'Kitchen sink',
    schemaJson: JSON.stringify(KITCHEN_SINK_FIELDS),
    spamProtection: 'recaptcha',
    notificationEmail: 'forms@merchant.example',
    webhookUrl: 'https://hooks.merchant.example/forms',
    ...overrides,
  });
}

/** Misconfigured: an empty schema must not render (PRD 10.10.6). */
export function emptySchemaForm(overrides: Row = {}): Row {
  return contactForm({ id: 'form_empty', name: 'Empty', schemaJson: '[]', ...overrides });
}

export function configRow(overrides: Row = {}): Row {
  return {
    merchantId: MERCHANT_ID,
    recaptchaSiteKey: null,
    recaptchaSecretEnc: null,
    recaptchaThreshold: '0.30',
    defaultNotificationEmail: 'owner@merchant.example',
    emailBounced: false,
    formsEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function submissionRow(overrides: Row = {}): Row {
  return {
    id: 'sub_1',
    formId: 'form_contact',
    merchantId: MERCHANT_ID,
    dataJson: JSON.stringify({ name: 'Asha', email: 'asha@example.com', message: 'Hi' }),
    filesJson: null,
    recaptchaScore: null,
    idempotencyKey: 'key_1',
    createdAt: new Date('2026-02-01T10:00:00Z'),
    ...overrides,
  };
}

export function deliveryRow(overrides: Row = {}): Row {
  return {
    id: 1,
    submissionId: 'sub_1',
    formId: 'form_contact',
    merchantId: MERCHANT_ID,
    url: 'https://hooks.merchant.example/forms',
    status: 'pending',
    attempts: 0,
    lastStatusCode: null,
    nextRetryAt: new Date('2026-02-01T10:00:00Z'),
    createdAt: new Date('2026-02-01T10:00:00Z'),
    updatedAt: new Date('2026-02-01T10:00:00Z'),
    ...overrides,
  };
}

export function emailLogRow(overrides: Row = {}): Row {
  return {
    id: 1,
    submissionId: 'sub_1',
    merchantId: MERCHANT_ID,
    recipient: 'owner@merchant.example',
    status: 'pending',
    attempts: 0,
    nextRetryAt: new Date('2026-02-01T10:00:00Z'),
    createdAt: new Date('2026-02-01T10:00:00Z'),
    updatedAt: new Date('2026-02-01T10:00:00Z'),
    ...overrides,
  };
}
