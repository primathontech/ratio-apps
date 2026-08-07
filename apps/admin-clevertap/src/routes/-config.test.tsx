import { CLEVERTAP_REGIONS } from '@shared/constants/clevertap-events';
import type { ClevertapConfigOutput } from '@shared/schemas/clevertap-config';
import { buildDefaultEventMap } from '@shared/schemas/event-map';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ConfigPage, REGION_OPTIONS } from './-config-page';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

const CONFIG_PATH = '/api/clevertap-config';
const ACCOUNT_PLACEHOLDER = 'ACCOUNT-ID-HERE';
const PASSCODE_PLACEHOLDER = 'Enter CleverTap Passcode';

function makeConfig(overrides: Partial<ClevertapConfigOutput> = {}): ClevertapConfigOutput {
  return {
    accountId: 'TEST-ACCOUNT-1',
    region: 'in1',
    debug: false,
    serverEventsEnabled: false,
    events: buildDefaultEventMap('clevertap'),
    passcodeSet: false,
    clevertapEnabled: true,
    ...overrides,
  };
}

function routeApi(config: ClevertapConfigOutput, onPut?: () => Promise<unknown>) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === CONFIG_PATH && method === 'GET') return Promise.resolve(config);
    if (path === CONFIG_PATH && method === 'PUT') return onPut ? onPut() : Promise.resolve(config);
    return Promise.resolve({});
  });
}

function putBody(): Record<string, unknown> | undefined {
  const call = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === CONFIG_PATH);
  return call?.[2] as Record<string, unknown> | undefined;
}

function putCalls() {
  return mockedApi.mock.calls.filter((c) => c[0] === 'PUT' && c[1] === CONFIG_PATH);
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: /Save credentials/ }));
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CleverTap config form', () => {
  it('renders the loaded Account ID and region', async () => {
    routeApi(makeConfig({ accountId: 'SAVED-ACCOUNT', region: 'sg1' }));
    renderWithProviders(<ConfigPage />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText(ACCOUNT_PLACEHOLDER) as HTMLInputElement;
      expect(input.value).toBe('SAVED-ACCOUNT');
    });
    expect(screen.getByText(CLEVERTAP_REGIONS.sg1.label)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(CLEVERTAP_REGIONS.sg1.dashboard.replace(/\./g, '\\.'))),
    ).toBeInTheDocument();
  });

  it('renders the passcode input EMPTY even when passcodeSet is true, with a "saved, leave blank to keep" affordance', async () => {
    routeApi(makeConfig({ passcodeSet: true }));
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    const passcode = screen.getByPlaceholderText(PASSCODE_PLACEHOLDER) as HTMLInputElement;
    expect(passcode.value).toBe('');
    expect(await screen.findByText(/saved\. leave blank to keep/i)).toBeInTheDocument();
  });

  it('OMITS passcode from the PUT body when the field is untouched (never sends "")', async () => {
    routeApi(makeConfig({ passcodeSet: true }));
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    save();

    await waitFor(() => {
      const body = putBody();
      expect(body).toBeDefined();
      expect(body && 'passcode' in body).toBe(false);
      expect(body?.accountId).toBe('TEST-ACCOUNT-1');
    });
  });

  it('saves with server events ON and a blank passcode (blank means leave unchanged, not clear)', async () => {
    routeApi(makeConfig({ passcodeSet: true, serverEventsEnabled: true }));
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    save();

    await waitFor(() => {
      const body = putBody();
      expect(body).toBeDefined();
      expect(body?.serverEventsEnabled).toBe(true);
      expect(body && 'passcode' in body).toBe(false);
    });
  });

  it('sends the typed passcode when the merchant enters one (rotation)', async () => {
    routeApi(makeConfig({ passcodeSet: true }));
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    fireEvent.change(screen.getByPlaceholderText(PASSCODE_PLACEHOLDER), {
      target: { value: 'NEW-PASSCODE-123' },
    });
    save();

    await waitFor(() => expect(putBody()?.passcode).toBe('NEW-PASSCODE-123'));
  });

  it('sends passcode: "" ONLY via the explicit Clear passcode action, and turns server events off', async () => {
    routeApi(makeConfig({ passcodeSet: true, serverEventsEnabled: true }));
    renderWithProviders(<ConfigPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Clear passcode/ }));

    await waitFor(() => {
      const body = putBody();
      expect(body?.passcode).toBe('');
      expect(body?.serverEventsEnabled).toBe(false);
    });
  });

  it('offers no Clear passcode action when no passcode is stored', async () => {
    routeApi(makeConfig({ passcodeSet: false }));
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    expect(screen.queryByRole('button', { name: /Clear passcode/ })).not.toBeInTheDocument();
  });

  it('shows an inline error and does not PUT when the Account ID is invalid', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);

    const accountInput = await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    fireEvent.change(accountInput, { target: { value: 'not a valid id!' } });
    save();

    expect(await screen.findByText(/alphanumeric with dashes/i)).toBeInTheDocument();
    expect(putCalls()).toHaveLength(0);
  });

  it('shows an inline error and does not PUT when the Account ID is empty', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);

    const accountInput = await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    fireEvent.change(accountInput, { target: { value: '' } });
    save();

    expect(await screen.findByText(/Account ID is required/i)).toBeInTheDocument();
    expect(putCalls()).toHaveLength(0);
  });

  it('offers every CleverTap region', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);

    const regionKeys = Object.keys(CLEVERTAP_REGIONS);
    expect(REGION_OPTIONS.map((o) => o.value)).toEqual(regionKeys);
    expect(REGION_OPTIONS.map((o) => o.label)).toEqual(
      regionKeys.map((k) => CLEVERTAP_REGIONS[k as keyof typeof CLEVERTAP_REGIONS].label),
    );
    expect(regionKeys).toHaveLength(6);
  });

  it('disables "Enable server-side events" until a passcode is saved', async () => {
    routeApi(makeConfig({ passcodeSet: false }));
    const { unmount } = renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    expect(screen.getByRole('checkbox', { name: /Enable server-side events/ })).toBeDisabled();
    expect(screen.getByText(/Save a Passcode first/i)).toBeInTheDocument();
    unmount();

    routeApi(makeConfig({ passcodeSet: true }));
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Enable server-side events/ })).toBeEnabled(),
    );
  });

  it('submits catalogSyncEnabled when the catalog sync toggle is turned on', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable catalog sync/ }));
    save();

    await waitFor(() => expect(putBody()?.catalogSyncEnabled).toBe(true));
  });

  it('triggers a catalog sync from "Sync now" and shows the result', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (path === CONFIG_PATH && method === 'GET')
        return Promise.resolve(
          makeConfig({
            catalogSyncEnabled: true,
            catalogName: 'products',
            catalogEmail: 'ops@x.co',
          }),
        );
      if (path === '/api/catalog/sync' && method === 'POST')
        return Promise.resolve({ status: 'sent', itemCount: 5 });
      return Promise.resolve({});
    });
    renderWithProviders(<ConfigPage />);

    const btn = await screen.findByRole('button', { name: /Sync now/ });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByText(/Synced 5 products/)).toBeInTheDocument());
    expect(mockedApi.mock.calls.some((c) => c[0] === 'POST' && c[1] === '/api/catalog/sync')).toBe(
      true,
    );
  });

  it('disables "Sync now" until catalog settings are saved and enabled', async () => {
    routeApi(makeConfig({ catalogSyncEnabled: false }));
    renderWithProviders(<ConfigPage />);

    const btn = await screen.findByRole('button', { name: /Sync now/ });
    expect(btn).toBeDisabled();
  });

  it('submits chargedSource in the payload (defaults to server) and offers both options', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    expect(screen.getByText('Server-side (orders/paid)')).toBeInTheDocument();
    expect(screen.getByText('Client-side (pixel)')).toBeInTheDocument();
    save();

    await waitFor(() => expect(putBody()?.chargedSource).toBe('server'));
  });

  it('disables the Server-side Charged option and warns when server events are off', async () => {
    routeApi(makeConfig({ serverEventsEnabled: false }));
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    const serverOption = screen.getByText('Server-side (orders/paid)').closest('label');
    expect(serverOption?.querySelector('input')).toBeDisabled();
    expect(screen.getByText(/Charged is not being sent/i)).toBeInTheDocument();
  });

  it('enables the Server-side Charged option (no warning) when server events are on', async () => {
    routeApi(makeConfig({ serverEventsEnabled: true, passcodeSet: true }));
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    const serverOption = screen.getByText('Server-side (orders/paid)').closest('label');
    await waitFor(() => expect(serverOption?.querySelector('input')).toBeEnabled());
    expect(screen.queryByText(/Charged is not being sent/i)).not.toBeInTheDocument();
  });

  it('confirms before disabling the kill switch, then submits clevertapEnabled=false', async () => {
    routeApi(makeConfig({ clevertapEnabled: true }));
    renderWithProviders(<ConfigPage />);

    await screen.findByPlaceholderText(ACCOUNT_PLACEHOLDER);
    fireEvent.click(screen.getByRole('checkbox', { name: /Enable CleverTap for this merchant/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pause CleverTap' }));
    save();

    await waitFor(() => expect(putBody()?.clevertapEnabled).toBe(false));
  });

  it('surfaces a save failure without clearing the form', async () => {
    routeApi(makeConfig(), () => Promise.reject(new Error('CleverTap rejected the credentials')));
    renderWithProviders(<ConfigPage />);

    const accountInput = (await screen.findByPlaceholderText(
      ACCOUNT_PLACEHOLDER,
    )) as HTMLInputElement;
    fireEvent.change(accountInput, { target: { value: 'EDITED-ACCOUNT' } });
    save();

    expect(await screen.findByText('CleverTap rejected the credentials')).toBeInTheDocument();
    expect((screen.getByPlaceholderText(ACCOUNT_PLACEHOLDER) as HTMLInputElement).value).toBe(
      'EDITED-ACCOUNT',
    );
  });
});
