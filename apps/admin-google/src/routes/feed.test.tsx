import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { FeedPage } from './feed';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('FeedDetails', () => {
  it('renders item rows, status filter and history', async () => {
    mockedApi.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/api/feed/items')) {
        return Promise.resolve({
          items: [
            {
              offerId: 'off-1',
              productId: 'prod-1',
              variantId: null,
              title: 'Blue Shirt',
              status: 'SYNCED',
              hasGtin: true,
              issue: null,
              lastSyncedAt: '2026-06-08T10:00:00.000Z',
            },
            {
              offerId: 'off-2',
              productId: 'prod-2',
              variantId: 'v-2',
              title: 'Red Hat',
              status: 'ERROR',
              hasGtin: false,
              issue: 'Missing image',
              lastSyncedAt: null,
            },
          ],
          total: 2,
        });
      }
      if (path === '/api/feed/history') {
        return Promise.resolve([
          {
            syncType: 'reconcile',
            productsChecked: 10,
            productsUpdated: 2,
            productsErrored: 0,
            detail: null,
            createdAt: '2026-06-08T09:00:00.000Z',
          },
        ]);
      }
      return Promise.resolve({});
    });

    renderWithProviders(<FeedPage />);
    await waitFor(() => expect(screen.getByText('Blue Shirt')).toBeInTheDocument());
    expect(screen.getByText('Red Hat')).toBeInTheDocument();
    expect(screen.getByText('Missing image')).toBeInTheDocument();
    expect(screen.getByText('SYNCED')).toBeInTheDocument();
    expect(screen.getByText('reconcile')).toBeInTheDocument();
  });

  it('renders an empty state when there are no items', async () => {
    mockedApi.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/api/feed/items')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      if (path === '/api/feed/history') return Promise.resolve([]);
      return Promise.resolve({});
    });

    renderWithProviders(<FeedPage />);
    await waitFor(() => expect(screen.getByText('No sync runs yet')).toBeInTheDocument());
    expect(screen.getByText('No feed items')).toBeInTheDocument();
  });
});
