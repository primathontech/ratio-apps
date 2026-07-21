import type { LoyaltyConfig } from '@shared/schemas/loyalty-config';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ConfigPage } from './config';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

function makeConfig(overrides: Partial<LoyaltyConfig> = {}): LoyaltyConfig {
  return {
    programName: 'Wellversed Coins',
    baseEarnRate: 1,
    coinValueInr: 0.1,
    storefrontBaseUrl: 'https://wellversed.in',
    exportEmail: 'ops@example.com',
    ...overrides,
  };
}

function routeApi(config: LoyaltyConfig) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/loyalty-config' && method === 'GET') return Promise.resolve(config);
    if (path === '/api/loyalty-config' && method === 'PUT') return Promise.resolve(config);
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('ConfigPage', () => {
  it('prefills the form from the GET config', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await waitFor(() => {
      const input = screen.getByPlaceholderText('Coins') as HTMLInputElement;
      expect(input.value).toBe('Wellversed Coins');
    });
  });

  it('blocks submit and shows an error when the earn rate is invalid', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    const rateInput = (await screen.findByPlaceholderText('1')) as HTMLInputElement;
    fireEvent.change(rateInput, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));

    await waitFor(() => expect(screen.getByText(/invalid fields/i)).toBeInTheDocument());
    const putCall = mockedApi.mock.calls.find((c) => c[0] === 'PUT');
    expect(putCall).toBeUndefined();
  });

  it('PUTs a shared-schema payload on a valid submit', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('Coins');
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/loyalty-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect(body.programName).toBe('Wellversed Coins');
      expect(body.storefrontBaseUrl).toBe('https://wellversed.in');
    });
  });

  it('shows a success alert after saving', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('Coins');
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());
  });
});
