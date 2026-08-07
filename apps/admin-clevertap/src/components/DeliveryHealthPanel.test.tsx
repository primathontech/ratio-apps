import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClevertapDeliveryHealth } from '@/hooks/useDeliveryHealth';
import { renderWithProviders } from '../test-utils';
import { DeliveryHealthPanel } from './DeliveryHealthPanel';

const fixture: ClevertapDeliveryHealth = {
  windowHours: 24,
  sent: 8,
  failed: 2,
  skipped: 1,
  queued: 3,
  total: 11,
  successRate: 73,
  perTopic: [
    { topic: 'orders/paid', sent: 5, failed: 1, skipped: 0, lastAt: '2026-08-04T10:00:00.000Z' },
    {
      topic: 'products/create',
      sent: 3,
      failed: 1,
      skipped: 1,
      lastAt: '2026-08-04T09:00:00.000Z',
    },
  ],
  recentFailures: [
    {
      topic: 'products/create',
      clevertapEvent: 'Catalog Upsert',
      error: 'boom',
      sentAt: '2026-08-04T09:30:00.000Z',
    },
  ],
};

describe('DeliveryHealthPanel', () => {
  it('renders success rate, a per-topic row, and a recent-failure row', () => {
    renderWithProviders(<DeliveryHealthPanel data={fixture} />);
    expect(screen.getByText('Success rate')).toBeInTheDocument();
    expect(screen.getByText('73%')).toBeInTheDocument();
    expect(screen.getByText('orders/paid')).toBeInTheDocument();
    expect(screen.getByText('Catalog Upsert')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows an empty state when nothing has been forwarded', () => {
    renderWithProviders(
      <DeliveryHealthPanel
        data={{
          ...fixture,
          sent: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          successRate: null,
          perTopic: [],
          recentFailures: [],
        }}
      />,
    );
    expect(screen.getByText(/No events forwarded to CleverTap/i)).toBeInTheDocument();
  });

  it('renders loading and error states', () => {
    const { rerender } = renderWithProviders(<DeliveryHealthPanel data={undefined} isLoading />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    rerender(<DeliveryHealthPanel data={undefined} error={new Error('nope')} />);
    expect(screen.getByText(/Couldn't load delivery health/i)).toBeInTheDocument();
  });
});
