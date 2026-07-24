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
      {
        key: 'full_name',
        type: 'text',
        label: 'Full name',
        required: true,
        width: 'full',
        showCounter: false,
      },
      {
        key: 'email',
        type: 'email',
        label: 'Email',
        required: true,
        width: 'full',
        showCounter: false,
      },
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
    // The grouped palette offers every input and layout-block type.
    expect(screen.getByRole('button', { name: 'Paragraph' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File upload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text block' })).toBeInTheDocument();
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

  it('reveals a collapsible full-width live preview with a device toggle', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    // Collapsed by default so the editor keeps its space.
    expect(screen.queryByTestId('preview-desktop')).not.toBeInTheDocument();
    // The header switch reveals the full-width panel; the editor stays mounted.
    fireEvent.click(screen.getByRole('switch', { name: 'Live preview' }));
    const desktop = await screen.findByTestId('preview-desktop');
    expect(screen.getByTestId('canvas-field-full_name')).toBeInTheDocument();
    // With the panel full width, Desktop renders a real, wide frame (up to 680px)
    // rather than the cramped 375px it shared with Mobile in the old side panel.
    expect(desktop).toHaveStyle({ maxWidth: '680px' });
    // The panel embeds the real storefront element; the current schema renders
    // inside its shadow root (no hand-rolled duplicate markup).
    const el = document.querySelector('ratio-form');
    expect(el).not.toBeNull();
    await waitFor(() => expect(el?.shadowRoot?.textContent).toContain('Full name'));
    // The device toggle swaps the wide desktop frame for the 375px mobile frame.
    const mobileToggle = screen.getByText('Mobile').closest('label')?.querySelector('input');
    if (!mobileToggle) throw new Error('no mobile device toggle');
    fireEvent.click(mobileToggle);
    const mobile = await screen.findByTestId('preview-mobile');
    expect(mobile).toHaveStyle({ width: '375px' });
    // Toggling the switch off collapses the panel again.
    fireEvent.click(screen.getByRole('switch', { name: 'Live preview' }));
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

  it('adds a Heading content block whose panel has text (no label) and saves it (§1.3)', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    // The palette now offers content blocks alongside inputs.
    fireEvent.click(screen.getByRole('button', { name: 'Heading' }));
    // Its property panel edits heading text and has no collectable-field "Label".
    const headingText = await screen.findByLabelText('Heading text');
    expect(screen.queryByLabelText('Field label')).not.toBeInTheDocument();
    fireEvent.change(headingText, { target: { value: 'Tell us about you' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === '/api/forms/form_1');
      const parsed = formInputSchema.safeParse(put?.[2]);
      expect(parsed.success).toBe(true);
      const heading = parsed.success && parsed.data.schema.find((f) => f.type === 'heading');
      expect(heading && 'text' in heading && heading.text).toBe('Tell us about you');
    });
  });

  it('saves per-field adornments (prefix, help text, counter) for a text field (§2.3)', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByTestId('canvas-field-full_name'));
    await screen.findByLabelText('Field label');
    fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: '$' } });
    fireEvent.change(screen.getByLabelText('Help text'), {
      target: { value: 'Enter your legal name' },
    });
    fireEvent.change(screen.getByLabelText('Custom error message'), {
      target: { value: 'Please enter your full legal name.' },
    });
    fireEvent.click(screen.getByLabelText('Show character counter'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === '/api/forms/form_1');
      const parsed = formInputSchema.safeParse(put?.[2]);
      expect(parsed.success).toBe(true);
      const field = parsed.success && parsed.data.schema[0];
      expect(field && 'prefix' in field && field.prefix).toBe('$');
      expect(field && 'helpText' in field && field.helpText).toBe('Enter your legal name');
      expect(field && 'errorMessage' in field && field.errorMessage).toBe(
        'Please enter your full legal name.',
      );
      expect(field && 'showCounter' in field && field.showCounter).toBe(true);
    });
  });

  it('does not offer adornments for a non-text-like field like Dropdown (§2.3)', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByRole('button', { name: 'Dropdown' }));
    // The newly-added dropdown is auto-selected; its panel has options, not adornments.
    await screen.findByText('Options');
    expect(screen.queryByLabelText('Prefix')).not.toBeInTheDocument();
    // But every collectable field still gets the Advanced style section (§2.2).
    expect(screen.getByText('Advanced style')).toBeInTheDocument();
  });

  it('offers prefix/suffix but no counter for an adornable-only field like Email (§2.3)', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByTestId('canvas-field-email'));
    await screen.findByLabelText('Field label');
    // Email is in FORM_ADORNABLE_FIELD_TYPES but not FORM_COUNTER_FIELD_TYPES.
    expect(screen.getByLabelText('Prefix')).toBeInTheDocument();
    expect(screen.getByLabelText('Suffix')).toBeInTheDocument();
    expect(screen.queryByLabelText('Show character counter')).not.toBeInTheDocument();
  });

  it('offers the counter but no prefix/suffix for a counter-only field like Paragraph (§2.3)', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByRole('button', { name: 'Paragraph' }));
    // The newly-added textarea is auto-selected. It is counter-only: no chip, has a counter.
    await screen.findByLabelText('Field label');
    expect(screen.queryByLabelText('Prefix')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Suffix')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Show character counter')).toBeInTheDocument();
  });

  it('offers no adornments for Phone, which carries neither a chip nor a counter (§2.3)', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByRole('button', { name: 'Phone' }));
    // Phone is in neither shared set: it owns its +91 chip and has no maxLength.
    await screen.findByLabelText('Field label');
    expect(screen.queryByLabelText('Prefix')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Show character counter')).not.toBeInTheDocument();
    // The type-specific note is a subtle inline hint, not a padded Alert box.
    expect(
      screen.getByText('Accepts Indian mobile numbers only (+91, 10 digits).'),
    ).toBeInTheDocument();
  });

  it('pins a per-field input variant through Advanced style and saves it (§2.2)', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByTestId('canvas-field-full_name'));
    await screen.findByLabelText('Field label');
    // Expand the collapsed "Advanced style" section, then pick a non-inherit
    // variant from the input-style Select.
    fireEvent.click(screen.getByText('Advanced style'));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Field input style' }));
    fireEvent.click(await screen.findByText('Filled'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === '/api/forms/form_1');
      const parsed = formInputSchema.safeParse(put?.[2]);
      expect(parsed.success).toBe(true);
      const field = parsed.success && parsed.data.schema[0];
      expect(field && 'style' in field && field.style?.inputVariant).toBe('filled');
    });
  });

  it('sets a field to half width and saves it in the payload', async () => {
    routeApi(makeForm());
    renderWithProviders(<BuilderScreen formId="form_1" />);
    await screen.findByText('Full name');
    fireEvent.click(screen.getByTestId('canvas-field-full_name'));
    await screen.findByLabelText('Field label');
    const half = screen.getByText('Half width');
    fireEvent.click(half.closest('label') ?? half);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === '/api/forms/form_1');
      const parsed = formInputSchema.safeParse(put?.[2]);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.schema[0]?.width).toBe('half');
    });
  });
});
