import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMerchantStore } from '@/stores/useMerchantStore';
import type { ReconciliationJob } from '@/hooks/useUnicommerce';
import { renderWithProviders } from '../test-utils';
import { ReconciliationPage } from './reconciliation';

const MERCHANT = { id: 'merchant-1', isActive: true };

let triggerImpl: (body: unknown) => Promise<{ jobId: string }>;
let jobResult: () => Promise<ReconciliationJob>;

vi.mock('../lib/api', () => ({
  api: vi.fn((method: string, path: string, body?: unknown) => {
    if (path === '/api/merchants/me') return Promise.resolve(MERCHANT);
    if (method === 'POST' && path === '/admin/reconcile') return triggerImpl(body);
    if (method === 'GET' && path.startsWith('/admin/reconcile/')) return jobResult();
    throw new Error(`unexpected api call: ${method} ${path}`);
  }),
}));

const COMPLETED_JOB: ReconciliationJob = {
  id: 'job-1',
  merchantId: 'merchant-1',
  requestedBy: 'manual',
  timeRangeStart: '2026-07-29T00:00:00.000Z',
  timeRangeEnd: '2026-07-29T01:00:00.000Z',
  status: 'COMPLETED',
  ordersCheckedCount: 10,
  ordersPushedCount: 2,
  ordersAlreadySyncedCount: 8,
  ordersFailedCount: 0,
  startedAt: '2026-07-29T01:00:00.000Z',
  completedAt: '2026-07-29T01:00:05.000Z',
};

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
});

describe('ReconciliationPage', () => {
  it('renders the three time-range presets and a custom-range option', async () => {
    renderWithProviders(<ReconciliationPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Last 1 hour' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Last 2 hours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last 6 hours' })).toBeInTheDocument();
    expect(screen.getByLabelText('Range start')).toBeInTheDocument();
    expect(screen.getByLabelText('Range end')).toBeInTheDocument();
  });

  it('triggers a reconciliation on preset click and shows the completed result', async () => {
    triggerImpl = () => Promise.resolve({ jobId: 'job-1' });
    jobResult = () => Promise.resolve(COMPLETED_JOB);
    renderWithProviders(<ReconciliationPage />);

    const button = await screen.findByRole('button', { name: 'Last 1 hour' });
    await waitFor(() => expect(button).not.toBeDisabled());
    button.click();

    await waitFor(() => {
      expect(screen.getByText('Found and pushed 2 missing order(s).')).toBeInTheDocument();
    });
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it("shows a success message with no missing orders when the job completes clean", async () => {
    triggerImpl = () => Promise.resolve({ jobId: 'job-2' });
    jobResult = () => Promise.resolve({ ...COMPLETED_JOB, id: 'job-2', ordersPushedCount: 0, ordersAlreadySyncedCount: 10 });
    renderWithProviders(<ReconciliationPage />);

    const button = await screen.findByRole('button', { name: 'Last 2 hours' });
    await waitFor(() => expect(button).not.toBeDisabled());
    button.click();

    await waitFor(() => {
      expect(screen.getByText("No missing orders found — everything's already synced.")).toBeInTheDocument();
    });
  });

  it('shows a running indicator while the job is still in progress', async () => {
    triggerImpl = () => Promise.resolve({ jobId: 'job-3' });
    jobResult = () => Promise.resolve({ ...COMPLETED_JOB, id: 'job-3', status: 'RUNNING' });
    renderWithProviders(<ReconciliationPage />);

    const button = await screen.findByRole('button', { name: 'Last 6 hours' });
    await waitFor(() => expect(button).not.toBeDisabled());
    button.click();

    await waitFor(() => {
      expect(screen.getByText(/Running — checking orders/)).toBeInTheDocument();
    });
  });

  it('sends the correct merchantId and ISO time range on preset click', async () => {
    let seenBody: unknown;
    triggerImpl = (body) => {
      seenBody = body;
      return Promise.resolve({ jobId: 'job-1' });
    };
    jobResult = () => Promise.resolve(COMPLETED_JOB);
    renderWithProviders(<ReconciliationPage />);

    const button = await screen.findByRole('button', { name: 'Last 1 hour' });
    await waitFor(() => expect(button).not.toBeDisabled());
    button.click();

    await waitFor(() => {
      expect(seenBody).toMatchObject({ merchantId: 'merchant-1' });
    });
    const body = seenBody as { timeRangeStart: string; timeRangeEnd: string };
    expect(new Date(body.timeRangeEnd).getTime() - new Date(body.timeRangeStart).getTime()).toBe(
      60 * 60 * 1000,
    );
  });
});
