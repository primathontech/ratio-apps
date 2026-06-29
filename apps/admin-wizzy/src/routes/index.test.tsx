import type { WizzyConfig } from '@shared/schemas/wizzy-config';
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

function makeConfig(overrides: Partial<WizzyConfig> = {}): WizzyConfig {
  return {
    wizzyEnabled: true,
    storeId: 'my-store',
    hasStoreSecret: true,
    hasApiKey: false,
    needsReconnect: false,
    storeUrl: null,
    lastBulkSyncAt: '2026-06-08T10:00:00.000Z',
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

function routeApi(config: WizzyConfig) {
  mockedApi.mockImplementation((_method: string, path: string) => {
    if (path === '/api/wizzy-config') return Promise.resolve(config);
    if (path === '/api/catalog/summary') {
      // Shape must match the backend CatalogQueryService.summary() response.
      return Promise.resolve({
        synced: 42,
        pending: 3,
        errors: 7,
        deleted: 0,
        lastSyncAt: '2026-06-08T10:00:00.000Z',
      });
    }
    if (path === '/api/catalog/sync') return Promise.resolve({ started: true });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('Dashboard', () => {
  it('renders catalog sync and storefront search cards', async () => {
    routeApi(makeConfig());
    renderWithProviders(<Overview />);
    await waitFor(() => expect(screen.getByText('Catalog Sync')).toBeInTheDocument());
    expect(screen.getByText('Storefront Search')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    // Errors stat must reflect the backend's `errors` field (regression: the
    // Overview previously read `error`/`lastBulkSyncAt`, so it always showed 0).
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('Force Sync triggers POST /api/catalog/sync', async () => {
    routeApi(makeConfig());
    renderWithProviders(<Overview />);
    const btn = await screen.findByRole('button', { name: /Force Sync Now/ });
    fireEvent.click(btn);
    await waitFor(() => {
      const syncCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/catalog/sync',
      );
      expect(syncCall).toBeDefined();
    });
  });

  it('shows reconnect alert when needsReconnect is true', async () => {
    routeApi(makeConfig({ needsReconnect: true }));
    renderWithProviders(<Overview />);
    await waitFor(() =>
      expect(screen.getByText(/Wizzy connection needs attention/)).toBeInTheDocument(),
    );
  });

  it('shows storefront search enabled status + manage link', async () => {
    routeApi(makeConfig({ searchEnabled: true }));
    renderWithProviders(<Overview />);
    await waitFor(() => expect(screen.getByText('Enabled')).toBeInTheDocument());
    expect(screen.getByText('Manage Storefront Search')).toBeInTheDocument();
  });
});
