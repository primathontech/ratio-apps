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
  putResponse?: Record<string, unknown>,
) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/delhivery-config' && method === 'GET') return Promise.resolve(config);
    if (path === '/api/delhivery-config' && method === 'PUT') {
      return Promise.resolve(
        putResponse ?? {
          ...config,
          warehouseRegistered: true,
          warehouseStatus: 'created',
          warehouseMessage: 'A new client warehouse has been created',
        },
      );
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

    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));

    await waitFor(() => expect(screen.getByText('API token is required')).toBeInTheDocument());
    expect(screen.getByText('pickup location name is required')).toBeInTheDocument();
    expect(screen.getByText('GSTIN is required')).toBeInTheDocument();
    // Save must not have fired.
    expect(
      mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === '/api/delhivery-config'),
    ).toBeUndefined();
  });

  // form.cutoffFormat, pickup cutoff must be HH:mm (24h).
  it('rejects a malformed pickup cutoff', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    const cutoff = await screen.findByPlaceholderText('10:00');

    fireEvent.change(screen.getByPlaceholderText(/Delhivery Express B2C token/), {
      target: { value: 'tok-123' },
    });
    fireEvent.change(cutoff, { target: { value: '25:99' } });
    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));

    await waitFor(() =>
      expect(screen.getByText('pickupCutoff must be HH:mm (24h)')).toBeInTheDocument(),
    );
  });

  // form.awbTriggerToggle, switching to manual is sent to the backend.
  it('saves awbTrigger=manual when the manual option is selected', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(/Delhivery Express B2C token/);

    fireEvent.change(screen.getByPlaceholderText(/Delhivery Express B2C token/), {
      target: { value: 'tok-123' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Manual: create from Shipments/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/delhivery-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect(body.awbTrigger).toBe('manual');
      expect(body.apiToken).toBe('tok-123');
    });
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

  // form.saveBindsApi, a valid submit PUTs the full config shape.
  it('submits the full config to PUT /api/delhivery-config and shows Saved', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(/Delhivery Express B2C token/);

    fireEvent.change(screen.getByPlaceholderText(/Delhivery Express B2C token/), {
      target: { value: 'new-token-9' },
    });
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '29BBBBB1111B2Z6' } });
    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/delhivery-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect(body.apiToken).toBe('new-token-9');
      expect(body.gstin).toBe('29BBBBB1111B2Z6');
      expect(body.pickupLocationName).toBe('Main Warehouse');
      expect(body.pickupCutoff).toBe('10:00');
      expect(body.defaultBox).toEqual({ l: 10, b: 10, h: 10 });
    });
    await waitFor(() => expect(screen.getByText(/Saved/)).toBeInTheDocument());
  });

  // form.tokenOptionalOnEdit, when a token is already saved, editing other
  // fields with the token left blank still submits (backend keeps the stored one).
  it('saves with the token left blank when one is already stored', async () => {
    routeApi(makeConfig({ hasApiToken: true }));
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(/Delhivery Express B2C token/);

    // Change only the GSTIN; leave the token field blank.
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '29BBBBB1111B2Z6' } });
    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/delhivery-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect(body.apiToken).toBe('');
      expect(body.gstin).toBe('29BBBBB1111B2Z6');
    });
    expect(screen.queryByText('API token is required')).not.toBeInTheDocument();
  });

  // form.warehouseFailureMessage, a failed warehouse sync surfaces Delhivery's OWN
  // reason verbatim (not a hardcoded string).
  it('surfaces Delhivery\'s own message on a failed warehouse registration', async () => {
    routeApi(makeConfig(), { ok: true, status: 200 }, {
      ...makeConfig(),
      warehouseRegistered: false,
      warehouseStatus: 'failed',
      warehouseMessage: 'ClientWarehouse pincode is not serviceable',
    });
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText(/Delhivery Express B2C token/);

    fireEvent.change(screen.getByPlaceholderText(/Delhivery Express B2C token/), {
      target: { value: 'new-token-9' },
    });
    fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '29BBBBB1111B2Z6' } });
    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));

    await waitFor(() =>
      expect(screen.getByText(/pincode is not serviceable/)).toBeInTheDocument(),
    );
  });
});
