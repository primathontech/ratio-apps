import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaskedDelhiveryConfig } from '@/hooks/useConfig';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ConfigPage } from './config';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

function makeConfig(overrides: Partial<MaskedDelhiveryConfig> = {}): MaskedDelhiveryConfig {
  return {
    apiTokenMasked: '••••bcd4',
    hasApiToken: true,
    pickupLocationName: 'Main Warehouse',
    pickupPincode: '122001',
    pickupPhone: '9876543210',
    pickupAddress: 'Plot 5, Industrial Area',
    pickupCity: 'Gurgaon',
    gstin: '22AAAAA0000A1Z5',
    pickupCutoff: '10:00',
    awbTrigger: 'auto',
    defaultBox: { l: 10, b: 10, h: 10 },
    enabled: true,
    ...overrides,
  };
}

function routeApi(
  config: MaskedDelhiveryConfig,
  testResult: { ok: boolean; status: number } = { ok: true, status: 200 },
  warehouseResult: Record<string, unknown> | Error = {
    warehouseStatus: 'created',
    warehouseMessage: 'A new client warehouse has been created',
  },
) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/delhivery-config' && method === 'GET') return Promise.resolve(config);
    // PUT persists only: it returns the saved masked config, no warehouse outcome.
    if (path === '/api/delhivery-config' && method === 'PUT') return Promise.resolve(config);
    if (path === '/api/delhivery-config/warehouse' && method === 'POST') {
      return warehouseResult instanceof Error
        ? Promise.reject(warehouseResult)
        : Promise.resolve(warehouseResult);
    }
    if (path === '/api/delhivery-config/test' && method === 'POST') {
      return Promise.resolve(testResult);
    }
    if (path === '/api/defaults') {
      return Promise.resolve({
        pickupCutoff: '10:00',
        awbTrigger: 'auto',
        defaultBox: { l: 10, b: 10, h: 10 },
      });
    }
    return Promise.resolve({});
  });
}

function callsTo(method: string, path: string) {
  return mockedApi.mock.calls.filter((c) => c[0] === method && c[1] === path);
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConfigPage', () => {
  // form.validatesRequired, token, warehouse and GSTIN are required.
  it('shows validation errors for missing token, pickup location and GSTIN', async () => {
    routeApi(
      makeConfig({ hasApiToken: false, apiTokenMasked: '', pickupLocationName: '', gstin: '' }),
    );
    renderWithProviders(<ConfigPage />);
    await screen.findByText('Delhivery credentials');

    fireEvent.click(screen.getByRole('button', { name: /Save & register with Delhivery/ }));

    await waitFor(() => expect(screen.getByText('API token is required')).toBeInTheDocument());
    expect(screen.getByText('pickup location name is required')).toBeInTheDocument();
    expect(screen.getByText('GSTIN is required')).toBeInTheDocument();
    // Neither the save nor the registration may have fired.
    expect(callsTo('PUT', '/api/delhivery-config')).toHaveLength(0);
    expect(callsTo('POST', '/api/delhivery-config/warehouse')).toHaveLength(0);
  });

  // form.cutoffFormat, pickup cutoff must be HH:mm (24h).
  it('rejects a malformed pickup cutoff', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    const cutoff = await screen.findByPlaceholderText('10:00');

    fireEvent.change(cutoff, { target: { value: '25:99' } });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));

    await waitFor(() =>
      expect(screen.getByText('pickupCutoff must be HH:mm (24h)')).toBeInTheDocument(),
    );
    expect(callsTo('PUT', '/api/delhivery-config')).toHaveLength(0);
  });

  // settings.saveIsLocalOnly, "Save settings" PUTs the full form state and
  // NEVER calls the warehouse-registration endpoint.
  it('save settings: PUTs the config and never hits the warehouse endpoint', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(/Delhivery Express B2C token/);

    fireEvent.change(screen.getByPlaceholderText(/Delhivery Express B2C token/), {
      target: { value: 'tok-123' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Manual: create per order/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));

    await waitFor(() => {
      const putCalls = callsTo('PUT', '/api/delhivery-config');
      expect(putCalls).toHaveLength(1);
      const body = putCalls[0]?.[2] as Record<string, unknown>;
      expect(body.awbTrigger).toBe('manual');
      // The whole form state rides along, no fields are lost across cards.
      expect(body.apiToken).toBe('tok-123');
      expect(body.pickupLocationName).toBe('Main Warehouse');
      expect(body.gstin).toBe('22AAAAA0000A1Z5');
    });
    await waitFor(() => expect(screen.getByText('Settings saved.')).toBeInTheDocument());
    // The carrier is never contacted from the settings card.
    expect(callsTo('POST', '/api/delhivery-config/warehouse')).toHaveLength(0);
  });

  // form.testConnectionStates, idle → loading → ok.
  it('test connection: idle → loading → success', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    const button = await screen.findByRole('button', { name: /Test connection/ });

    // Idle: no result alert yet.
    expect(screen.queryByText(/Connection OK/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rejected the token/)).not.toBeInTheDocument();

    fireEvent.click(button);
    // Loading resolves into the success state.
    await waitFor(() => expect(screen.getByText(/Connection OK/)).toBeInTheDocument());
  });

  // form.testConnectionStates, error state on a rejected token.
  it('test connection: shows the error state on a 401', async () => {
    routeApi(makeConfig(), { ok: false, status: 401 });
    renderWithProviders(<ConfigPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Test connection/ }));
    await waitFor(() => expect(screen.getByText(/rejected the token/)).toBeInTheDocument());
    expect(screen.getByText(/HTTP 401/)).toBeInTheDocument();
  });

  // form.testConnectionStates, disabled until a token is saved.
  it('test connection is disabled when no token is saved yet', async () => {
    routeApi(makeConfig({ hasApiToken: false, apiTokenMasked: '' }));
    renderWithProviders(<ConfigPage />);
    const button = await screen.findByRole('button', { name: /Test connection/ });
    expect(button).toBeDisabled();
  });

  // pickup.saveThenRegister, a valid "Save & register" PUTs the full config
  // shape first and only then POSTs the warehouse registration.
  it('save & register: PUTs the full config, then registers, then shows the message', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(/Delhivery Express B2C token/);

    fireEvent.change(screen.getByPlaceholderText(/Delhivery Express B2C token/), {
      target: { value: 'new-token-9' },
    });
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '29BBBBB1111B2Z6' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & register with Delhivery/ }));

    await waitFor(() => {
      const putCalls = callsTo('PUT', '/api/delhivery-config');
      expect(putCalls).toHaveLength(1);
      const body = putCalls[0]?.[2] as Record<string, unknown>;
      expect(body.apiToken).toBe('new-token-9');
      expect(body.gstin).toBe('29BBBBB1111B2Z6');
      expect(body.pickupLocationName).toBe('Main Warehouse');
      expect(body.pickupCutoff).toBe('10:00');
      expect(body.defaultBox).toEqual({ l: 10, b: 10, h: 10 });
    });
    await waitFor(() => expect(callsTo('POST', '/api/delhivery-config/warehouse')).toHaveLength(1));
    // Persist strictly before register.
    const putIndex = mockedApi.mock.calls.findIndex(
      (c) => c[0] === 'PUT' && c[1] === '/api/delhivery-config',
    );
    const registerIndex = mockedApi.mock.calls.findIndex(
      (c) => c[0] === 'POST' && c[1] === '/api/delhivery-config/warehouse',
    );
    expect(putIndex).toBeLessThan(registerIndex);
    // Delhivery's own outcome message is rendered.
    await waitFor(() =>
      expect(screen.getByText(/A new client warehouse has been created/)).toBeInTheDocument(),
    );
  });

  // form.tokenOptionalOnEdit, when a token is already saved, editing other
  // fields with the token left blank still submits (backend keeps the stored one).
  it('saves with the token left blank when one is already stored', async () => {
    routeApi(makeConfig({ hasApiToken: true }));
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(/Delhivery Express B2C token/);

    // Change only the GSTIN; leave the token field blank.
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '29BBBBB1111B2Z6' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & register with Delhivery/ }));

    await waitFor(() => {
      const putCalls = callsTo('PUT', '/api/delhivery-config');
      expect(putCalls).toHaveLength(1);
      const body = putCalls[0]?.[2] as Record<string, unknown>;
      expect(body.apiToken).toBe('');
      expect(body.gstin).toBe('29BBBBB1111B2Z6');
    });
    expect(screen.queryByText('API token is required')).not.toBeInTheDocument();
  });

  // pickup.warehouseFailureMessage, a failed registration surfaces Delhivery's
  // OWN reason verbatim (not a hardcoded string), and the config stays saved.
  it("surfaces Delhivery's own message on a failed warehouse registration", async () => {
    routeApi(
      makeConfig(),
      { ok: true, status: 200 },
      {
        warehouseStatus: 'failed',
        warehouseMessage: 'ClientWarehouse pincode is not serviceable',
      },
    );
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(/Delhivery Express B2C token/);

    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '29BBBBB1111B2Z6' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & register with Delhivery/ }));

    await waitFor(() => expect(screen.getByText(/pincode is not serviceable/)).toBeInTheDocument());
    // The PUT still persisted the config before the carrier failure surfaced.
    expect(callsTo('PUT', '/api/delhivery-config')).toHaveLength(1);
  });

  // pickup.registrationUnreachable, a rejected POST (e.g. Delhivery timing out
  // behind the backend) reports "saved locally" instead of a silent failure.
  it('shows a saved-locally warning when the registration call itself fails', async () => {
    routeApi(makeConfig(), { ok: true, status: 200 }, new Error('Request timed out'));
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(/Delhivery Express B2C token/);

    fireEvent.click(screen.getByRole('button', { name: /Save & register with Delhivery/ }));

    await waitFor(() =>
      expect(
        screen.getByText(/Saved locally. Warehouse registration failed: Request timed out/),
      ).toBeInTheDocument(),
    );
    expect(callsTo('PUT', '/api/delhivery-config')).toHaveLength(1);
  });
});
