import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchEnabled } = vi.hoisted(() => ({ fetchEnabled: vi.fn() }));
vi.mock('./enabled-check', () => ({ fetchEnabled }));

const { scriptConfig } = vi.hoisted(() => ({
  scriptConfig: {
    store: 'test-store',
    adapterUrl: 'https://adapter.example.com',
    floating: false,
    orderDetailPath: '/pages/orders/:id',
    orderListPath: '/pages/orders',
    redirectTo: '/apps/return_prime',
    returnPrimePath: '/apps/return_prime',
  },
}));
vi.mock('./loader', () => ({ scriptConfig }));

function setPathname(pathname: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname, search: '' },
  });
}

describe('syncReturnPrimePage', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div data-rp-mount></div>';
    setPathname('/apps/return_prime');
    scriptConfig.store = 'test-store';
    scriptConfig.adapterUrl = 'https://adapter.example.com';
    scriptConfig.returnPrimePath = '/apps/return_prime';
    fetchEnabled.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the unavailable message when fetchEnabled resolves false', async () => {
    fetchEnabled.mockResolvedValue(false);
    const { syncReturnPrimePage } = await import('./return-prime-page');

    await syncReturnPrimePage();

    const mount = document.querySelector('[data-rp-mount]');
    expect(mount?.textContent).toContain(
      'Returns and exchanges are currently unavailable. Please contact our support team',
    );
    expect(mount?.querySelector('iframe')).toBeNull();
  });

  it('shows a fallback message when adapterUrl/store are not configured', async () => {
    scriptConfig.adapterUrl = '';
    scriptConfig.store = '';
    const { syncReturnPrimePage } = await import('./return-prime-page');

    await syncReturnPrimePage();

    const mount = document.querySelector('[data-rp-mount]');
    expect(mount?.textContent).toContain('temporarily unavailable');
    expect(fetchEnabled).not.toHaveBeenCalled();
  });

  it('shows the fallback message when the iframe never fires load (timeout)', async () => {
    vi.useFakeTimers();
    fetchEnabled.mockResolvedValue(true);
    const { syncReturnPrimePage } = await import('./return-prime-page');

    const syncPromise = syncReturnPrimePage();
    // Let the fetchEnabled microtask resolve before advancing timers.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8000);
    await syncPromise;

    const mount = document.querySelector('[data-rp-mount]');
    expect(mount?.textContent).toContain('temporarily unavailable');
    expect(mount?.querySelector('iframe')).toBeNull();
  });

  it('keeps the iframe mounted when it loads promptly (happy path)', async () => {
    fetchEnabled.mockResolvedValue(true);
    const { syncReturnPrimePage } = await import('./return-prime-page');

    const syncPromise = syncReturnPrimePage();
    // Allow the fetchEnabled + iframe-creation microtasks to run, then fire load.
    const mount = document.querySelector('[data-rp-mount]') as HTMLElement;
    let iframe: HTMLIFrameElement | null = null;
    for (let i = 0; i < 10 && !iframe; i++) {
      await Promise.resolve();
      iframe = mount.querySelector('iframe');
    }
    expect(iframe).not.toBeNull();
    iframe?.dispatchEvent(new Event('load'));
    await syncPromise;

    const mountAfter = document.querySelector('[data-rp-mount]');
    expect(mountAfter?.querySelector('iframe')).not.toBeNull();
    expect(mountAfter?.textContent).not.toContain('temporarily unavailable');
  });
});
