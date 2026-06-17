import type { GoogleConfig } from '@shared/schemas/google-config';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { Overview } from './index';

vi.mock('@/lib/api');
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  };
});

const mockedApi = vi.mocked(api);

function makeConfig(overrides: Partial<GoogleConfig> = {}): GoogleConfig {
  return {
    connectionMethod: 'oauth',
    googleAccountEmail: 'shop@example.com',
    hasGmcKey: true,
    needsReconnect: false,
    ga4Enabled: true,
    ga4MeasurementId: 'G-ABCDE12345',
    ga4PixelStatus: 'active',
    adsEnabled: true,
    adsConversionId: 'AW-123456',
    adsConversionLabel: 'lbl',
    adsPixelStatus: 'pending_api',
    enhancedConversionsEnabled: true,
    gmcEnabled: true,
    gmcMerchantId: '987654',
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
  mockedApi.mockImplementation((_method: string, path: string) => {
    if (path === '/api/google-config') return Promise.resolve(config);
    if (path === '/api/feed/summary') {
      return Promise.resolve({
        synced: 12,
        warnings: 3,
        errors: 1,
        pending: 0,
        lastSyncAt: '2026-06-08T10:00:00.000Z',
      });
    }
    if (path === '/api/feed/sync') return Promise.resolve({ started: true });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('Dashboard', () => {
  it('renders the three cards reflecting statuses', async () => {
    routeApi(makeConfig());
    renderWithProviders(<Overview />);
    await waitFor(() => expect(screen.getByText('Google Analytics 4')).toBeInTheDocument());
    expect(screen.getByText('Google Ads')).toBeInTheDocument();
    expect(screen.getByText('Merchant Center')).toBeInTheDocument();
    expect(screen.getByText('G-ABCDE12345')).toBeInTheDocument();
    expect(screen.getAllByText('Configured').length).toBeGreaterThan(0);
  });

  it('Force Sync triggers POST /api/feed/sync', async () => {
    routeApi(makeConfig());
    renderWithProviders(<Overview />);
    const btn = await screen.findByRole('button', { name: /Force Sync Now/ });
    fireEvent.click(btn);
    await waitFor(() => {
      const syncCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/feed/sync',
      );
      expect(syncCall).toBeDefined();
    });
  });

  it('shows the reconnect alert when needsReconnect is true', async () => {
    routeApi(makeConfig({ needsReconnect: true }));
    renderWithProviders(<Overview />);
    await waitFor(() =>
      expect(screen.getByText(/Google connection needs attention/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Reconnect Google/)).toBeInTheDocument();
  });
});
