import type { WizzyConfig } from '@shared/schemas/wizzy-config';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ConfigPage } from './config';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

function makeConfig(overrides: Partial<WizzyConfig> = {}): WizzyConfig {
  return {
    wizzyEnabled: true,
    storeId: 'my-store',
    hasStoreSecret: false,
    hasApiKey: false,
    needsReconnect: false,
    sdkUrl: 'https://cdn.wizzy.ai/sdk/v2/wizzy.min.js',
    storeUrl: null,
    scriptTagStatus: 'disabled',
    lastBulkSyncAt: null,
    autoSyncEnabled: true,
    includeOutOfStock: true,
    stripHtmlDescription: true,
    ...overrides,
  };
}

function routeApi(config: WizzyConfig) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/wizzy-config' && method === 'GET') return Promise.resolve(config);
    if (path === '/api/wizzy-config' && method === 'PUT') return Promise.resolve(config);
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

describe('ConfigForm', () => {
  it('renders Wizzy connection fields', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await waitFor(() => expect(screen.getByText('Wizzy Connection')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('your-store-id')).toBeInTheDocument();
    expect(screen.getByText('Sync Settings')).toBeInTheDocument();
  });

  it('repopulates storeId from saved config', async () => {
    routeApi(makeConfig({ storeId: 'saved-store-id' }));
    renderWithProviders(<ConfigPage />);
    await waitFor(() => {
      const input = screen.getByPlaceholderText('your-store-id') as HTMLInputElement;
      expect(input.value).toBe('saved-store-id');
    });
  });

  it('shows configured state when hasStoreSecret, reveals empty input on Replace', async () => {
    routeApi(makeConfig({ hasStoreSecret: true }));
    renderWithProviders(<ConfigPage />);
    await waitFor(() => expect(screen.getByText(/Store secret configured/)).toBeInTheDocument());
    expect(screen.queryByPlaceholderText('Enter store secret')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Replace secret/ }));
    const input = (await screen.findByPlaceholderText('Enter store secret')) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('submits PUT without storeSecret when the secret input is empty', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('your-store-id');
    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/wizzy-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect('storeSecret' in body).toBe(false);
      expect(body.storeId).toBe('my-store');
    });
  });

  it('shows configured state when hasApiKey, reveals empty input on Replace', async () => {
    routeApi(makeConfig({ hasApiKey: true }));
    renderWithProviders(<ConfigPage />);
    await waitFor(() => expect(screen.getByText(/API key configured/)).toBeInTheDocument());
    expect(screen.queryByPlaceholderText('Enter API key')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Replace key/ }));
    const input = (await screen.findByPlaceholderText('Enter API key')) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('submits PUT without apiKey when the apiKey input is empty', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('your-store-id');
    fireEvent.click(screen.getByRole('button', { name: /Save configuration/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/wizzy-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect('apiKey' in body).toBe(false);
    });
  });

  it('shows sync setting checkboxes', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await waitFor(() =>
      expect(screen.getByText('Auto-sync on product changes')).toBeInTheDocument(),
    );
    expect(screen.getByText('Include out-of-stock products')).toBeInTheDocument();
    expect(screen.getByText('Strip HTML from product descriptions')).toBeInTheDocument();
  });
});
