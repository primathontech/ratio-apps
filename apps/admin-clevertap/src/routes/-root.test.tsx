import type { Merchant } from '@shared/schemas/merchant';
import { screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { DISABLED_ROUTE } from '@/lib/merchant-gate';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';

vi.mock('@/lib/api');

vi.mock('@tanstack/react-router', () => ({
  createRootRoute: (options: unknown) => options,
  Outlet: () => <div data-testid="outlet" />,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useRouterState: () => ({ location: { pathname: '/config' } }),
}));

vi.mock('@/hooks/useIframeAuth', () => ({
  useIframeAuth: () => ({ isAuthorized: true, parentOrigin: null }),
}));

vi.mock('@/lib/session', () => ({
  readSession: () => 'test-merchant',
  clearSession: () => undefined,
  installPostMessageListener: () => () => undefined,
}));

const mockedApi = vi.mocked(api);

function makeMerchant(isActive: boolean): Merchant {
  return {
    id: 'test-merchant',
    isActive,
    installedAt: new Date('2026-07-01T00:00:00.000Z'),
    uninstalledAt: isActive ? null : new Date('2026-07-20T00:00:00.000Z'),
  };
}

function routeApi(merchant: Merchant) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/merchants/me' && method === 'GET') return Promise.resolve(merchant);
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

describe('RootLayout merchant gate', () => {
  it('routes an INACTIVE merchant to /disabled instead of rendering the app', async () => {
    routeApi(makeMerchant(false));
    const { RootLayout } = await import('./__root');
    renderWithProviders(<RootLayout />);

    await waitFor(() => expect(screen.getByTestId('navigate').textContent).toBe(DISABLED_ROUTE));
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('renders the app shell for an ACTIVE merchant', async () => {
    routeApi(makeMerchant(true));
    const { RootLayout } = await import('./__root');
    renderWithProviders(<RootLayout />);

    await waitFor(() => expect(screen.getByTestId('outlet')).toBeInTheDocument());
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });
});
