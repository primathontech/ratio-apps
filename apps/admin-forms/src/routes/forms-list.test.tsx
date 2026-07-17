import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormListItem } from '@/hooks/useForms';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { FormsListPage } from './index';

vi.mock('@/lib/api');
const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    useNavigate: () => navigateMock,
  };
});

const mockedApi = vi.mocked(api);

function makeRow(overrides: Partial<FormListItem> = {}): FormListItem {
  return {
    id: 'form_1',
    name: 'Contact us',
    status: 'active',
    submissionCount: 4,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function routeApi(rows: FormListItem[]) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path.startsWith('/api/forms')) {
      return Promise.resolve({ forms: rows, page: 1, limit: 20, hasMore: false });
    }
    if (method === 'POST' && /\/(activate|deactivate)$/.test(path)) {
      return Promise.resolve({
        ...makeRow(),
        status: path.endsWith('activate') ? 'active' : 'inactive',
      });
    }
    if (method === 'POST' && path.endsWith('/duplicate')) {
      return Promise.resolve({ ...makeRow(), id: 'form_copy', name: 'Contact us (copy)' });
    }
    if (method === 'POST' && path === '/api/forms') {
      return Promise.resolve({ ...makeRow(), id: 'form_new', name: 'Untitled form' });
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
  navigateMock.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('FormsListPage', () => {
  it('renders rows with name, status tag, submission count and created date', async () => {
    routeApi([
      makeRow(),
      makeRow({ id: 'form_2', name: 'Waitlist', status: 'inactive', submissionCount: 0 }),
    ]);
    renderWithProviders(<FormsListPage />);
    await waitFor(() => expect(screen.getByText('Contact us')).toBeInTheDocument());
    expect(screen.getByText('Waitlist')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows the empty state with a CTA when there are no forms', async () => {
    routeApi([]);
    renderWithProviders(<FormsListPage />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Create your first form/ })).toBeInTheDocument(),
    );
  });

  it('status switch calls the deactivate endpoint for an active form', async () => {
    routeApi([makeRow()]);
    renderWithProviders(<FormsListPage />);
    const toggle = await screen.findByRole('switch', { name: 'Toggle Contact us' });
    fireEvent.click(toggle);
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/forms/form_1/deactivate',
      );
      expect(call).toBeDefined();
    });
  });

  it('New Form POSTs a minimal starter form and navigates to its builder', async () => {
    routeApi([makeRow()]);
    renderWithProviders(<FormsListPage />);
    fireEvent.click(await screen.findByRole('button', { name: /New Form/ }));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find((c) => c[0] === 'POST' && c[1] === '/api/forms');
      expect(call).toBeDefined();
      const body = call?.[2] as { name: string; schema: unknown[] };
      expect(body.name).toBe('Untitled form');
      expect(body.schema).toHaveLength(1);
      expect((body.schema[0] as { type: string }).type).toBe('text');
    });
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/builder/$formId',
        params: { formId: 'form_new' },
      }),
    );
  });

  it('Duplicate calls the endpoint and navigates to the copy', async () => {
    routeApi([makeRow()]);
    renderWithProviders(<FormsListPage />);
    fireEvent.click(await screen.findByLabelText('Actions for Contact us'));
    fireEvent.click(await screen.findByText('Duplicate'));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/forms/form_1/duplicate',
      );
      expect(call).toBeDefined();
    });
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/builder/$formId',
        params: { formId: 'form_copy' },
      }),
    );
  });

  it('Delete warns about existing submissions before issuing the DELETE', async () => {
    routeApi([makeRow({ submissionCount: 7 })]);
    renderWithProviders(<FormsListPage />);
    fireEvent.click(await screen.findByLabelText('Actions for Contact us'));
    fireEvent.click(await screen.findByText('Delete'));
    // The warning modal must mention the submission count BEFORE any DELETE.
    await waitFor(() => expect(screen.getByText(/7 submissions/)).toBeInTheDocument());
    expect(mockedApi.mock.calls.find((c) => c[0] === 'DELETE')).toBeUndefined();
    // Clicking Delete opens the modal — it must NOT navigate into the builder
    // (regression: the portaled menu click used to bubble to the row onClick).
    expect(navigateMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(
        (c) => c[0] === 'DELETE' && c[1] === '/api/forms/form_1',
      );
      expect(call).toBeDefined();
    });
  });
});
