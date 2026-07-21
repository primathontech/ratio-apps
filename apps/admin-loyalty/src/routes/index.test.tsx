import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { DashboardPage } from './index';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

const summary = {
  pointsIssued: 12000,
  pointsRedeemed: 3000,
  pointsExpired: 500,
  redemptionRate: 25,
  customersWithBalance: 340,
  outstandingPoints: 9000,
  liabilityInr: 900,
};

function routeApi(opts: { trend?: unknown[] } = {}) {
  mockedApi.mockImplementation((_method: string, path: string) => {
    if (path.startsWith('/api/dashboard/summary')) return Promise.resolve(summary);
    if (path.startsWith('/api/dashboard/trend'))
      return Promise.resolve(
        opts.trend ?? [
          { date: '2026-07-01', pointsIssued: 100, pointsRedeemed: 20, pointsExpired: 0 },
          { date: '2026-07-02', pointsIssued: 200, pointsRedeemed: 40, pointsExpired: 0 },
        ],
      );
    if (path.startsWith('/api/dashboard/rules')) return Promise.resolve([]);
    if (path.startsWith('/api/dashboard/qr')) return Promise.resolve([]);
    if (path.startsWith('/api/dashboard/bulk'))
      return Promise.resolve({ bulkCredited: 0, bulkDebited: 0, operations: 0 });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('DashboardPage', () => {
  it('renders the summary tiles from the summary API', async () => {
    routeApi();
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Coins issued')).toBeInTheDocument());
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders the trend chart when there is activity', async () => {
    routeApi();
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId('trend-chart')).toBeInTheDocument());
  });

  it('shows the empty trend state when there is no activity', async () => {
    routeApi({ trend: [] });
    renderWithProviders(<DashboardPage />);
    await waitFor(() =>
      expect(screen.getByText('No coin activity in this period')).toBeInTheDocument(),
    );
  });

  it('refetches when a different period is picked', async () => {
    routeApi();
    renderWithProviders(<DashboardPage />);
    await screen.findByText('Coins issued');
    const before = mockedApi.mock.calls.filter((c) =>
      String(c[1]).startsWith('/api/dashboard/summary'),
    ).length;
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => {
      const after = mockedApi.mock.calls.filter((c) =>
        String(c[1]).startsWith('/api/dashboard/summary'),
      ).length;
      expect(after).toBeGreaterThan(before);
    });
  });
});
