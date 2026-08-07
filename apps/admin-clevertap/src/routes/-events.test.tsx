import { DEFAULT_CLEVERTAP_EVENT_MAP } from '@shared/constants/clevertap-events';
import type { OpenStoreEventName } from '@shared/constants/openstore-events';
import type { ClevertapConfigOutput } from '@shared/schemas/clevertap-config';
import { buildDefaultEventMap, type EventMap } from '@shared/schemas/event-map';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { EventsPage } from './events';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);
const CONFIG_PATH = '/api/clevertap-config';

function makeConfig(overrides: Partial<ClevertapConfigOutput> = {}): ClevertapConfigOutput {
  return {
    accountId: 'TEST-ACCOUNT-1',
    region: 'in1',
    debug: false,
    serverEventsEnabled: true,
    events: buildDefaultEventMap('clevertap'),
    passcodeSet: true,
    clevertapEnabled: true,
    ...overrides,
  };
}

function routeApi(config: ClevertapConfigOutput) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === CONFIG_PATH && method === 'GET') return Promise.resolve(config);
    if (path === CONFIG_PATH && method === 'PUT') return Promise.resolve(config);
    return Promise.resolve({});
  });
}

function putBody(): Record<string, unknown> | undefined {
  const call = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === CONFIG_PATH);
  return call?.[2] as Record<string, unknown> | undefined;
}

function nameInput(osName: OpenStoreEventName): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[name="events.${osName}.name"]`);
  if (!el) throw new Error(`no name input rendered for ${osName}`);
  return el;
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Events page', () => {
  it('PUTs the renamed event map', async () => {
    routeApi(makeConfig());
    renderWithProviders(<EventsPage />);

    await waitFor(() =>
      expect(nameInput('ViewContent').value).toBe(DEFAULT_CLEVERTAP_EVENT_MAP.ViewContent),
    );
    fireEvent.change(nameInput('ViewContent'), { target: { value: 'PDP Viewed' } });
    fireEvent.click(screen.getByRole('button', { name: /Save mapping/ }));

    await waitFor(() => expect(putBody()).toBeDefined());
    const events = putBody()?.events as EventMap;
    expect(events.ViewContent).toEqual({ enabled: true, name: 'PDP Viewed' });
    expect(events.Purchase.name).toBe('Charged');
  });

  it('never sends a passcode key from this screen (a "" would wipe the credential)', async () => {
    routeApi(makeConfig());
    renderWithProviders(<EventsPage />);

    await waitFor(() => expect(nameInput('PageView')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Save mapping/ }));

    await waitFor(() => expect(putBody()).toBeDefined());
    const body = putBody() as Record<string, unknown>;
    expect('passcode' in body).toBe(false);
    expect(body.accountId).toBe('TEST-ACCOUNT-1');
    expect(body.region).toBe('in1');
    expect(body.serverEventsEnabled).toBe(true);
  });

  it('blocks saving until an Account ID is configured', async () => {
    routeApi(makeConfig({ accountId: '' }));
    renderWithProviders(<EventsPage />);

    await waitFor(() =>
      expect(screen.getByText(/Add your CleverTap Account ID/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Save mapping/ })).toBeDisabled();
  });

  it('warns that Purchase must stay mapped to Charged', async () => {
    routeApi(makeConfig());
    renderWithProviders(<EventsPage />);
    await waitFor(() => expect(screen.getByText(/Purchase defaults to/)).toBeInTheDocument());
  });

  it('mutes a server event topic when its checkbox is unchecked', async () => {
    routeApi(makeConfig());
    renderWithProviders(<EventsPage />);

    await waitFor(() => expect(nameInput('PageView')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Order Cancelled' }));
    fireEvent.click(screen.getByRole('button', { name: /Save mapping/ }));

    await waitFor(() => expect(putBody()?.disabledTopics).toEqual(['orders/cancelled']));
  });

  it('locks Order Paid → Charged to the Config Charged source: checked + disabled when server', async () => {
    routeApi(makeConfig({ chargedSource: 'server' }));
    renderWithProviders(<EventsPage />);

    const paid = (await screen.findByRole('checkbox', {
      name: /Order Paid/,
    })) as HTMLInputElement;
    expect(paid.checked).toBe(true);
    expect(paid).toBeDisabled();
  });

  it('shows Order Paid → Charged unchecked + disabled when Charged is client-side', async () => {
    routeApi(makeConfig({ chargedSource: 'client' }));
    renderWithProviders(<EventsPage />);

    const paid = (await screen.findByRole('checkbox', {
      name: /Order Paid/,
    })) as HTMLInputElement;
    expect(paid.checked).toBe(false);
    expect(paid).toBeDisabled();
  });

  it('keeps Order Paid as server-side when source=server, agreeing with the pixel row (no fallback)', async () => {
    routeApi(makeConfig({ serverEventsEnabled: false, chargedSource: 'server' }));
    renderWithProviders(<EventsPage />);

    const paid = (await screen.findByRole('checkbox', { name: /Order Paid/ })) as HTMLInputElement;
    expect(paid.checked).toBe(true);
    expect(screen.getAllByText('sent server-side').length).toBeGreaterThanOrEqual(2);
  });

  it('disables the server topic list and warns when server-side events are off', async () => {
    routeApi(makeConfig({ serverEventsEnabled: false }));
    renderWithProviders(<EventsPage />);

    expect(await screen.findByText(/Server-side events are off/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Order Cancelled' })).toBeDisabled();
  });
});
