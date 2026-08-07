import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusPanel } from '@/components/StatusPanel';
import type { ClevertapStatus } from '@/hooks/useStatus';
import { renderWithProviders } from '../test-utils';

function makeStatus(overrides: Partial<ClevertapStatus> = {}): ClevertapStatus {
  return {
    configComplete: true,
    serverEventsEnabled: true,
    lastEventAt: '2026-07-25T10:30:00.000Z',
    lastEventTopic: 'orders/paid',
    lastError: null,
    forwardedCount24h: 42,
    ...overrides,
  };
}

describe('StatusPanel', () => {
  it('renders configComplete, serverEventsEnabled and the last forwarded event', () => {
    renderWithProviders(<StatusPanel status={makeStatus()} />);

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText(/orders\/paid/)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('flags an incomplete config and switched-off server events', () => {
    renderWithProviders(
      <StatusPanel status={makeStatus({ configComplete: false, serverEventsEnabled: false })} />,
    );

    expect(screen.getByText('Account ID missing')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('shows an empty state when nothing has been forwarded yet', () => {
    renderWithProviders(
      <StatusPanel
        status={makeStatus({ lastEventAt: null, lastEventTopic: null, forwardedCount24h: 0 })}
      />,
    );

    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText(/No events forwarded to CleverTap yet/)).toBeInTheDocument();
  });

  it('surfaces lastError when the most recent forward failed', () => {
    renderWithProviders(
      <StatusPanel status={makeStatus({ lastError: 'CleverTap responded 401 Unauthorized' })} />,
    );

    expect(screen.getByText('The most recent forward failed')).toBeInTheDocument();
    expect(screen.getByText('CleverTap responded 401 Unauthorized')).toBeInTheDocument();
  });

  it('degrades gracefully when the status endpoint fails', () => {
    renderWithProviders(<StatusPanel status={undefined} error={new Error('boom')} />);
    expect(screen.getByText(/Couldn't load the delivery status/)).toBeInTheDocument();
  });
});
