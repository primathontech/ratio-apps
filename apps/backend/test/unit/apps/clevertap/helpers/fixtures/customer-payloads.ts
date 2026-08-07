export const customersCreatePayload: Record<string, unknown> = {
  id: 'cus_501',
  phone: '9876543210',
  email: 'Priya@Example.com',
  first_name: 'Priya',
  last_name: 'Sharma',
  created_at: '2026-07-01T06:00:00.000Z',
  updated_at: '2026-07-01T06:00:00.000Z',
};

export const customersUpdatePayload: Record<string, unknown> = {
  ...customersCreatePayload,
  updated_at: '2026-07-24T10:30:00.000Z',
  email_marketing_consent: true,
  sms_marketing_consent: false,
};

export const customersUpdateStringConsentPayload: Record<string, unknown> = {
  ...customersCreatePayload,
  email_marketing_consent: 'subscribed',
  sms_marketing_consent: 'not_subscribed',
};

export const customerWithoutContactPayload: Record<string, unknown> = {
  id: 'cus_909',
  first_name: 'Anon',
};

export const customerWithoutIdPayload: Record<string, unknown> = {
  phone: '9876543210',
  email: 'nobody@example.com',
};
