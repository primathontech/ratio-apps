import { formInputSchema } from '@shared/schemas/form-schema';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormEntity } from '@/hooks/useForms';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { BuilderScreen } from './builder.$formId';

vi.mock('@/lib/api');
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    useNavigate: () => vi.fn(),
  };
});

const mockedApi = vi.mocked(api);

function makeForm(overrides: Partial<FormEntity> = {}): FormEntity {
  return {
    id: 'form_1',
    name: 'Contact us',
    schema: [
      { key: 'full_name', type: 'text', label: 'Full name', required: true },
      { key: 'email', type: 'email', label: 'Email', required: true },
    ],
    submitLabel: 'Send',
    successMessage: 'Thanks!',
    spamProtection: 'recaptcha',
    notificationEmail: null,
    webhookUrl: 'https://hooks.example/inbound',
    status: 'inactive',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function routeApi(form: FormEntity, webhookStatusCode: number | null = 204) {
  mockedApi.mockImplementation((method: string, path: string, body?: unknown) => {
    if (method === 'GET' && path === `/api/forms/${form.id}`) return Promise.resolve(form);
    if (method === 'PUT' && path === `/api/forms/${form.id}`) {
      return Promise.resolve({ ...form, ...(body as object) });
    }
    if (method === 'POST' && path === `/api/forms/${form.id}/webhook-test`) {
      return Promise.resolve({ statusCode: webhookStatusCode });
    }
    if (method === 'POST' && path === `/api/forms/${form.id}/activate`) {
      return Promise.resolve({ ...form, status: 'active' });
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('BuilderScreen', () => {
  it('loads the form and renders its fields on the canvas', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await waitFor(() => expect(screen.getByText('Full name')).toBeInTheDocument());
    expect(screen.getByText(/full_name/)).toBeInTheDocument();
    expect(screen.getByTestId('canvas-field-email')).toBeInTheDocument();
    // The palette offers all 8 field types.
    expect(screen.getByRole('button', { name: 'Paragraph' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File upload' })).toBeInTheDocument();
  });

  it('Save PUTs a payload that parses with formInputSchema', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    // Add a field via click-to-add, then save.
    fireEvent.click(screen.getByRole('button', { name: 'Dropdown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === '/api/forms/form_1');
      expect(put).toBeDefined();
      const parsed = formInputSchema.safeParse(put?.[2]);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.schema).toHaveLength(3);
    });
  });

  it('surfaces per-field validation errors instead of PUTting an invalid form', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    // Blank the form name (settings panel shows form settings by default).
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText(/name: name is required/)).toBeInTheDocument());
    expect(mockedApi.mock.calls.find((c) => c[0] === 'PUT')).toBeUndefined();
  });

  it('"Send test payload" calls webhook-test and surfaces the response code', async () => {
    routeApi(makeForm(), 404);
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByRole('button', { name: 'Send test payload' }));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/forms/form_1/webhook-test',
      );
      expect(call).toBeDefined();
    });
    await waitFor(() =>
      expect(screen.getByText(/Webhook responded with status 404/)).toBeInTheDocument(),
    );
  });

  it('Preview toggles a mobile (375px) + desktop split render of the current schema', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const mobile = await screen.findByTestId('preview-mobile');
    expect(mobile).toHaveStyle({ width: '375px' });
    expect(screen.getByTestId('preview-desktop')).toBeInTheDocument();
    // Both panes render the same current schema.
    expect(screen.getAllByText('Full name').length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(screen.queryByTestId('preview-mobile')).not.toBeInTheDocument());
  });

  it('Publish calls the activate endpoint for an inactive form', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(
        (c) => c[0] === 'POST' && c[1] === '/api/forms/form_1/activate',
      );
      expect(call).toBeDefined();
    });
  });

  it('selecting a field opens its settings; delete removes it from the canvas', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByTestId('canvas-field-full_name'));
    expect(await screen.findByLabelText('Field label')).toHaveValue('Full name');
    fireEvent.click(screen.getByLabelText('Delete Full name'));
    await waitFor(() =>
      expect(screen.queryByTestId('canvas-field-full_name')).not.toBeInTheDocument(),
    );
  });
});
