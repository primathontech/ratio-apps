import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMerchantStore } from '@/stores/useMerchantStore';
import type { AlertListResponse } from '@/hooks/useUnicommerce';
import { renderWithProviders } from '../test-utils';
import { AlertsPage } from './alerts';

const MERCHANT = { id: 'merchant-1', isActive: true };

let alertsResult: () => Promise<AlertListResponse>;
let acknowledgeImpl: () => Promise<{ ok: boolean }>;

vi.mock('../lib/api', () => ({
  api: vi.fn((method: string, path: string) => {
    if (path === '/api/merchants/me') return Promise.resolve(MERCHANT);
    if (method === 'GET' && path.startsWith('/admin/alerts')) return alertsResult();
    if (method === 'POST' && path.includes('/acknowledge')) return acknowledgeImpl();
    throw new Error(`unexpected api call: ${method} ${path}`);
  }),
}));

const STALE_ORDER_ALERT = {
  id: 'alert-1',
  merchantId: 'merchant-1',
  type: 'STALE_ORDER' as const,
  reference: 'item-42',
  detectedAt: '2026-07-29T10:00:00.000Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
};

const SILENCE_ALERT_ACKED = {
  id: 'alert-2',
  merchantId: 'merchant-1',
  type: 'INBOUND_SILENCE' as const,
  reference: null,
  detectedAt: '2026-07-29T08:00:00.000Z',
  acknowledgedAt: '2026-07-29T09:00:00.000Z',
  acknowledgedBy: 'admin',
};

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  acknowledgeImpl = () => Promise.resolve({ ok: true });
});

describe('AlertsPage', () => {
  it('shows the empty state when there are no alerts', async () => {
    alertsResult = () => Promise.resolve({ alerts: [] });
    renderWithProviders(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByText(/No alerts/i)).toBeInTheDocument();
    });
  });

  it('renders a STALE_ORDER alert with its order reference and an Acknowledge button', async () => {
    alertsResult = () => Promise.resolve({ alerts: [STALE_ORDER_ALERT] });
    renderWithProviders(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByText('Order stuck')).toBeInTheDocument();
    });
    expect(screen.getByText('item-42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
  });

  it('renders an INBOUND_SILENCE alert as connector-wide, with no Acknowledge button once acknowledged', async () => {
    alertsResult = () => Promise.resolve({ alerts: [SILENCE_ALERT_ACKED] });
    renderWithProviders(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByText('Inbound channel silent')).toBeInTheDocument();
    });
    expect(screen.getByText('connector-wide')).toBeInTheDocument();
    expect(screen.getByText('Acknowledged')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
  });

  it('calls the acknowledge endpoint with the alert id when clicked', async () => {
    alertsResult = () => Promise.resolve({ alerts: [STALE_ORDER_ALERT] });
    const { api } = await import('../lib/api');
    renderWithProviders(<AlertsPage />);

    const button = await screen.findByRole('button', { name: 'Acknowledge' });
    button.click();

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('POST', '/admin/alerts/alert-1/acknowledge', {
        acknowledgedBy: 'admin',
      });
    });
  });

  it('shows a "Show more" button only past the first 5 alerts', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...STALE_ORDER_ALERT,
      id: `alert-${i}`,
      reference: `item-${i}`,
    }));
    alertsResult = () => Promise.resolve({ alerts: many });
    renderWithProviders(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByText('item-0')).toBeInTheDocument();
    });
    expect(screen.queryByText('item-5')).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'Show more' }).click();

    await waitFor(() => {
      expect(screen.getByText('item-5')).toBeInTheDocument();
    });
  });
});
