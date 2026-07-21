import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryRow, SubmissionListItem } from '@/hooks/useSubmissions';
import { ApiException, api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { SubmissionsScreen } from './submissions.$formId';

// Mock only the `api` fetch wrapper; keep the real `ApiException` so the
// component's `err instanceof ApiException` fallback branch works.
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: vi.fn() };
});
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    useNavigate: () => vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

function makeSubmission(overrides: Partial<SubmissionListItem> = {}): SubmissionListItem {
  return {
    id: 'sub_1',
    formId: 'form_1',
    data: { full_name: 'Asha', email: 'asha@example.com', city: 'Pune', extra: 'hidden' },
    files: {},
    recaptchaScore: 0.9,
    createdAt: '2026-07-02T09:30:00.000Z',
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: 11,
    submissionId: 'sub_1',
    formId: 'form_1',
    url: 'https://hooks.example/inbound',
    status: 'failed',
    attempts: 3,
    lastStatusCode: 500,
    nextRetryAt: null,
    createdAt: '2026-07-02T09:31:00.000Z',
    updatedAt: '2026-07-02T10:31:00.000Z',
    ...overrides,
  };
}

function routeApi({
  submissions = [makeSubmission()],
  hasMore = false,
  deliveries = [makeDelivery()],
}: {
  submissions?: SubmissionListItem[];
  hasMore?: boolean;
  deliveries?: DeliveryRow[];
} = {}) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path === '/api/forms/form_1') {
      return Promise.resolve({ id: 'form_1', name: 'Contact us', schema: [], status: 'active' });
    }
    if (method === 'GET' && path.startsWith('/api/forms/form_1/submissions')) {
      return Promise.resolve({ submissions, page: 1, limit: 20, hasMore });
    }
    if (method === 'GET' && path.startsWith('/api/submissions/')) {
      return Promise.resolve({
        ...makeSubmission({ files: { resume: 'm1/form_1/sub_1/resume' } }),
        fileUrls: { resume: 'https://s3.example/signed/resume?sig=abc' },
      });
    }
    if (method === 'GET' && path.startsWith('/api/forms/form_1/deliveries')) {
      return Promise.resolve({ deliveries, page: 1, limit: 20, hasMore: false });
    }
    if (method === 'POST' && path === '/api/deliveries/11/retrigger') {
      return Promise.resolve({ status: 'pending' });
    }
    if (method === 'POST' && path === '/api/forms/form_1/exports') {
      return Promise.resolve({ jobId: 'exp_1', status: 'pending' });
    }
    if (method === 'GET' && path.startsWith('/api/forms/form_1/exports/')) {
      return Promise.resolve({
        status: 'ready',
        rowCount: 3,
        downloadUrl: 'https://s3.example/exports/exp_1.csv?sig=abc',
      });
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('SubmissionsScreen', () => {
  it('renders the paginated table with date + first-3-values preview', async () => {
    routeApi();
    renderWithProviders(<SubmissionsScreen formId="form_1" />);
    await waitFor(() =>
      expect(
        screen.getByText('full_name: Asha, email: asha@example.com, city: Pune'),
      ).toBeInTheDocument(),
    );
    // Preview truncates to the first 3 field values.
    expect(screen.queryByText(/extra: hidden/)).not.toBeInTheDocument();
    // Denser table rows (G2).
    expect(document.querySelector('.ant-table-small')).not.toBeNull();
    const listCall = mockedApi.mock.calls.find(
      (c) => c[0] === 'GET' && String(c[1]).startsWith('/api/forms/form_1/submissions'),
    );
    expect(String(listCall?.[1])).toContain('page=1&limit=20');
  });

  it('requests the next page through server pagination', async () => {
    routeApi({ hasMore: true });
    renderWithProviders(<SubmissionsScreen formId="form_1" />);
    await screen.findByText(/full_name: Asha/);
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(
        (c) => c[0] === 'GET' && String(c[1]).includes('/submissions?page=2'),
      );
      expect(call).toBeDefined();
    });
  });

  it('expanding a row fetches the detail and renders file links from signed URLs', async () => {
    routeApi();
    renderWithProviders(<SubmissionsScreen formId="form_1" />);
    await screen.findByText(/full_name: Asha/);
    // No detail call until the row is expanded.
    expect(
      mockedApi.mock.calls.find((c) => String(c[1]).startsWith('/api/submissions/')),
    ).toBeUndefined();
    fireEvent.click(screen.getByLabelText('Expand row'));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(
        (c) => c[0] === 'GET' && c[1] === '/api/submissions/sub_1',
      );
      expect(call).toBeDefined();
    });
    const link = await screen.findByRole('link', { name: 'Download file' });
    expect(link).toHaveAttribute('href', 'https://s3.example/signed/resume?sig=abc');
    // All field values are shown, not just the preview subset.
    expect(screen.getByText('extra')).toBeInTheDocument();
  });

  it('Export CSV creates a background job, polls it, and navigates to the signed URL when ready', async () => {
    routeApi();
    // Capture the plain S3 navigation without triggering a real one.
    let navigatedTo = '';
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      get: () => navigatedTo,
      set: (v: string) => {
        navigatedTo = v;
      },
    });
    renderWithProviders(<SubmissionsScreen formId="form_1" />);
    await screen.findByText(/full_name: Asha/);
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    // POST creates the job…
    await waitFor(() => {
      const post = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/forms/form_1/exports',
      );
      expect(post).toBeDefined();
    });
    // …then the poll GET runs and, on ready, the browser navigates to the URL.
    await waitFor(() => {
      const poll = mockedApi.mock.calls.find(
        (c) => c[0] === 'GET' && c[1] === '/api/forms/form_1/exports/exp_1',
      );
      expect(poll).toBeDefined();
    });
    await waitFor(() => expect(navigatedTo).toBe('https://s3.example/exports/exp_1.csv?sig=abc'));
  });

  it('falls back to the sync CSV download when async export is unavailable (503)', async () => {
    routeApi();
    // POST create rejects with the 503 exports_unavailable contract.
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'POST' && path === '/api/forms/form_1/exports') {
        return Promise.reject(new ApiException('nope', 503, 'exports_unavailable'));
      }
      if (method === 'GET' && path === '/api/forms/form_1') {
        return Promise.resolve({ id: 'form_1', name: 'Contact us', schema: [], status: 'active' });
      }
      if (method === 'GET' && path.startsWith('/api/forms/form_1/submissions')) {
        return Promise.resolve({
          submissions: [makeSubmission()],
          page: 1,
          limit: 20,
          hasMore: false,
        });
      }
      return Promise.resolve({});
    });
    // downloadSubmissionsCsv fetches the sync export bytes directly.
    const blob = new Blob(['a,b\n1,2'], { type: 'text/csv' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
    URL.revokeObjectURL = vi.fn();

    renderWithProviders(<SubmissionsScreen formId="form_1" />);
    await screen.findByText(/full_name: Asha/);
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/forms/api/forms/form_1/submissions/export');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-merchant');
    vi.unstubAllGlobals();
  });

  it('deliveries tab shows status + last status code and Retry re-triggers a failed delivery', async () => {
    routeApi();
    renderWithProviders(<SubmissionsScreen formId="form_1" />);
    await screen.findByText(/full_name: Asha/);
    fireEvent.click(screen.getByRole('tab', { name: 'Webhook deliveries' }));
    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument());
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/deliveries/11/retrigger',
      );
      expect(call).toBeDefined();
    });
  });

  it('does not offer Retry for delivered rows', async () => {
    routeApi({ deliveries: [makeDelivery({ status: 'delivered', lastStatusCode: 200 })] });
    renderWithProviders(<SubmissionsScreen formId="form_1" />);
    await screen.findByText(/full_name: Asha/);
    fireEvent.click(screen.getByRole('tab', { name: 'Webhook deliveries' }));
    await waitFor(() => expect(screen.getByText('delivered')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
