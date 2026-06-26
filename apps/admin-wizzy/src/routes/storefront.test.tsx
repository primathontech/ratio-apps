import type { Merchant } from '@shared/schemas/merchant';
import type { WizzyConfig } from '@shared/schemas/wizzy-config';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { StorefrontPage } from './storefront';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

function makeConfig(overrides: Partial<WizzyConfig> = {}): WizzyConfig {
  return {
    wizzyEnabled: true,
    storeId: 'my-store',
    hasStoreSecret: false,
    hasApiKey: false,
    needsReconnect: false,
    sdkUrl: 'https://cdn.wizzy.ai/sdk/v2/wizzy.min.js',
    storeUrl: null,
    scriptTagStatus: 'disabled',
    lastBulkSyncAt: null,
    autoSyncEnabled: true,
    includeOutOfStock: true,
    stripHtmlDescription: true,
    searchEnabled: false,
    inputSelector: '#search',
    resultsMountSelector: '#wizzy-results',
    resultsPagePath: '/search',
    themePrimary: '#0fb3a9',
    ...overrides,
  };
}

function makeMerchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: 'merchant-123',
    isActive: true,
    installedAt: new Date(),
    uninstalledAt: null,
    ...overrides,
  };
}

function routeApi(config: WizzyConfig, merchant: Merchant = makeMerchant()) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/wizzy-config' && method === 'GET') return Promise.resolve(config);
    if (path === '/api/wizzy-config' && method === 'PUT') return Promise.resolve(config);
    if (path === '/api/merchants/me' && method === 'GET') return Promise.resolve(merchant);
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

describe('StorefrontPage', () => {
  it('renders the copy-paste SDK snippet', async () => {
    routeApi(makeConfig());
    renderWithProviders(<StorefrontPage />);
    await waitFor(() => expect(screen.getByText('Storefront Search')).toBeInTheDocument());
    const snippet = await screen.findByText(/wizzy\/sdk\/wizzy-loader\.js/);
    expect(snippet.textContent).toContain('store=');
  });

  it('pre-fills storefront selector/path/theme inputs from config', async () => {
    routeApi(makeConfig());
    renderWithProviders(<StorefrontPage />);
    await waitFor(() => expect(screen.getByDisplayValue('#search')).toBeInTheDocument());
    expect(screen.getByDisplayValue('#wizzy-results')).toBeInTheDocument();
    expect(screen.getByDisplayValue('/search')).toBeInTheDocument();
    expect(screen.getByDisplayValue('#0fb3a9')).toBeInTheDocument();
  });

  it('renders an enable control bound to searchEnabled', async () => {
    routeApi(makeConfig({ searchEnabled: true }));
    renderWithProviders(<StorefrontPage />);
    const checkbox = (await screen.findByRole('checkbox')) as HTMLInputElement;
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it('saves the storefront fields via the PUT api', async () => {
    routeApi(makeConfig());
    renderWithProviders(<StorefrontPage />);
    await screen.findByDisplayValue('#search');
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/wizzy-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect(body.inputSelector).toBe('#search');
      expect(body.resultsMountSelector).toBe('#wizzy-results');
      expect(body.resultsPagePath).toBe('/search');
      expect(body.themePrimary).toBe('#0fb3a9');
      expect('searchEnabled' in body).toBe(true);
    });
  });
});
