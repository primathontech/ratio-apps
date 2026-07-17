import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { Overview } from './index';

vi.mock('@/lib/api');
// The landing page renders <Link> elements; stub the router's Link so the
// overview can render without a RouterProvider in unit tests.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...mod,
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
  };
});

const mockedApi = vi.mocked(api);

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/merchants/me') {
      return Promise.resolve({ id: 'mer_1', isActive: true });
    }
    if (method === 'GET' && path === '/api/delhivery-config') {
      return Promise.resolve({
        apiTokenMasked: '••••bcd4',
        hasApiToken: true,
        pickupLocationName: 'Main Warehouse',
        gstin: '22AAAAA0000A1Z5',
        pickupCutoff: '10:00',
        awbTrigger: 'auto',
        defaultBox: { l: 10, b: 10, h: 10 },
        enabled: true,
      });
    }
    return Promise.resolve({});
  });
});

afterEach(() => vi.clearAllMocks());

describe('Overview (landing)', () => {
  it('shows the setup status and links to Config and Shipments', async () => {
    renderWithProviders(<Overview />);
    await waitFor(() => expect(screen.getByText('Setup status')).toBeInTheDocument());
    expect(screen.getByText('Ratio install')).toBeInTheDocument();
    expect(screen.getByText('Delhivery API token')).toBeInTheDocument();
    expect(screen.getByText('Shipping enabled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View shipments/ })).toHaveAttribute(
      'href',
      '/shipments',
    );
    expect(screen.getByRole('link', { name: /Configure Delhivery/ })).toHaveAttribute(
      'href',
      '/config',
    );
  });
});
