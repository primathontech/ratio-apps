import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { BulkPage } from './bulk';

vi.mock('@/lib/api');
vi.mock('@/lib/download', () => ({
  downloadAuthenticated: vi.fn(),
  downloadTextFile: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const doneOp = {
  id: 'op1',
  type: 'credit',
  status: 'done',
  fileName: 'test.csv',
  totalRows: 2,
  validRows: 2,
  invalidRows: 0,
  processedRows: 2,
  successCount: 2,
  failureCount: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
};

function routeApi() {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path.startsWith('/api/bulk-operations?')) {
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 10 });
    }
    if (method === 'POST' && path === '/api/bulk-operations') {
      return Promise.resolve({ ...doneOp, status: 'validating', processedRows: 0 });
    }
    if (method === 'POST' && /\/rows$/.test(path)) {
      return Promise.resolve({ received: 2, validRows: 2, invalidRows: 0 });
    }
    if (method === 'POST' && /\/confirm$/.test(path)) {
      return Promise.resolve({ ...doneOp, duplicateWarnings: 0 });
    }
    if (method === 'GET' && /\/api\/bulk-operations\/op1$/.test(path)) {
      return Promise.resolve(doneOp);
    }
    return Promise.resolve({});
  });
}

function uploadCsv(text: string) {
  const file = new File([text], 'test.csv', { type: 'text/csv' });
  const input = screen.getByLabelText('CSV file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
  routeApi();
});

afterEach(() => vi.clearAllMocks());

describe('BulkPage', () => {
  it('previews valid/invalid counts and total coins', async () => {
    renderWithProviders(<BulkPage />);
    uploadCsv('9876543210,100\n9876500000,200\nbadphone,50');
    await waitFor(() => expect(screen.getByText(/Valid rows:/)).toBeInTheDocument());
    expect(screen.getByText(/Valid rows:/)).toHaveTextContent('Valid rows: 2');
    expect(screen.getByText(/Valid rows:/)).toHaveTextContent('Invalid rows: 1');
    expect(screen.getByRole('button', { name: /Confirm credit of 300 coins/ })).toBeInTheDocument();
  });

  it('warns about duplicate phones (last row wins)', async () => {
    renderWithProviders(<BulkPage />);
    uploadCsv('9876543210,100\n9876543210,200');
    await waitFor(() => expect(screen.getByText(/1 duplicate phone number/)).toBeInTheDocument());
    // Total reflects last-wins: 200, not 300.
    expect(screen.getByRole('button', { name: /Confirm credit of 200 coins/ })).toBeInTheDocument();
  });

  it('posts row chunks then the confirm endpoint, then renders progress', async () => {
    renderWithProviders(<BulkPage />);
    uploadCsv('9876543210,100\n9876500000,200');
    const confirmBtn = await screen.findByRole('button', {
      name: /Confirm credit of 300 coins/,
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const rowsCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && /\/rows$/.test(String(c[1])),
      );
      const confirmCall = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && /\/confirm$/.test(String(c[1])),
      );
      expect(rowsCall).toBeDefined();
      expect(confirmCall).toBeDefined();
    });

    // The rows payload carries the two parsed rows.
    const rowsCall = mockedApi.mock.calls.find(
      (c) => c[0] === 'POST' && /\/rows$/.test(String(c[1])),
    );
    const body = rowsCall?.[2] as { rows: unknown[] };
    expect(body.rows).toHaveLength(2);

    await waitFor(() =>
      expect(screen.getByTestId('bulk-progress')).toHaveTextContent('2 / 2 rows processed'),
    );
  });
});
