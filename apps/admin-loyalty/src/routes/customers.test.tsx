import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

/**
 * The profile path the SPA now requests. The search box normalizes to E.164
 * before calling, so the phone arrives URL-encoded as `%2B919876543210` — that
 * is what makes `9876543210`, `+91 98765 43210` and `09876543210` all resolve
 * to the single customer the backend stores.
 */
const PROFILE_PATH_RE = /\/api\/customers\/%2B919876543210$/;

function routeApi(opts: { onAdjust?: () => Promise<unknown>; profileError?: ApiException } = {}) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && PROFILE_PATH_RE.test(path)) {
      return opts.profileError ? Promise.reject(opts.profileError) : Promise.resolve(profile);
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
            // The mirror stores E.164, so a leaderboard row already carries
            // the canonical phone the profile endpoint expects.
            phone: '+919876543210',
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

async function search(value = '9876543210') {
  fireEvent.change(screen.getByLabelText('Search phone'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

/**
 * The leaderboard renders alongside the lookup now, and it lists the same
 * customer — so profile assertions scope to the profile block rather than the
 * whole page.
 */
async function profileCard() {
  return within(await screen.findByTestId('customer-profile'));
}

describe('CustomersPage — search', () => {
  it('renders the profile with mirror and live Core balances', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
    await search();
    const profile = await profileCard();
    expect(profile.getByText('Asha Rao')).toBeInTheDocument();
    expect(profile.getByText('500')).toBeInTheDocument(); // mirror balance
    expect(profile.getByText('505')).toBeInTheDocument(); // live Core balance
  });

  it('normalizes any accepted phone format to the one stored customer', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
    await search('+91 98765-43210');
    expect((await profileCard()).getByText('Asha Rao')).toBeInTheDocument();
  });

  it('rejects an invalid phone against the search field without calling the API', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
    await search('1234567890');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/valid Indian mobile number/),
    );
    expect(mockedApi.mock.calls.filter((c) => String(c[1]).includes('/api/customers/'))).toEqual(
      [],
    );
  });

  it('requires a phone before searching', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a phone number to search.'),
    );
  });

  it('offers to credit a phone that is not in the mirror yet', async () => {
    // Pre-fix this was a dead end: a bare "customer not found" error with no
    // way to give a never-ordered customer coins.
    routeApi({
      profileError: new ApiException('customer not found', 404, 'CUSTOMER_NOT_FOUND'),
    });
    renderWithProviders(<CustomersPage />);
    await search();

    const openBtn = await screen.findByRole('button', { name: 'Credit or debit coins' });
    expect(screen.getByText(/Not in your loyalty program yet/)).toBeInTheDocument();

    fireEvent.click(openBtn);
    fireEvent.change(screen.getByLabelText('Adjustment points'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Adjustment reason'), {
      target: { value: 'Event giveaway' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      const call = mockedApi.mock.calls.find((c) => String(c[1]).includes('/adjust'));
      expect(call).toBeDefined();
      expect(String(call?.[1])).toContain('%2B919876543210');
      expect(call?.[2]).toEqual({
        direction: 'credit',
        points: 250,
        reason: 'Event giveaway',
      });
    });
  });

  it('reports each invalid adjustment field against that field', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
    await search();
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust coins' }));
    fireEvent.change(screen.getByLabelText('Adjustment points'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Adjustment reason'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    // Both problems are reported at once, each next to its own input.
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.getByText(/Points must be between 1 and/)).toBeInTheDocument();
    expect(screen.getByText('A reason is required.')).toBeInTheDocument();
    expect(mockedApi.mock.calls.filter((c) => String(c[1]).includes('/adjust'))).toEqual([]);
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
  it('loads the leaderboard on arrival, with no search needed', async () => {
    // The page used to open on an empty Search tab: a merchant saw nothing
    // about their own programme until they typed a number they already knew.
    routeApi();
    renderWithProviders(<CustomersPage />);
    await waitFor(() =>
      expect(mockedApi.mock.calls.some((c) => String(c[1]).includes('sort=points_balance'))).toBe(
        true,
      ),
    );
    expect(screen.getByText('Coins leaderboard')).toBeInTheDocument();
    expect(screen.queryByTestId('customer-profile')).not.toBeInTheDocument();
  });

  it('queries with the selected sort when toggled', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
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

  it('opens a customer straight from a leaderboard row', async () => {
    routeApi();
    renderWithProviders(<CustomersPage />);
    const cell = await screen.findByRole('cell', { name: '+919876543210' });
    fireEvent.click(cell);
    expect((await profileCard()).getByText('Asha Rao')).toBeInTheDocument();
  });
});
