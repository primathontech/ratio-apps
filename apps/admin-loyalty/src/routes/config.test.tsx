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
    storefrontBaseUrl: 'https://wellversed.in',
    exportEmail: 'ops@example.com',
    ...overrides,
  };
}

function routeApi(
  config: LoyaltyConfig,
  opts: { claimSecret?: string; rotatedSecret?: string } = {},
) {
  const claimSecret = opts.claimSecret ?? 'claim-secret-value';
  const rotatedSecret = opts.rotatedSecret ?? 'rotated-secret-value';
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/loyalty-config' && method === 'GET') return Promise.resolve(config);
    if (path === '/api/loyalty-config' && method === 'PUT') return Promise.resolve(config);
    if (path === '/api/loyalty-config/claim-secret' && method === 'GET')
      return Promise.resolve({ secret: claimSecret });
    if (path === '/api/loyalty-config/claim-secret/rotate' && method === 'POST')
      return Promise.resolve({ secret: rotatedSecret });
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
      const input = screen.getByPlaceholderText('https://wellversed.in') as HTMLInputElement;
      expect(input.value).toBe('https://wellversed.in');
    });
  });

  // Core Loyalty owns naming / earn rate / coin valuation — the Settings form
  // must not offer them at all (removed 2026-07-31).
  it('does not render the Core-owned fields', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('https://wellversed.in');
    expect(screen.queryByText(/Program name/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Base earn rate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Coin value/)).not.toBeInTheDocument();
  });

  it('blocks submit and shows an error when the storefront URL is invalid', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    const urlInput = (await screen.findByPlaceholderText(
      'https://wellversed.in',
    )) as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));

    await waitFor(() => expect(screen.getByText(/invalid fields/i)).toBeInTheDocument());
    const putCall = mockedApi.mock.calls.find((c) => c[0] === 'PUT');
    expect(putCall).toBeUndefined();
  });

  it('PUTs a shared-schema payload on a valid submit', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('https://wellversed.in');
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));

    await waitFor(() => {
      const putCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'PUT' && c[1] === '/api/loyalty-config',
      );
      expect(putCall).toBeDefined();
      const body = putCall?.[2] as Record<string, unknown>;
      expect(body.storefrontBaseUrl).toBe('https://wellversed.in');
      expect(body.exportEmail).toBe('ops@example.com');
      expect('programName' in body).toBe(false);
      expect('baseEarnRate' in body).toBe(false);
      expect('coinValueInr' in body).toBe(false);
    });
  });

  it('shows a success alert after saving', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('https://wellversed.in');
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());
  });
});

describe('ConfigPage — storefront claim secret', () => {
  it('is masked until "Reveal secret" is clicked, then shows the copy block', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('https://wellversed.in');

    expect(screen.queryByText(/LOYALTY_CLAIM_SECRET=/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reveal secret/ }));

    await waitFor(() => {
      expect(screen.getByText(/LOYALTY_CLAIM_SECRET=claim-secret-value/)).toBeInTheDocument();
    });
    const getCall = mockedApi.mock.calls.find(
      (c) => c[0] === 'GET' && c[1] === '/api/loyalty-config/claim-secret',
    );
    expect(getCall).toBeDefined();
  });

  it('calls rotate and shows the newly rotated secret', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('https://wellversed.in');

    fireEvent.click(screen.getByRole('button', { name: /Rotate secret/ }));

    await waitFor(() => {
      expect(screen.getByText(/LOYALTY_CLAIM_SECRET=rotated-secret-value/)).toBeInTheDocument();
    });
    const postCall = mockedApi.mock.calls.find(
      (c) => c[0] === 'POST' && c[1] === '/api/loyalty-config/claim-secret/rotate',
    );
    expect(postCall).toBeDefined();
  });
});
