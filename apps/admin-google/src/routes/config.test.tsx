import type { GoogleConfig } from '@shared/schemas/google-config';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ConfigPage } from './config';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

function makeConfig(overrides: Partial<GoogleConfig> = {}): GoogleConfig {
  return {
    connectionMethod: 'manual',
    googleAccountEmail: null,
    hasGmcKey: false,
    needsReconnect: false,
    ga4Enabled: true,
    ga4MeasurementId: 'G-ABCDE12345',
    ga4PixelStatus: 'active',
    adsEnabled: false,
    adsConversionId: null,
    adsConversionLabel: null,
    adsPixelStatus: 'disabled',
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

function routeApi(config: GoogleConfig) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/google-config' && method === 'GET') return Promise.resolve(config);
    if (path === '/api/google-config' && method === 'PUT') return Promise.resolve(config);
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConfigForm', () => {
  it('renders GA4, Ads and GMC fields', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await waitFor(() => expect(screen.getByText('Google Analytics 4')).toBeInTheDocument());
    expect(screen.getByText('Google Ads')).toBeInTheDocument();
    expect(screen.getByText('Google Merchant Center')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('G-XXXXXXXXXX')).toBeInTheDocument();
  });

  it('shows the "configured" hint for the secret field when hasGmcKey and keeps it empty', async () => {
    routeApi(makeConfig({ hasGmcKey: true }));
    renderWithProviders(<ConfigPage />);
    await waitFor(() => expect(screen.getByText(/Key configured/)).toBeInTheDocument());
    const textarea = screen.getByPlaceholderText(/service_account/) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  it('shows a client validation error for a malformed GA4 id', async () => {
    routeApi(makeConfig({ ga4MeasurementId: '' }));
    renderWithProviders(<ConfigPage />);
    const input = await screen.findByPlaceholderText('G-XXXXXXXXXX');
    fireEvent.change(input, { target: { value: 'BAD-ID' } });
    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));
    await waitFor(() =>
      expect(screen.getByText(/Measurement ID must look like/)).toBeInTheDocument(),
    );
  });

  it('submits PUT without gmcServiceAccountKey when the secret textarea is empty', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('G-XXXXXXXXXX');
    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/google-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect('gmcServiceAccountKey' in body).toBe(false);
      expect(body.ga4MeasurementId).toBe('G-ABCDE12345');
    });
  });
});
