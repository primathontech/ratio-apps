import type { GoogleConfig } from '@shared/schemas/google-config';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ConfigPage } from './config';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

function makeConfig(overrides: Partial<GoogleConfig> = {}): GoogleConfig {
  return {
    connectionMethod: 'oauth',
    googleAccountEmail: 'dev@example.com',
    hasGmcKey: false,
    needsReconnect: false,
    ga4Enabled: true,
    ga4MeasurementId: null,
    ga4PixelStatus: 'active',
    adsEnabled: false,
    adsConversionId: null,
    adsConversionLabel: null,
    adsPixelStatus: 'disabled',
    enhancedConversionsEnabled: true,
    gmcEnabled: false,
    gmcMerchantId: null,
    gmcStoreUrl: null,
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

const DEFAULT_DISCOVER = {
  ga4: { streams: [{ measurementId: 'G-AUTO123' }] },
  gmc: { accounts: [{ merchantId: '7654321' }] },
};

function routeApi(config: GoogleConfig, discover: unknown = DEFAULT_DISCOVER) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/google-config' && method === 'GET') return Promise.resolve(config);
    if (path === '/api/google-config' && method === 'PUT') return Promise.resolve(config);
    if (path === '/api/discover' && method === 'GET') {
      return Promise.resolve(discover);
    }
    if (path === '/api/defaults') {
      return Promise.resolve({
        targetCountries: ['IN', 'US'],
        languages: ['en', 'hi'],
        currencies: ['INR', 'USD'],
        conditions: ['new', 'refurbished', 'used'],
      });
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
  window.history.pushState({}, '', '/config?connected=1');
});

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

describe('ConfigForm OAuth auto-fill on return from connect', () => {
  it('pre-fills empty GA4 and GMC ids from discovery when connected=1', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);

    await waitFor(() => {
      const ga4 = screen.getByPlaceholderText('G-XXXXXXXXXX') as HTMLInputElement;
      expect(ga4.value).toBe('G-AUTO123');
    });

    const gmc = screen.getByPlaceholderText('123456789') as HTMLInputElement;
    expect(gmc.value).toBe('7654321');
  });

  it('hides the service-account key + Test connection for an OAuth merchant', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);

    await waitFor(() =>
      expect(screen.getByText(/Authorized via your connected Google account/)).toBeInTheDocument(),
    );
    expect(screen.queryByPlaceholderText(/service_account/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Test connection/ })).not.toBeInTheDocument();
  });

  it('auto-saves the detected single-candidate ids (PUT) without a manual Save', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);

    await waitFor(() => {
      const put = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === '/api/google-config');
      expect(put).toBeDefined();
      const body = put?.[2] as Record<string, unknown>;
      expect(body.ga4MeasurementId).toBe('G-AUTO123');
      expect(body.gmcMerchantId).toBe('7654321');
    });
  });

  it('shows an info note when discovery finds no GA4 property or Merchant Center account', async () => {
    routeApi(makeConfig(), { ga4: { streams: [] }, gmc: { accounts: [] } });
    renderWithProviders(<ConfigPage />);

    await waitFor(() => expect(screen.getByText(/No GA4 property found/)).toBeInTheDocument());
    expect(screen.getByText(/No Merchant Center account found/)).toBeInTheDocument();
    // OAuth connected but no MC found → the service-account key fallback must be
    // available (not hidden behind the "no key needed" note).
    expect(screen.getByPlaceholderText(/service_account/)).toBeInTheDocument();
    expect(screen.queryByText(/no service-account key needed/)).not.toBeInTheDocument();
  });
});
