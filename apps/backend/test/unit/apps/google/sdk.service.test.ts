import { describe, expect, it } from 'vitest';
import type { GoogleConfig } from '@ratio-app/shared/schemas/google-config';
import { GoogleSdkService } from '../../../../src/modules/google/sdk/sdk.service';

function config(overrides: Partial<GoogleConfig> = {}): GoogleConfig {
  return {
    connectionMethod: 'manual',
    googleAccountEmail: null,
    hasGmcKey: false,
    needsReconnect: false,
    ga4Enabled: true,
    ga4MeasurementId: 'G-TEST',
    ga4PixelStatus: 'pending_api',
    adsEnabled: true,
    adsConversionId: 'AW-123',
    adsConversionLabel: 'pl',
    adsPixelStatus: 'pending_api',
    enhancedConversionsEnabled: true,
    gmcEnabled: false,
    gmcMerchantId: null,
    gmcTargetCountry: 'IN',
    gmcContentLanguage: 'en',
    gmcCurrency: 'INR',
    gmcDefaultCondition: 'new',
    gmcBrandOverride: null,
    gmcGoogleProductCategory: null,
    gmcCategoryMode: 'default',
    autoSyncEnabled: true,
    hourlyReconcileEnabled: true,
    syncVariantsEnabled: true,
    includeOutOfStock: true,
    freeListingsEnabled: true,
    ...overrides,
  };
}

describe('GoogleSdkService.buildPrelude', () => {
  // buildPrelude is pure — construct with no deps.
  const svc = new GoogleSdkService(null as never, null as never);

  it('emits a window.__GOOGLE_RATIO_CONFIG__ global', () => {
    const out = svc.buildPrelude('m1', config());
    expect(out).toContain('window.__GOOGLE_RATIO_CONFIG__ =');
  });

  it('GA4 fans out (isolated:false) and Ads carries conversionId+label', () => {
    const out = svc.buildPrelude('m1', config());
    const json = JSON.parse(out.replace('window.__GOOGLE_RATIO_CONFIG__ =', '').replace(/;\s*$/, ''));
    expect(json.ga4).toEqual({ measurementId: 'G-TEST', isolated: false });
    expect(json.ads.conversionId).toBe('AW-123');
    expect(json.ads.conversionLabel).toBe('pl');
    expect(json.enhancedConversions).toBe(true);
  });

  it('omits GA4 when disabled and Ads when no conversion id', () => {
    const out = svc.buildPrelude('m1', config({ ga4Enabled: false, adsConversionId: null }));
    const json = JSON.parse(out.replace('window.__GOOGLE_RATIO_CONFIG__ =', '').replace(/;\s*$/, ''));
    expect(json.ga4).toBeNull();
    expect(json.ads).toBeNull();
  });

  it('reflects the enhanced-conversions toggle', () => {
    const out = svc.buildPrelude('m1', config({ enhancedConversionsEnabled: false }));
    const json = JSON.parse(out.replace('window.__GOOGLE_RATIO_CONFIG__ =', '').replace(/;\s*$/, ''));
    expect(json.enhancedConversions).toBe(false);
  });
});
