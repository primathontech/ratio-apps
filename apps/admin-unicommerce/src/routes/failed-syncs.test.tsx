import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMerchantStore } from '@/stores/useMerchantStore';
import type { SyncActivityListResponse, SyncActivityRow } from '@/hooks/useUnicommerce';
import { renderWithProviders } from '../test-utils';
import { FailedSyncsPage } from './failed-syncs';

const MERCHANT = { id: 'merchant-1', isActive: true };

let syncActivityResult: (params: URLSearchParams) => Promise<SyncActivityListResponse>;

vi.mock('../lib/api', () => ({
  api: vi.fn((method: string, path: string) => {
    if (path === '/api/merchants/me') return Promise.resolve(MERCHANT);
    if (method === 'GET' && path.startsWith('/admin/sync-activity')) {
      const params = new URLSearchParams(path.split('?')[1]);
      return syncActivityResult(params);
    }
    throw new Error(`unexpected api call: ${method} ${path}`);
  }),
}));

const FAILED_ROW: SyncActivityRow = {
  id: 'event-1',
  merchantId: 'merchant-1',
  direction: 'outbound',
  flow: 'order_push',
  reference: 'order-42',
  result: 'failed',
  payload: {},
  response: 'Unicommerce rejected the order: duplicate SKU',
  createdAt: '2026-07-23T11:00:00.000Z',
  jobId: 'job-42',
};

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
});

describe('FailedSyncsPage', () => {
  it('requests ?result=failed on mount — no client-side filtering needed', async () => {
    const seenResults: Array<string | null> = [];
    syncActivityResult = (params) => {
      seenResults.push(params.get('result'));
      return Promise.resolve({ rows: [FAILED_ROW], hasMore: false });
    };
    renderWithProviders(<FailedSyncsPage />);

    await waitFor(() => {
      expect(screen.getByText('order-42')).toBeInTheDocument();
    });
    expect(seenResults).toEqual(['failed']);
  });

  it('shows the failure reason on hover via the Details column tooltip', async () => {
    syncActivityResult = () => Promise.resolve({ rows: [FAILED_ROW], hasMore: false });
    renderWithProviders(<FailedSyncsPage />);

    await waitFor(() => {
      expect(screen.getByText('order-42')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Unicommerce rejected the order: duplicate SKU'),
    ).toBeInTheDocument();
  });

  it('shows a distinct empty state when there are no failed syncs', async () => {
    syncActivityResult = () => Promise.resolve({ rows: [], hasMore: false });
    renderWithProviders(<FailedSyncsPage />);

    await waitFor(() => {
      expect(screen.getByText(/No failed syncs/i)).toBeInTheDocument();
    });
  });
});
