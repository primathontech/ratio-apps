import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException, api } from '@/lib/api';
import { downloadTextFile, fetchAuthenticatedText } from '@/lib/download';
import { BULK_CSV_TEMPLATE, BULK_CSV_TEMPLATE_FILENAME } from '@/lib/parse-csv';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { BulkPage } from './bulk';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: vi.fn() };
});
vi.mock('@/lib/download', () => ({
  downloadAuthenticated: vi.fn(),
  downloadTextFile: vi.fn(),
  fetchAuthenticatedText: vi.fn(),
}));

const mockedApi = vi.mocked(api);
const mockedDownloadTextFile = vi.mocked(downloadTextFile);
const mockedDownloadText = mockedDownloadTextFile;
const mockedFetchText = vi.mocked(fetchAuthenticatedText);

/** Switch the page into manual-entry mode. */
function selectManualMode() {
  fireEvent.click(screen.getByRole('radio', { name: 'Manual entry' }));
}

function fillManual({
  phone,
  amount,
  reason,
}: {
  phone?: string;
  amount?: string;
  reason?: string;
}) {
  if (phone !== undefined) {
    fireEvent.change(screen.getByLabelText('Manual phone'), { target: { value: phone } });
  }
  if (amount !== undefined) {
    fireEvent.change(screen.getByLabelText('Manual amount'), { target: { value: amount } });
  }
  if (reason !== undefined) {
    fireEvent.change(screen.getByLabelText('Manual reason'), { target: { value: reason } });
  }
}

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
  totalPoints: 750,
  createdAt: '2026-07-01T00:00:00.000Z',
};

const opRows = {
  items: [
    {
      rowNumber: 1,
      phone: '+919876543210',
      points: 500,
      reason: 'Diwali bonus',
      status: 'success',
      errorReason: null,
      coreTransactionId: 'txn-1',
      processedAt: '2026-07-01T00:01:00.000Z',
    },
    {
      rowNumber: 2,
      phone: '+919876500000',
      points: 250,
      reason: null,
      status: 'failed',
      errorReason: 'Insufficient balance',
      coreTransactionId: null,
      processedAt: '2026-07-01T00:01:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  limit: 50,
};

function routeApi() {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path.startsWith('/api/bulk-operations?')) {
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 10 });
    }
    if (method === 'GET' && /\/rows\?/.test(path)) {
      return Promise.resolve(opRows);
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

  it('offers a sample CSV that is valid by construction', () => {
    renderWithProviders(<BulkPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Download sample CSV' }));
    expect(mockedDownloadTextFile).toHaveBeenCalledWith(
      BULK_CSV_TEMPLATE,
      BULK_CSV_TEMPLATE_FILENAME,
    );
  });

  it('explains why a file produced no usable rows instead of showing an empty preview', async () => {
    renderWithProviders(<BulkPage />);
    uploadCsv('phone_number,amount\n1234567890,100\n5555555555,200');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/None of the 2 rows in this file/),
    );
    // Per-row reasons are listed, not just a count — one per bad row.
    expect(screen.getAllByText(/is not a valid Indian mobile number/)).toHaveLength(2);
    // Nothing to confirm, so no confirm button at all.
    expect(screen.queryByRole('button', { name: /^Confirm/ })).not.toBeInTheDocument();
  });

  it('calls out a header-only file', async () => {
    renderWithProviders(<BulkPage />);
    uploadCsv('phone_number,amount,reason\n');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/header row but no data rows/),
    );
  });

  it('accepts a semicolon-delimited file and says so', async () => {
    renderWithProviders(<BulkPage />);
    uploadCsv('phone_number;amount;reason\n9876543210;100;Diwali');
    await waitFor(() => expect(screen.getByText(/Valid rows:/)).toHaveTextContent('Valid rows: 1'));
    expect(screen.getByText(/Detected semicolon/)).toBeInTheDocument();
  });

  it('chunks large files at 500 rows to stay under the body limit', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => `98765${String(i).padStart(5, '0')},10`);
    renderWithProviders(<BulkPage />);
    uploadCsv(rows.join('\n'));

    const confirmBtn = await screen.findByRole('button', { name: /^Confirm credit of/ });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const rowsCalls = mockedApi.mock.calls.filter(
        (c) => c[0] === 'POST' && /\/rows$/.test(String(c[1])),
      );
      // 1200 rows / 500 = 3 chunks (500, 500, 200) — never one 1200-row body.
      expect(rowsCalls).toHaveLength(3);
      expect((rowsCalls[0]?.[2] as { rows: unknown[] }).rows).toHaveLength(500);
      expect((rowsCalls[2]?.[2] as { rows: unknown[] }).rows).toHaveLength(200);
    });
  });

  it('translates a rate-limit failure into actionable advice', async () => {
    renderWithProviders(<BulkPage />);
    uploadCsv('9876543210,100');
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'POST' && path === '/api/bulk-operations') {
        return Promise.reject(new ApiException('too many requests', 429, 'RATE_LIMITED'));
      }
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 10 });
    });

    fireEvent.click(await screen.findByRole('button', { name: /^Confirm credit of/ }));
    await waitFor(() => expect(screen.getByText(/Wait a minute and retry/)).toBeInTheDocument());
  });
});

describe('BulkPage — manual entry', () => {
  it('reports each missing mandatory field against that field', async () => {
    renderWithProviders(<BulkPage />);
    selectManualMode();
    fireEvent.click(screen.getByRole('button', { name: /Credit coins$/ }));

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));
    const messages = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(messages).toEqual([
      'Phone number is required.',
      'Amount is required.',
      'Reason is required.',
    ]);
    // No request is attempted while the form is invalid.
    expect(mockedApi.mock.calls.filter((c) => c[0] === 'POST')).toHaveLength(0);
  });

  it('rejects a non-Indian mobile against the phone field', async () => {
    renderWithProviders(<BulkPage />);
    selectManualMode();
    fillManual({ phone: '1234567890', amount: '100', reason: 'test' });
    fireEvent.click(screen.getByRole('button', { name: /Credit coins$/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/valid Indian mobile number/),
    );
  });

  it('rejects a fractional amount against the amount field', async () => {
    renderWithProviders(<BulkPage />);
    selectManualMode();
    fillManual({ phone: '9876543210', amount: '10.5', reason: 'test' });
    fireEvent.click(screen.getByRole('button', { name: /Credit coins$/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/whole number of coins/),
    );
  });

  it('credits a customer via the adjust endpoint with a normalized phone', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'POST' && path.includes('/adjust')) {
        return Promise.resolve({ direction: 'credit', points: 500, newBalance: 1500 });
      }
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 10 });
    });

    renderWithProviders(<BulkPage />);
    selectManualMode();
    fillManual({ phone: '98765 43210', amount: '500', reason: 'Goodwill credit' });
    fireEvent.click(screen.getByRole('button', { name: /Credit coins$/ }));

    await waitFor(() => {
      const call = mockedApi.mock.calls.find((c) => String(c[1]).includes('/adjust'));
      expect(call).toBeDefined();
      // Phone is E.164-normalized before it leaves the client.
      expect(String(call?.[1])).toContain(encodeURIComponent('+919876543210'));
      expect(call?.[2]).toEqual({
        direction: 'credit',
        points: 500,
        reason: 'Goodwill credit',
      });
    });

    expect(await screen.findByText(/Credited 500 coins/)).toBeInTheDocument();
  });

  it('debits when the direction is debit, and puts a shortfall on the amount field', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'POST' && path.includes('/adjust')) {
        return Promise.reject(new ApiException('balance too low', 422, 'INSUFFICIENT_BALANCE'));
      }
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 10 });
    });

    renderWithProviders(<BulkPage />);
    selectManualMode();
    fireEvent.click(screen.getByRole('radio', { name: 'Debit coins' }));
    fillManual({ phone: '9876543210', amount: '500', reason: 'Correction' });
    fireEvent.click(screen.getByRole('button', { name: /Debit coins$/ }));

    await waitFor(() => {
      const call = mockedApi.mock.calls.find((c) => String(c[1]).includes('/adjust'));
      expect((call?.[2] as { direction: string }).direction).toBe('debit');
    });
    expect(await screen.findByText(/does not have enough coins/)).toBeInTheDocument();
  });
});

describe('BulkPage — history', () => {
  function routeHistory() {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/api/bulk-operations?')) {
        return Promise.resolve({ items: [doneOp], total: 1, page: 1, limit: 10 });
      }
      if (method === 'GET' && /\/rows\?/.test(path)) return Promise.resolve(opRows);
      return Promise.resolve({});
    });
  }

  it('shows the total coins moved and the customer count per operation', async () => {
    routeHistory();
    renderWithProviders(<BulkPage />);
    // The aggregate the row previously omitted entirely.
    expect(await screen.findByText('+750')).toBeInTheDocument();
    expect(screen.getByText('2 ok / 0 failed of 2')).toBeInTheDocument();
  });

  it('signs a debit total as negative', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/api/bulk-operations?')) {
        return Promise.resolve({
          items: [{ ...doneOp, type: 'debit' }],
          total: 1,
          page: 1,
          limit: 10,
        });
      }
      return Promise.resolve({});
    });
    renderWithProviders(<BulkPage />);
    expect(await screen.findByText('−750')).toBeInTheDocument();
  });

  it('opens the per-operation detail with every customer it touched', async () => {
    routeHistory();
    renderWithProviders(<BulkPage />);

    fireEvent.click(await screen.findByText('test.csv'));

    // Fetches that operation's rows...
    await waitFor(() => {
      const call = mockedApi.mock.calls.find((c) =>
        /\/bulk-operations\/op1\/rows\?/.test(String(c[1])),
      );
      expect(call).toBeDefined();
    });
    // ...and renders each customer with its outcome, including why one failed.
    expect(await screen.findByText('+919876543210')).toBeInTheDocument();
    expect(screen.getByText('+919876500000')).toBeInTheDocument();
    expect(screen.getByText('Diwali bonus')).toBeInTheDocument();
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
  });

  it('previews the failed rows instead of auto-downloading them', async () => {
    // Clicking "errors.csv" used to dump a file into Downloads: to see why a
    // row failed you had to leave the admin and open a spreadsheet.
    const failedOp = { ...doneOp, failureCount: 1, successCount: 1 };
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/api/bulk-operations?')) {
        return Promise.resolve({ items: [failedOp], total: 1, page: 1, limit: 10 });
      }
      return Promise.resolve({});
    });
    mockedFetchText.mockResolvedValue(
      'row_number,phone,points,reason,error_reason\n2,+919876500000,250,Diwali bonus,Insufficient balance\n',
    );

    renderWithProviders(<BulkPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'errors.csv' }));

    // The CSV is rendered as a table, in place...
    expect(await screen.findByText('Insufficient balance')).toBeInTheDocument();
    expect(screen.getByText('+919876500000')).toBeInTheDocument();
    // ...and downloading is a button in the preview, not a side effect.
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
    expect(mockedDownloadText).not.toHaveBeenCalled();
  });

  it('re-queries with the chosen page size — the selector used to be inert', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/api/bulk-operations?')) {
        return Promise.resolve({ items: [doneOp], total: 120, page: 1, limit: 10 });
      }
      return Promise.resolve({});
    });
    renderWithProviders(<BulkPage />);
    await screen.findByText('test.csv');
    expect(mockedApi.mock.calls.some((c) => String(c[1]).includes('limit=10'))).toBe(true);

    // antd renders the size changer as its own select inside the pagination.
    const sizeChanger = document.querySelector(
      '.ant-pagination-options-size-changer .ant-select-selector',
    );
    expect(sizeChanger).not.toBeNull();
    fireEvent.mouseDown(sizeChanger as Element);
    fireEvent.click(await screen.findByTitle('50 / page'));

    await waitFor(() =>
      expect(mockedApi.mock.calls.some((c) => String(c[1]).includes('limit=50'))).toBe(true),
    );
  });
});
