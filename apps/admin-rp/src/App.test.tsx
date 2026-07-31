import { OrionProvider } from '@primathonos/orion';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException, api } from '@/lib/api';
import { RegisterScreen } from './App';

// Keep the REAL ApiException class (only mock `api` itself) — a bare
// `vi.mock('@/lib/api')` automocks the class too, stubbing its constructor so
// thrown instances lose `message`/`errorCode`, which breaks every test below
// that asserts on those fields.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

function renderRegisterScreen() {
  return render(<RegisterScreen />, { wrapper: OrionProvider });
}

function routeApi(
  overrides: {
    me?: {
      domain: string;
      registered: boolean;
      active: boolean;
      suggestedMode?: 'login' | 'signup' | null;
    };
    status?: (active: boolean) => Promise<{ active: boolean }> | { active: boolean };
    register?: (
      body: unknown,
    ) =>
      | Promise<{ domain: string; alreadyLinked?: boolean }>
      | { domain: string; alreadyLinked?: boolean };
  } = {},
) {
  const me = overrides.me ?? { domain: 'store.gokwik.co', registered: true, active: true };
  mockedApi.mockImplementation((method: string, path: string, body?: unknown) => {
    if (path === '/api/admin/merchants/me' && method === 'GET') return Promise.resolve(me);
    if (path === '/api/admin/status' && method === 'POST') {
      const active = (body as { active: boolean }).active;
      return Promise.resolve(overrides.status ? overrides.status(active) : { active });
    }
    if (path === '/api/admin/register' && method === 'POST') {
      return Promise.resolve(
        overrides.register ? overrides.register(body) : { domain: 'store.gokwik.co' },
      );
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
    expect(screen.getByText(/Disabled/)).toBeInTheDocument();
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

describe('RegisterScreen — sign up flow (choosing "No — Sign Up for the first time")', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function goToSignupAndSubmit(storeDomain: string) {
    fireEvent.click(await screen.findByRole('button', { name: 'No — Sign Up for the first time' }));
    fireEvent.change(await screen.findByPlaceholderText('your-store.gokwik.co'), {
      target: { value: storeDomain },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register in Return Prime' }));
  }

  it('shows the choice screen first, not the form, for an unregistered merchant', async () => {
    routeApi({ me: { domain: 'new-store.gokwik.co', registered: false, active: true } });
    renderRegisterScreen();

    await screen.findByRole('button', { name: 'Yes — Onboard OS store to my existing account' });
    expect(screen.queryByPlaceholderText('your-store.gokwik.co')).toBeNull();
  });

  it('on a fresh registration: submits mode:signup and shows the generic "configured" message', async () => {
    const register = vi.fn(() => ({ domain: 'new-store.gokwik.co', alreadyLinked: false }));
    routeApi({ me: { domain: 'new-store.gokwik.co', registered: false, active: true }, register });
    renderRegisterScreen();

    await goToSignupAndSubmit('new-store.gokwik.co');

    await screen.findByText('Return Prime configured!');
    expect(screen.queryByText('Connected to your existing Return Prime account')).toBeNull();
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ mode: 'signup' }));
  });

  it('when RP rejects because the merchant already exists: shows the error and a "Switch to Onboard OS store" button', async () => {
    routeApi({
      me: { domain: 'dual-platform-merchant.gokwik.co', registered: false, active: true },
      register: () => {
        throw new ApiException(
          'This merchant already has Return Prime configured. Please log in instead.',
          409,
          'RP_MERCHANT_ALREADY_EXISTS',
        );
      },
    });
    renderRegisterScreen();

    await goToSignupAndSubmit('typo-domain.gokwik.co');

    await screen.findByText(/already has Return Prime configured/);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Onboard OS store' }));

    await screen.findByRole('button', { name: 'Onboard OS store to Return Prime' });
  });
});

describe('RegisterScreen — proactive existence check (me().suggestedMode)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('skips the choice screen and goes straight to Login when RP confirms the merchant exists', async () => {
    routeApi({
      me: {
        domain: 'existing-merchant.gokwik.co',
        registered: false,
        active: true,
        suggestedMode: 'login',
      },
    });
    renderRegisterScreen();

    await screen.findByRole('button', { name: 'Onboard OS store to Return Prime' });
    expect(
      screen.queryByRole('button', { name: 'Yes — Onboard OS store to my existing account' }),
    ).toBeNull();
  });

  it('skips the choice screen and goes straight to Sign Up when RP confirms the merchant does not exist', async () => {
    routeApi({
      me: {
        domain: 'new-merchant.gokwik.co',
        registered: false,
        active: true,
        suggestedMode: 'signup',
      },
    });
    renderRegisterScreen();

    await screen.findByRole('button', { name: 'Register in Return Prime' });
    expect(screen.queryByRole('button', { name: 'No — Sign Up for the first time' })).toBeNull();
  });

  it('falls back to the manual choice screen when suggestedMode is null (RP unreachable/misconfigured)', async () => {
    routeApi({
      me: {
        domain: 'unknown-merchant.gokwik.co',
        registered: false,
        active: true,
        suggestedMode: null,
      },
    });
    renderRegisterScreen();

    await screen.findByRole('button', { name: 'Yes — Onboard OS store to my existing account' });
    await screen.findByRole('button', { name: 'No — Sign Up for the first time' });
  });
});

describe('RegisterScreen — login flow (choosing "Yes — Onboard OS store to my existing account")', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Dual-platform merchant: RP recognized this GoKwik merchant_id already has an
  // existing Shopify RP account and linked to it instead of creating a new one —
  // the UI must say so distinctly, not claim a brand-new store was configured.
  it('logs in with the pre-filled domain confirmed as-is and shows the "connected to existing account" message', async () => {
    const register = vi.fn(() => ({
      domain: 'existing-shopify-store.myshopify.com',
      alreadyLinked: true,
    }));
    routeApi({
      me: { domain: 'dual-platform-merchant.gokwik.co', registered: false, active: true },
      register,
    });
    renderRegisterScreen();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Yes — Onboard OS store to my existing account' }),
    );
    // Pre-filled from /me's domain — the merchant doesn't have to type anything.
    expect(await screen.findByDisplayValue('dual-platform-merchant.gokwik.co')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Onboard OS store to Return Prime' }));

    await screen.findByText('Connected to your existing Return Prime account');
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'login', store_domain: 'dual-platform-merchant.gokwik.co' }),
    );
  });

  // The regression this whole fix addresses: /me's domain can be a placeholder
  // (== the merchant ID itself) rather than a real domain, if Ratio's OAuth response
  // never carried one (see rp-auth.controller.ts). Login must let the merchant correct
  // it, not silently forward the placeholder as os_store_url.
  it('lets the merchant correct the pre-filled domain before logging in, and sends the corrected value', async () => {
    const register = vi.fn(() => ({ domain: 'corrected-store.gokwik.co' }));
    routeApi({
      // /me's domain equals the merchant ID — the placeholder case.
      me: { domain: 'gk-merchant-42', registered: false, active: true },
      register,
    });
    renderRegisterScreen();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Yes — Onboard OS store to my existing account' }),
    );
    const domainInput = await screen.findByDisplayValue('gk-merchant-42');
    fireEvent.change(domainInput, { target: { value: 'corrected-store.gokwik.co' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Onboard OS store to Return Prime' }));

    await screen.findByText(/Return Prime configured|Connected to your existing/);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'login', store_domain: 'corrected-store.gokwik.co' }),
    );
  });

  it('disables the Onboard OS store button when the domain field is cleared', async () => {
    routeApi({ me: { domain: 'store.gokwik.co', registered: false, active: true } });
    renderRegisterScreen();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Yes — Onboard OS store to my existing account' }),
    );
    const domainInput = await screen.findByDisplayValue('store.gokwik.co');
    fireEvent.change(domainInput, { target: { value: '' } });

    expect(await screen.findByRole('button', { name: 'Onboard OS store to Return Prime' })).toBeDisabled();
  });

  it('when RP reports no existing account: shows the error and a "Switch to Sign Up" button', async () => {
    routeApi({
      me: { domain: 'new-store.gokwik.co', registered: false, active: true },
      register: () => {
        throw new ApiException(
          'No existing Return Prime account found for this merchant. Please sign up instead.',
          404,
          'RP_MERCHANT_NOT_FOUND',
        );
      },
    });
    renderRegisterScreen();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Yes — Onboard OS store to my existing account' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Onboard OS store to Return Prime' }));

    await screen.findByText(/No existing Return Prime account found/);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Sign Up' }));

    await screen.findByPlaceholderText('your-store.gokwik.co');
  });
});
