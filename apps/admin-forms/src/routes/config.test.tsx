import type { FormsConfig } from '@shared/schemas/forms-config';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ConfigPage } from './config';

vi.mock('@/lib/api');
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  };
});

const mockedApi = vi.mocked(api);

function makeConfig(overrides: Partial<FormsConfig> = {}): FormsConfig {
  return {
    recaptchaSiteKey: '6LtestSiteKey',
    recaptchaThreshold: 0.3,
    defaultNotificationEmail: 'leads@shop.in',
    formsEnabled: true,
    hasRecaptchaSecret: true,
    emailBounced: false,
    ...overrides,
  };
}

function routeApi(config: FormsConfig) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (path === '/api/forms-config' && method === 'GET') return Promise.resolve(config);
    if (path === '/api/forms-config' && method === 'PUT') return Promise.resolve(config);
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('ConfigPage', () => {
  it('renders the three cards pre-filled from GET (never the secret)', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await waitFor(() => expect(screen.getByText('reCAPTCHA v3')).toBeInTheDocument());
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Kill switch')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('6L...')).toHaveValue('6LtestSiteKey');
    expect(screen.getByPlaceholderText('leads@yourstore.in')).toHaveValue('leads@shop.in');
  });

  it('never pre-fills the secret; shows the saved placeholder when hasRecaptchaSecret', async () => {
    routeApi(makeConfig({ hasRecaptchaSecret: true }));
    renderWithProviders(<ConfigPage />);
    const secret = (await screen.findByPlaceholderText('••••• saved')) as HTMLInputElement;
    expect(secret.value).toBe('');
  });

  it('omits recaptchaSecret from the PUT when the field is left blank', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    await screen.findByPlaceholderText('••••• saved');
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));
    await waitFor(() => {
      const put = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === '/api/forms-config');
      expect(put).toBeDefined();
      const body = put?.[2] as Record<string, unknown>;
      expect('recaptchaSecret' in body).toBe(false);
      expect(body.recaptchaSiteKey).toBe('6LtestSiteKey');
      expect(body.formsEnabled).toBe(true);
    });
  });

  it('sends a newly typed secret in the PUT body', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    const secret = await screen.findByPlaceholderText('••••• saved');
    fireEvent.change(secret, { target: { value: 'new-secret-value' } });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));
    await waitFor(() => {
      const put = mockedApi.mock.calls.find((c) => c[0] === 'PUT' && c[1] === '/api/forms-config');
      expect((put?.[2] as Record<string, unknown>).recaptchaSecret).toBe('new-secret-value');
    });
  });

  it('rejects an out-of-bounds threshold with a visible error and no PUT', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    const threshold = await screen.findByLabelText('Score threshold');
    fireEvent.change(threshold, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));
    await waitFor(() =>
      expect(screen.getByText(/threshold must be between 0 and 1/)).toBeInTheDocument(),
    );
    expect(mockedApi.mock.calls.find((c) => c[0] === 'PUT')).toBeUndefined();
  });

  it('rejects an invalid default notification email', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    const email = await screen.findByPlaceholderText('leads@yourstore.in');
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));
    await waitFor(() => expect(screen.getByText(/must be a valid email/)).toBeInTheDocument());
  });

  it('shows the bounce warning banner when emailBounced is set', async () => {
    routeApi(makeConfig({ emailBounced: true }));
    renderWithProviders(<ConfigPage />);
    await waitFor(() =>
      expect(screen.getByText('Notification emails are bouncing')).toBeInTheDocument(),
    );
  });

  it('asks for confirmation before disabling the kill switch', async () => {
    routeApi(makeConfig());
    renderWithProviders(<ConfigPage />);
    const killSwitch = await screen.findByRole('switch', { name: 'Forms enabled' });
    fireEvent.click(killSwitch);
    // Confirm modal appears; the switch has NOT flipped yet.
    await waitFor(() => expect(screen.getByText('Disable all forms?')).toBeInTheDocument());
    expect(screen.getByText('Forms are enabled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disable forms' }));
    await waitFor(() => expect(screen.getByText('Forms are disabled')).toBeInTheDocument());
  });
});
