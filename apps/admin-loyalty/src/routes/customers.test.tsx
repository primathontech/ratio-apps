import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException, api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { CustomersPage } from './customers';

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

const profile = {
  profile: {
    merchantId: 'm1',
    phone: '9876543210',
    name: 'Asha Rao',
    email: 'asha@example.com',
    pointsBalance: 500,
    lifetimeEarned: 1200,
    lifetimeRedeemed: 700,
    lifetimeExpired: 0,
    lifetimeAdjusted: 0,
    lifetimeSpend: '54000.00',
    lifetimeOrders: 9,
    lastOrderAt: '2026-06-01T00:00:00.000Z',
    firstSeenSource: 'order',
    balanceSyncedAt: '2026-07-01T00:00:00.000Z',
  },
  balance: {
    phone: '9876543210',
    points_balance: 505,
    points_earned_lifetime: 1205,
    points_redeemed_lifetime: 700,
    points_expired_lifetime: 0,
    points_adjusted_lifetime: 0,
  },
  history: { items: [{ type: 'earn', points: 100 }], pagination: {} },
};

function routeApi(opts: { onAdjust?: () => Promise<unknown> } = {}) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && /\/api\/customers\/9876543210$/.test(path)) {
      return Promise.resolve(profile);
    }
    if (method === 'POST' && /\/adjust$/.test(path)) {
      return opts.onAdjust
        ? opts.onAdjust()
        : Promise.resolve({ direction: 'credit', points: 100, newBalance: 600 });
    }
    if (method === 'GET' && path.startsWith('/api/customers')) {
      return Promise.resolve({
        rows: [
          {
            merchantId: 'm1',
            phone: '9876543210',
            name: 'Asha Rao',
            email: null,
            pointsBalance: 500,
            lifetimeEarned: 1200,
            lifetimeRedeemed: 0,
            lifetimeExpired: 0,
            lifetimeAdjusted: 0,
            lifetimeSpend: '0.00',
            lifetimeOrders: 0,
            lastOrderAt: null,
            firstSeenSource: 'order',
            balanceSyncedAt: null,
          },
        ],
        total: 1,
      });
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

async function search() {
  fireEvent.change(screen.getByLabelText('Search phone'), { target: { value: '9876543210' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

describe('CustomersPage — search', () => {
  it('renders the profile with mirror and live Core balances', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
    await search();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(screen.getByText('500')).toBeInTheDocument(); // mirror balance
    expect(screen.getByText('505')).toBeInTheDocument(); // live Core balance
  });

  it('validates that the adjustment amount is positive', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
    await search();
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust coins' }));
    fireEvent.change(screen.getByLabelText('Adjustment points'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Adjustment reason'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.getByText('Points must be a positive number.')).toBeInTheDocument(),
    );
  });

  it('surfaces INSUFFICIENT_BALANCE on a debit', async () => {
    routeApi({
      onAdjust: () => Promise.reject(new ApiException('insufficient', 422, 'INSUFFICIENT_BALANCE')),
    });
    renderWithProviders(<CustomersPage />);
    await search();
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust coins' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Debit' }));
    fireEvent.change(screen.getByLabelText('Adjustment points'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Adjustment reason'), { target: { value: 'refund' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByText(/Insufficient balance/i)).toBeInTheDocument());
  });
});

describe('CustomersPage — leaderboard', () => {
  it('queries with the selected sort when toggled', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }));
    await waitFor(() =>
      expect(mockedApi.mock.calls.some((c) => String(c[1]).includes('sort=points_balance'))).toBe(
        true,
      ),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Lifetime earned' }));
    await waitFor(() =>
      expect(mockedApi.mock.calls.some((c) => String(c[1]).includes('sort=lifetime_earned'))).toBe(
        true,
      ),
    );
  });
});
