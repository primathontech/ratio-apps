import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException, api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ExportPage } from './export';

// Keep the real ApiException (needed for the EMAIL_REQUIRED instanceof check);
// mock only the network call.
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: vi.fn() };
});
vi.mock('@/lib/download', () => ({ downloadAuthenticated: vi.fn() }));

const mockedApi = vi.mocked(api);

function routeApi(
  opts: { count?: number; exports?: unknown[]; onCreate?: () => Promise<unknown> } = {},
) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path === '/api/loyalty-config') {
      return Promise.resolve({ programName: 'Coins', baseEarnRate: 1, coinValueInr: 0.1 });
    }
    if (method === 'GET' && path.startsWith('/api/customers')) {
      return Promise.resolve({ rows: [], total: opts.count ?? 0 });
    }
    if (method === 'GET' && path.startsWith('/api/exports')) {
      return Promise.resolve({
        items: opts.exports ?? [],
        total: (opts.exports ?? []).length,
        page: 1,
        limit: 20,
      });
    }
    if (method === 'POST' && path === '/api/exports') {
      return opts.onCreate ? opts.onCreate() : Promise.resolve({ id: 'e1', status: 'pending' });
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('ExportPage', () => {
  it('renders a filter row and the preview count', async () => {
    routeApi({ count: 42 });
    renderWithProviders(<ExportPage />);
    await waitFor(() => expect(screen.getByTestId('preview-count')).toHaveTextContent('42'));
    expect(screen.getAllByTestId('filter-row').length).toBe(1);
    expect(screen.getByLabelText('Filter field')).toBeInTheDocument();
  });

  it('adds and removes filter rows', async () => {
    routeApi({ count: 1 });
    renderWithProviders(<ExportPage />);
    await screen.findByTestId('preview-count');
    fireEvent.click(screen.getByRole('button', { name: '+ Add filter' }));
    expect(screen.getAllByTestId('filter-row').length).toBe(2);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove filter' });
    fireEvent.click(removeButtons[0] as HTMLElement);
    expect(screen.getAllByTestId('filter-row').length).toBe(1);
  });

  it('requires an email when the preview count exceeds the threshold', async () => {
    routeApi({ count: 15000 });
    renderWithProviders(<ExportPage />);
    await waitFor(() => expect(screen.getByLabelText('Export email')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() =>
      expect(
        screen.getByText(/email is required for exports over 10,000 rows/i),
      ).toBeInTheDocument(),
    );
    expect(
      mockedApi.mock.calls.find((c) => c[0] === 'POST' && c[1] === '/api/exports'),
    ).toBeUndefined();
  });

  it('posts filters and email when over the threshold', async () => {
    routeApi({ count: 15000 });
    renderWithProviders(<ExportPage />);
    const emailInput = await screen.findByLabelText('Export email');
    fireEvent.change(emailInput, { target: { value: 'ops@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find((c) => c[0] === 'POST' && c[1] === '/api/exports');
      expect(call).toBeDefined();
      const body = call?.[2] as { filters: unknown[]; email: string };
      expect(body.email).toBe('ops@example.com');
      expect(Array.isArray(body.filters)).toBe(true);
    });
  });

  it('surfaces a server EMAIL_REQUIRED error as a field error', async () => {
    routeApi({
      count: 50,
      onCreate: () => Promise.reject(new ApiException('email required', 422, 'EMAIL_REQUIRED')),
    });
    renderWithProviders(<ExportPage />);
    await screen.findByTestId('preview-count');
    fireEvent.click(screen.getByRole('button', { name: 'Start export' }));
    await waitFor(() =>
      expect(
        screen.getByText(/email is required for exports over 10,000 rows/i),
      ).toBeInTheDocument(),
    );
  });

  it('enables the download button only for completed exports', async () => {
    routeApi({
      count: 5,
      exports: [
        {
          id: 'e1',
          status: 'done',
          filters: [],
          email: null,
          rowCount: 12,
          emailedAt: null,
          completedAt: '2026-07-01T00:00:00.000Z',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    });
    renderWithProviders(<ExportPage />);
    const dl = await screen.findByRole('button', { name: 'Download CSV' });
    expect(dl).not.toBeDisabled();
  });
});
