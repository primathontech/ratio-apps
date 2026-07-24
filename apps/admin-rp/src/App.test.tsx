import { OrionProvider } from '@primathonos/orion';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { RegisterScreen } from './App';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);

function renderRegisterScreen() {
  return render(<RegisterScreen />, { wrapper: OrionProvider });
}

function routeApi(overrides: {
  me?: { domain: string; registered: boolean; active: boolean };
  status?: (active: boolean) => Promise<{ active: boolean }> | { active: boolean };
} = {}) {
  const me = overrides.me ?? { domain: 'store.gokwik.co', registered: true, active: true };
  mockedApi.mockImplementation((method: string, path: string, body?: unknown) => {
    if (path === '/api/admin/merchants/me' && method === 'GET') return Promise.resolve(me);
    if (path === '/api/admin/status' && method === 'POST') {
      const active = (body as { active: boolean }).active;
      return Promise.resolve(overrides.status ? overrides.status(active) : { active });
    }
    return Promise.resolve({});
  });
}

// Pausing is the consequential direction (blocks every /rp/shopify/* call for this
// merchant AND locks them out of the RP dashboard, mirroring a real Shopify uninstall —
// see RpWebhooksService.setMerchantActiveStatus), so it's gated behind window.confirm.
// Resuming is safe and goes straight through.
describe('RegisterScreen — Return Prime enabled/paused toggle', () => {
  let confirmSpy: ReturnType<typeof vi.fn<(message?: string) => boolean>>;

  beforeEach(() => {
    mockedApi.mockReset();
    confirmSpy = vi.fn();
    window.confirm = confirmSpy;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the toggle in the "on" state when the merchant is active', async () => {
    routeApi({ me: { domain: 'store.gokwik.co', registered: true, active: true } });
    renderRegisterScreen();

    await screen.findByText('Return Prime enabled');
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the toggle in the "off" state and the paused message when inactive', async () => {
    routeApi({ me: { domain: 'store.gokwik.co', registered: true, active: false } });
    renderRegisterScreen();

    await screen.findByText('Return Prime enabled');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Paused/)).toBeInTheDocument();
  });

  it('asks for confirmation before pausing, and does NOT call the API if declined', async () => {
    confirmSpy.mockReturnValue(false);
    routeApi({ me: { domain: 'store.gokwik.co', registered: true, active: true } });
    renderRegisterScreen();

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockedApi).not.toHaveBeenCalledWith('POST', '/api/admin/status', expect.anything());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('pauses when confirmed, calling POST /api/admin/status with active:false', async () => {
    confirmSpy.mockReturnValue(true);
    routeApi({ me: { domain: 'store.gokwik.co', registered: true, active: true } });
    renderRegisterScreen();

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(mockedApi).toHaveBeenCalledWith('POST', '/api/admin/status', { active: false });
  });

  it('resumes without any confirmation prompt, calling POST /api/admin/status with active:true', async () => {
    routeApi({ me: { domain: 'store.gokwik.co', registered: true, active: false } });
    renderRegisterScreen();

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockedApi).toHaveBeenCalledWith('POST', '/api/admin/status', { active: true });
  });

  it('shows an error and leaves the toggle unchanged when the status call fails', async () => {
    confirmSpy.mockReturnValue(true);
    routeApi({ me: { domain: 'store.gokwik.co', registered: true, active: true } });
    mockedApi.mockImplementation((method: string, path: string) => {
      if (path === '/api/admin/merchants/me' && method === 'GET') {
        return Promise.resolve({ domain: 'store.gokwik.co', registered: true, active: true });
      }
      if (path === '/api/admin/status' && method === 'POST') {
        return Promise.reject(new Error('network error'));
      }
      return Promise.resolve({});
    });
    renderRegisterScreen();

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await screen.findByText('Could not update status. Please try again.');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
