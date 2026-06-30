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
    storeUrl: null,
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
  it('renders the storefront env-var install block', async () => {
    routeApi(makeConfig());
    renderWithProviders(<StorefrontPage />);
    await waitFor(() => expect(screen.getByText('Storefront Search')).toBeInTheDocument());
    const block = await screen.findByText(/NEXT_PUBLIC_WIZZY_MERCHANT_ID=/);
    expect(block.textContent).toContain('NEXT_PUBLIC_WIZZY_ENABLED=true');
    expect(block.textContent).toContain('merchant-123');
  });

  it('renders an enable control bound to searchEnabled', async () => {
    routeApi(makeConfig({ searchEnabled: true }));
    renderWithProviders(<StorefrontPage />);
    const checkbox = (await screen.findByRole('checkbox')) as HTMLInputElement;
    await waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it('saves the storefront search toggle via the PUT api', async () => {
    routeApi(makeConfig({ searchEnabled: true }));
    renderWithProviders(<StorefrontPage />);
    const checkbox = (await screen.findByRole('checkbox')) as HTMLInputElement;
    await waitFor(() => expect(checkbox.checked).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/wizzy-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect('searchEnabled' in body).toBe(true);
      expect(body.searchEnabled).toBe(true);
    });
  });
});
