import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ConnectPage } from './index';

// `api` is a plain async function (not an object with .get()/.post()), and it
// already unwraps the backend's envelope. Routed by (method, path) since the
// Connect page now calls THREE distinct endpoints (GET existing credentials
// on mount, POST generate, POST regenerate) that must behave independently.
const apiMock = vi.fn();
vi.mock('../lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  apiMock.mockReset();
});

const FAKE_MERCHANT = {
  id: 'test-merchant-id',
  isActive: true,
  installedAt: '2026-01-01T00:00:00.000Z',
  uninstalledAt: null,
};

describe('ConnectPage — first-time connect (no existing credentials)', () => {
  beforeEach(() => {
    apiMock.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/api/merchants/me') return Promise.resolve(FAKE_MERCHANT);
      if (method === 'GET' && path.startsWith('/admin/credentials')) return Promise.resolve(null);
      if (method === 'POST' && path === '/admin/credentials/generate') {
        return Promise.resolve({
          username: 'ratio-abc',
          password: 'secret123',
          baseUrl: 'https://my-tunnel.example/unicommerce/api/v1',
        });
      }
      return Promise.reject(new Error(`unexpected api call: ${method} ${path}`));
    });
  });

  it('shows the username input and a disabled Generate button until typed', async () => {
    renderWithProviders(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Your Unicommerce username/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Generate credentials' })).toBeDisabled();
  });

  it('shows generated credentials (password hidden by default) after clicking Generate', async () => {
    renderWithProviders(<ConnectPage />);

    // findByLabelText/findByRole retry until the DOM settles — this page
    // mounted in isolation (not under __root.tsx's normal merchant-resolved
    // gate) genuinely re-renders once between "merchant still loading" and
    // "merchant resolved, credentials query now enabled", so a synchronous
    // getByRole right after typing is flaky; async queries ride that out.
    const input = await screen.findByLabelText(/Your Unicommerce username/i);
    fireEvent.change(input, { target: { value: 'merchant-uc-login' } });
    const button = await screen.findByRole('button', { name: 'Generate credentials' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('ratio-abc')).toBeInTheDocument();
    });
    expect(screen.getByText(/my-tunnel\.example\/unicommerce\/api\/v1/)).toBeInTheDocument();
    // Password is masked by default — the plaintext must not be shown yet.
    expect(screen.queryByText('secret123')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('secret123')).toBeInTheDocument();

    // Base URL, Username, Password each get their own copy button (antd's
    // built-in Typography.Text `copyable`, aria-labelled "Copy").
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(3);
  });
});

describe('ConnectPage — reopening with existing credentials on file', () => {
  beforeEach(() => {
    apiMock.mockImplementation((method: string, path: string, body?: unknown) => {
      if (method === 'GET' && path === '/api/merchants/me') return Promise.resolve(FAKE_MERCHANT);
      if (method === 'GET' && path.startsWith('/admin/credentials')) {
        return Promise.resolve({
          username: 'ratio-existing',
          password: 'existing-secret',
          ucUsername: 'merchant-uc-login',
          baseUrl: 'https://my-tunnel.example/unicommerce/api/v1',
          lastInboundCallAt: null,
        });
      }
      if (method === 'POST' && path === '/admin/credentials/regenerate') {
        return Promise.resolve({
          username: 'ratio-new',
          password: 'new-secret',
          baseUrl: 'https://my-tunnel.example/unicommerce/api/v1',
        });
      }
      return Promise.reject(new Error(`unexpected api call: ${method} ${path} ${JSON.stringify(body)}`));
    });
  });

  it('shows the existing username directly, with no input form, and the password masked', async () => {
    renderWithProviders(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText('ratio-existing')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Your Unicommerce username/i)).not.toBeInTheDocument();
    expect(screen.queryByText('existing-secret')).not.toBeInTheDocument();
  });

  it('warns that Unicommerce has never called us yet when lastInboundCallAt is null', async () => {
    renderWithProviders(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText(/hasn't called us yet/i)).toBeInTheDocument();
    });
  });

  it('asks for confirmation before regenerating, and shows the new credentials after confirming', async () => {
    renderWithProviders(<ConnectPage />);
    await screen.findByText('ratio-existing');

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate credentials' }));

    // Confirmation dialog must appear — regenerate must not fire immediately.
    expect(await screen.findByText(/Regenerate credentials\?/)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith('POST', '/admin/credentials/regenerate', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(screen.getByText('ratio-new')).toBeInTheDocument();
    });
    expect(screen.queryByText('ratio-existing')).not.toBeInTheDocument();
  });
});

describe('ConnectPage — connection status display', () => {
  it('shows a Connected message with the timestamp when Unicommerce has called us before', async () => {
    apiMock.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/api/merchants/me') return Promise.resolve(FAKE_MERCHANT);
      if (method === 'GET' && path.startsWith('/admin/credentials')) {
        return Promise.resolve({
          username: 'ratio-existing',
          password: 'existing-secret',
          ucUsername: 'merchant-uc-login',
          baseUrl: 'https://my-tunnel.example/unicommerce/api/v1',
          lastInboundCallAt: '2026-07-20T10:00:00.000Z',
        });
      }
      return Promise.reject(new Error(`unexpected api call: ${method} ${path}`));
    });

    renderWithProviders(<ConnectPage />);

    await waitFor(() => {
      expect(screen.getByText(/Connected — last heard from Unicommerce/)).toBeInTheDocument();
    });
  });
});
