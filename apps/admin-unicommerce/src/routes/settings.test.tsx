import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UcConfig } from '@/hooks/useUnicommerce';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { SettingsPage } from './settings';

const MERCHANT = { id: 'merchant-1', isActive: true };

let configResult: () => Promise<UcConfig>;
let updateImpl: (body: unknown) => Promise<UcConfig>;

vi.mock('../lib/api', () => ({
  api: vi.fn((method: string, path: string, body?: unknown) => {
    if (path === '/api/merchants/me') return Promise.resolve(MERCHANT);
    if (method === 'GET' && path.startsWith('/admin/config')) return configResult();
    if (method === 'PUT' && path.startsWith('/admin/config')) return updateImpl(body);
    throw new Error(`unexpected api call: ${method} ${path}`);
  }),
}));

const DEFAULT_CONFIG: UcConfig = {
  productSyncEnabled: true,
  inventorySyncEnabled: false,
  orderPushEnabled: false,
  dispatchStatusSyncEnabled: true,
  cancelSyncEnabled: false,
  notificationsEnabled: false,
};

const NOTIFICATIONS_CAPTION =
  'Not yet available — no notification channel is implemented for this connector yet.';

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  configResult = () => Promise.resolve({ ...DEFAULT_CONFIG });
  updateImpl = () => Promise.resolve({ ...DEFAULT_CONFIG });
});

describe('SettingsPage', () => {
  it('renders the 6 checkboxes reflecting the current config', async () => {
    configResult = () =>
      Promise.resolve({
        productSyncEnabled: true,
        inventorySyncEnabled: false,
        orderPushEnabled: true,
        dispatchStatusSyncEnabled: false,
        cancelSyncEnabled: true,
        notificationsEnabled: false,
      });
    renderWithProviders(<SettingsPage />);

    // Under full-suite load the mocked GET -> React Query -> effect chain can
    // take longer than testing-library's default 1000ms waitFor timeout —
    // bumped here, not because the component is slow, but because this test
    // was observed timing out while the page was still showing its loading
    // spinner when run alongside the rest of the suite.
    await waitFor(
      () => {
        expect(screen.getByRole('checkbox', { name: 'Product sync' })).toBeChecked();
      },
      { timeout: 3000 },
    );
    expect(screen.getByRole('checkbox', { name: 'Inventory sync' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Order push' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Dispatch & status sync' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Cancel sync' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Notifications' })).not.toBeChecked();
  });

  it('saves a toggled checkbox via PUT with the full updated config', async () => {
    renderWithProviders(<SettingsPage />);

    await waitFor(
      () => {
        expect(screen.getByRole('checkbox', { name: 'Product sync' })).toBeChecked();
      },
      { timeout: 3000 },
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Inventory sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(screen.getByText('Settings saved.')).toBeInTheDocument();
    });

    const { api } = await import('../lib/api');
    expect(api).toHaveBeenCalledWith('PUT', '/admin/config?merchantId=merchant-1', {
      productSyncEnabled: true,
      inventorySyncEnabled: true,
      orderPushEnabled: false,
      dispatchStatusSyncEnabled: true,
      cancelSyncEnabled: false,
      notificationsEnabled: false,
    });
  });

  it('shows a success message after a successful save', async () => {
    renderWithProviders(<SettingsPage />);

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Save settings' })).not.toBeDisabled();
      },
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(screen.getByText('Settings saved.')).toBeInTheDocument();
    });
  });

  it('shows an error message when the save fails', async () => {
    updateImpl = () => Promise.reject(new Error('config update failed'));
    renderWithProviders(<SettingsPage />);

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Save settings' })).not.toBeDisabled();
      },
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(screen.getByText('config update failed')).toBeInTheDocument();
    });
  });

  it('renders the notifications checkbox disabled with its not-yet-available caption', async () => {
    configResult = () => Promise.resolve({ ...DEFAULT_CONFIG, notificationsEnabled: true });
    renderWithProviders(<SettingsPage />);

    await waitFor(
      () => {
        expect(screen.getByRole('checkbox', { name: 'Notifications' })).toBeDisabled();
      },
      { timeout: 3000 },
    );
    expect(screen.getByText(NOTIFICATIONS_CAPTION)).toBeInTheDocument();
  });
});
