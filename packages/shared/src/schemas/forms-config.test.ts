import { describe, expect, it } from 'vitest';
import { formsConfigInputSchema, formsConfigSchema } from './forms-config';

describe('formsConfigInputSchema (PUT body)', () => {
  it('accepts a full valid input', () => {
    const result = formsConfigInputSchema.safeParse({
      recaptchaSiteKey: '6LcSiteKeyExample',
      recaptchaSecret: '6LcSecretExample',
      recaptchaThreshold: 0.5,
      defaultNotificationEmail: 'owner@merchant.example',
      formsEnabled: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a blank optional secret (write-only: blank = keep stored)', () => {
    const result = formsConfigInputSchema.safeParse({ recaptchaSecret: '' });
    expect(result.success).toBe(true);
  });

  it('fills defaults: threshold 0.3, formsEnabled true', () => {
    const parsed = formsConfigInputSchema.parse({});
    expect(parsed.recaptchaThreshold).toBe(0.3);
    expect(parsed.formsEnabled).toBe(true);
    expect(parsed.recaptchaSecret).toBeUndefined();
  });

  it.each([
    ['threshold above 1', { recaptchaThreshold: 1.5 }],
    ['threshold below 0', { recaptchaThreshold: -0.1 }],
    ['invalid email', { defaultNotificationEmail: 'not-an-email' }],
    ['non-boolean formsEnabled', { formsEnabled: 'yes' }],
  ])('rejects %s', (_label, patch) => {
    expect(formsConfigInputSchema.safeParse(patch).success).toBe(false);
  });
});

describe('formsConfigSchema (GET shape)', () => {
  it('parses the redacted GET shape (hasRecaptchaSecret, never the secret)', () => {
    const parsed = formsConfigSchema.parse({
      recaptchaSiteKey: '6LcSiteKeyExample',
      recaptchaThreshold: 0.3,
      defaultNotificationEmail: 'owner@merchant.example',
      formsEnabled: true,
      hasRecaptchaSecret: true,
      emailBounced: false,
    });
    expect(parsed.hasRecaptchaSecret).toBe(true);
    expect('recaptchaSecret' in parsed).toBe(false);
  });

  it('strips a stray recaptchaSecret key instead of exposing it', () => {
    const parsed = formsConfigSchema.parse({
      recaptchaThreshold: 0.3,
      formsEnabled: true,
      hasRecaptchaSecret: true,
      emailBounced: false,
      recaptchaSecret: 'should-never-appear',
    } as Record<string, unknown>);
    expect(JSON.stringify(parsed)).not.toContain('should-never-appear');
  });

  it('emailBounced defaults to false', () => {
    const parsed = formsConfigSchema.parse({
      recaptchaThreshold: 0.3,
      formsEnabled: true,
      hasRecaptchaSecret: false,
    });
    expect(parsed.emailBounced).toBe(false);
  });

  it('requires hasRecaptchaSecret', () => {
    expect(
      formsConfigSchema.safeParse({ recaptchaThreshold: 0.3, formsEnabled: true }).success,
    ).toBe(false);
  });
});
