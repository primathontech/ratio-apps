import { describe, expect, it } from 'vitest';
import {
  type GoogleDiscoverResponse,
  googleConfigInputSchema,
  googleDiscoverResponseSchema,
} from './google-config';

describe('google-config input schema', () => {
  it('applies India defaults when only the minimum is provided', () => {
    const parsed = googleConfigInputSchema.parse({});
    expect(parsed.connectionMethod).toBe('manual');
    expect(parsed.gmcTargetCountry).toBe('IN');
    expect(parsed.gmcContentLanguage).toBe('en');
    expect(parsed.gmcCurrency).toBe('INR');
    expect(parsed.gmcDefaultCondition).toBe('new');
    expect(parsed.gmcCategoryMode).toBe('default');
    expect(parsed.enhancedConversionsEnabled).toBe(true);
    expect(parsed.autoSyncEnabled).toBe(true);
    expect(parsed.freeListingsEnabled).toBe(true);
  });

  it('accepts a full valid config across all three integrations', () => {
    const result = googleConfigInputSchema.safeParse({
      connectionMethod: 'manual',
      ga4Enabled: true,
      ga4MeasurementId: 'G-ABC1234XYZ',
      adsEnabled: true,
      adsConversionId: 'AW-123456789',
      adsConversionLabel: 'abcDEF123',
      enhancedConversionsEnabled: true,
      gmcEnabled: true,
      gmcMerchantId: '1234567',
      gmcServiceAccountKey: '{"type":"service_account"}',
      gmcTargetCountry: 'IN',
      gmcContentLanguage: 'en',
      gmcCurrency: 'INR',
      gmcDefaultCondition: 'new',
      gmcCategoryMode: 'default',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a plain numeric Google Ads conversion id (no AW- prefix)', () => {
    expect(googleConfigInputSchema.safeParse({ adsConversionId: '987654321' }).success).toBe(true);
  });

  it.each([
    ['bad GA4 id', { ga4MeasurementId: 'GA-XXyy' }],
    ['bad Ads id', { adsConversionId: 'not-numeric' }],
    ['non-numeric GMC id', { gmcMerchantId: 'abc123' }],
    ['bad country code', { gmcTargetCountry: 'IND' }],
    ['bad language code', { gmcContentLanguage: 'eng' }],
    ['bad currency code', { gmcCurrency: 'rupee' }],
    ['bad condition enum', { gmcDefaultCondition: 'brand-new' }],
    ['bad category mode', { gmcCategoryMode: 'sometimes' }],
  ])('rejects %s', (_label, patch) => {
    expect(googleConfigInputSchema.safeParse(patch).success).toBe(false);
  });
});

describe('googleDiscoverResponseSchema', () => {
  it('parses a full discovery payload', () => {
    const value: GoogleDiscoverResponse = {
      ga4: {
        streams: [{ measurementId: 'G-ABC123', displayName: 'Web', property: 'properties/1' }],
      },
      gmc: { accounts: [{ merchantId: '1234567' }] },
    };
    expect(googleDiscoverResponseSchema.parse(value)).toEqual(value);
  });

  it('allows empty lists with an error reason', () => {
    const value = {
      ga4: { streams: [], error: 'oauth required' },
      gmc: { accounts: [], error: 'oauth required' },
    };
    expect(googleDiscoverResponseSchema.parse(value)).toEqual(value);
  });
});
