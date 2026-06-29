import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { CatalogPage } from './catalog';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('CatalogDetails', () => {
  it('renders item rows, status filter and history', async () => {
    mockedApi.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/api/catalog/items')) {
        return Promise.resolve({
          items: [
            {
              id: 1,
              productId: 'prod-1',
              wizzyId: 'prod-1',
              title: 'Blue Shirt',
              status: 'SYNCED',
              issue: null,
              lastSyncedAt: '2026-06-08T10:00:00.000Z',
            },
            {
              id: 2,
              productId: 'prod-2',
              wizzyId: 'prod-2',
              title: 'Red Hat',
              status: 'ERROR',
              issue: 'Wizzy API error: 400',
              lastSyncedAt: null,
            },
          ],
          total: 2,
        });
      }
      if (path === '/api/catalog/history') {
        return Promise.resolve([
          {
            syncType: 'initial',
            productsChecked: 50,
            productsSynced: 48,
            productsErrored: 2,
            detail: null,
            createdAt: '2026-06-08T09:00:00.000Z',
          },
        ]);
      }
      return Promise.resolve({});
    });

    renderWithProviders(<CatalogPage />);
    await waitFor(() => expect(screen.getByText('Blue Shirt')).toBeInTheDocument());
    expect(screen.getByText('Red Hat')).toBeInTheDocument();
    expect(screen.getByText('Wizzy API error: 400')).toBeInTheDocument();
    expect(screen.getByText('SYNCED')).toBeInTheDocument();
    expect(screen.getByText('initial')).toBeInTheDocument();
  });

  it('renders an empty state when there are no items', async () => {
    mockedApi.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/api/catalog/items')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      if (path === '/api/catalog/history') return Promise.resolve([]);
      return Promise.resolve({});
    });

    renderWithProviders(<CatalogPage />);
    await waitFor(() => expect(screen.getByText('No sync runs yet')).toBeInTheDocument());
    expect(screen.getByText('No catalog items')).toBeInTheDocument();
  });
});
