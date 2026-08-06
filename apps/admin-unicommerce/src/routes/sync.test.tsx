import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMerchantStore } from '@/stores/useMerchantStore';
import type { SyncActivityListResponse, SyncActivityRow } from '@/hooks/useUnicommerce';
import { renderWithProviders } from '../test-utils';
import { SyncActivityPage } from './sync';

const MERCHANT = { id: 'merchant-1', isActive: true };

// One shared mock across tests: `useMerchant` (GET /api/merchants/me) and
// `useSyncActivity` (GET /admin/sync-activity) both go through this same
// `api` function, so the mock switches on the request instead of relying on
// call order. Each test configures `syncActivityResult` / `retryImpl` before
// rendering. `syncActivityResult` receives the parsed query params so tests
// can assert on (and vary behavior by) `limit`/`result`.
let syncActivityResult: (params: URLSearchParams) => Promise<SyncActivityListResponse>;
let retryImpl: () => Promise<{ ok: boolean }>;

vi.mock('../lib/api', () => ({
  api: vi.fn((method: string, path: string) => {
    if (path === '/api/merchants/me') return Promise.resolve(MERCHANT);
    if (method === 'GET' && path.startsWith('/admin/sync-activity')) {
      const params = new URLSearchParams(path.split('?')[1]);
      return syncActivityResult(params);
    }
    if (method === 'POST' && path.includes('/retry')) return retryImpl();
    throw new Error(`unexpected api call: ${method} ${path}`);
  }),
}));

const FAILED_NO_JOB: SyncActivityRow = {
  id: 'event-1',
  merchantId: 'merchant-1',
  direction: 'inbound',
  flow: 'auth',
  reference: 'auth-ref',
  result: 'failed',
  payload: {},
  response: null,
  createdAt: '2026-07-23T10:00:00.000Z',
  jobId: null,
};

const FAILED_WITH_JOB: SyncActivityRow = {
  id: 'event-2',
  merchantId: 'merchant-1',
  direction: 'outbound',
  flow: 'order_push',
  reference: 'order-42',
  result: 'failed',
  payload: {},
  response: null,
  createdAt: '2026-07-23T11:00:00.000Z',
  jobId: 'job-42',
};

const SUCCESS_ROW: SyncActivityRow = {
  id: 'event-3',
  merchantId: 'merchant-1',
  direction: 'outbound',
  flow: 'order_push',
  reference: 'order-7',
  result: 'success',
  payload: {},
  response: { saleOrderCode: 'SO-7' },
  createdAt: '2026-07-23T12:00:00.000Z',
  jobId: 'job-7',
};

const WEBHOOK_ROW: SyncActivityRow = {
  id: 'event-4',
  merchantId: 'merchant-1',
  direction: 'inbound',
  flow: 'webhook',
  reference: 'orders/create: order-1',
  result: 'success',
  payload: {},
  response: { queuedJobId: 'job-1' },
  createdAt: '2026-07-23T13:00:00.000Z',
  jobId: null,
};

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  retryImpl = () => Promise.resolve({ ok: true });
});

describe('SyncActivityPage (All Activity)', () => {
  it('does not render Retry for a failed row with jobId: null', async () => {
    syncActivityResult = () => Promise.resolve({ rows: [FAILED_NO_JOB], hasMore: false });
    renderWithProviders(<SyncActivityPage />);

    await waitFor(() => {
      expect(screen.getByText('auth-ref')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('renders Retry and calls the retry mutation with the row jobId when present', async () => {
    syncActivityResult = () => Promise.resolve({ rows: [FAILED_WITH_JOB], hasMore: false });
    const { api } = await import('../lib/api');
    renderWithProviders(<SyncActivityPage />);

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    retryButton.click();

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('POST', '/admin/sync-activity/job-42/retry');
    });
  });

  it('renders the error state distinctly from the empty state', async () => {
    syncActivityResult = () => Promise.reject(new Error('backend unreachable'));
    renderWithProviders(<SyncActivityPage />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load sync activity")).toBeInTheDocument();
    });
    expect(screen.getByText('backend unreachable')).toBeInTheDocument();
    expect(screen.queryByText(/No sync activity yet/i)).not.toBeInTheDocument();
  });

  it('shows the empty state (not the error state) when the list is genuinely empty', async () => {
    syncActivityResult = () => Promise.resolve({ rows: [], hasMore: false });
    renderWithProviders(<SyncActivityPage />);

    await waitFor(() => {
      expect(screen.getByText(/No sync activity yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("Couldn't load sync activity")).not.toBeInTheDocument();
  });

  it('renders the expected columns on a successful list load', async () => {
    syncActivityResult = () => Promise.resolve({ rows: [SUCCESS_ROW], hasMore: false });
    renderWithProviders(<SyncActivityPage />);

    await waitFor(() => {
      expect(screen.getByText('order-7')).toBeInTheDocument();
    });
    expect(screen.getByText('Order pushed to Unicommerce → Unicommerce')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('Sale order code: SO-7')).toBeInTheDocument();
    expect(new Date(SUCCESS_ROW.createdAt).toLocaleString()).toBeTruthy();
    // Successful rows never show a Retry button.
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('describes a webhook-flow row distinctly, without the misleading Unicommerce arrow', async () => {
    syncActivityResult = () => Promise.resolve({ rows: [WEBHOOK_ROW], hasMore: false });
    renderWithProviders(<SyncActivityPage />);

    await waitFor(() => {
      expect(screen.getByText('Ratio webhook received')).toBeInTheDocument();
    });
    expect(screen.getByText('orders/create: order-1')).toBeInTheDocument();
  });

  it('renders a "Show more" button when hasMore is true, and requests a bigger page on click', async () => {
    const seenLimits: string[] = [];
    syncActivityResult = (params) => {
      seenLimits.push(params.get('limit') ?? '');
      return Promise.resolve({ rows: [SUCCESS_ROW], hasMore: true });
    };
    renderWithProviders(<SyncActivityPage />);

    const showMore = await screen.findByRole('button', { name: 'Show more' });
    showMore.click();

    await waitFor(() => {
      expect(seenLimits).toEqual(['5', '10']);
    });
  });

  it('does not render "Show more" when hasMore is false', async () => {
    syncActivityResult = () => Promise.resolve({ rows: [SUCCESS_ROW], hasMore: false });
    renderWithProviders(<SyncActivityPage />);

    await waitFor(() => {
      expect(screen.getByText('order-7')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('requests the unfiltered list (no ?result=) on mount', async () => {
    const seenResults: Array<string | null> = [];
    syncActivityResult = (params) => {
      seenResults.push(params.get('result'));
      return Promise.resolve({ rows: [SUCCESS_ROW], hasMore: false });
    };
    renderWithProviders(<SyncActivityPage />);

    await waitFor(() => {
      expect(seenResults).toEqual([null]);
    });
  });
});
