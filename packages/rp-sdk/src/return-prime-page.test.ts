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

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    const { __disconnectWipeObserverForTests } = await import('./return-prime-page');
    __disconnectWipeObserverForTests();
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

  it('re-inserts a fresh iframe when an external actor wipes the mount after a successful load (e.g. a hydration correction)', async () => {
    fetchEnabled.mockResolvedValue(true);
    const { syncReturnPrimePage } = await import('./return-prime-page');

    const syncPromise = syncReturnPrimePage();
    const mount = document.querySelector('[data-rp-mount]') as HTMLElement;
    let iframe: HTMLIFrameElement | null = null;
    for (let i = 0; i < 10 && !iframe; i++) {
      await Promise.resolve();
      iframe = mount.querySelector('iframe');
    }
    expect(iframe).not.toBeNull();
    const firstSrc = iframe?.src;
    iframe?.dispatchEvent(new Event('load'));
    await syncPromise;

    // Simulate an external actor (e.g. React reconciling its own empty vdom) wiping
    // the mount's content out from under the SDK.
    mount.innerHTML = '';
    expect(mount.querySelector('iframe')).toBeNull();

    // The MutationObserver should react promptly (via microtask/macrotask queue),
    // not require waiting out the full 8s load timeout again.
    let newIframe: HTMLIFrameElement | null = null;
    for (let i = 0; i < 10 && !newIframe; i++) {
      await Promise.resolve();
      newIframe = mount.querySelector('iframe');
    }
    expect(newIframe).not.toBeNull();
    expect(newIframe?.src).toBe(firstSrc);
  });

  it('re-renders the same fallback message when an external actor wipes the mount after a message was shown', async () => {
    fetchEnabled.mockResolvedValue(false);
    const { syncReturnPrimePage } = await import('./return-prime-page');

    await syncReturnPrimePage();

    const mount = document.querySelector('[data-rp-mount]') as HTMLElement;
    expect(mount.textContent).toContain('Returns and exchanges are currently unavailable');

    mount.innerHTML = '';
    expect(mount.textContent).not.toContain('unavailable');

    let restored = false;
    for (let i = 0; i < 10 && !restored; i++) {
      await Promise.resolve();
      restored =
        mount.textContent?.includes('Returns and exchanges are currently unavailable') ?? false;
    }
    expect(restored).toBe(true);
  });

  it('does not runaway re-insert: after one wipe, exactly one re-insertion happens and content stays stable', async () => {
    fetchEnabled.mockResolvedValue(true);
    const { syncReturnPrimePage } = await import('./return-prime-page');

    const syncPromise = syncReturnPrimePage();
    const mount = document.querySelector('[data-rp-mount]') as HTMLElement;
    let iframe: HTMLIFrameElement | null = null;
    for (let i = 0; i < 10 && !iframe; i++) {
      await Promise.resolve();
      iframe = mount.querySelector('iframe');
    }
    iframe?.dispatchEvent(new Event('load'));
    await syncPromise;

    mount.innerHTML = '';

    let newIframe: HTMLIFrameElement | null = null;
    for (let i = 0; i < 10 && !newIframe; i++) {
      await Promise.resolve();
      newIframe = mount.querySelector('iframe');
    }
    expect(newIframe).not.toBeNull();
    // Fire the new iframe's load so it settles, then let microtasks flush further
    // to make sure nothing keeps re-inserting on its own.
    newIframe?.dispatchEvent(new Event('load'));
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }

    expect(mount.querySelectorAll('iframe').length).toBe(1);
  });

  it('recovers when the mount is wiped WHILE the initial iframe is still loading (before its load/error ever fires) — e.g. a hydration correction that lands mid-navigation', async () => {
    vi.useFakeTimers();
    fetchEnabled.mockResolvedValue(true);
    const { syncReturnPrimePage } = await import('./return-prime-page');

    const syncPromise = syncReturnPrimePage();
    const mount = document.querySelector('[data-rp-mount]') as HTMLElement;
    let iframe: HTMLIFrameElement | null = null;
    for (let i = 0; i < 10 && !iframe; i++) {
      await vi.advanceTimersByTimeAsync(0);
      iframe = mount.querySelector('iframe');
    }
    expect(iframe).not.toBeNull();
    const firstSrc = iframe?.src;

    // Simulate a hydration correction landing before the first iframe ever fires
    // load/error — it just gets torn out, same as a disconnected iframe silently
    // aborting its in-flight navigation.
    mount.innerHTML = '';

    let newIframe: HTMLIFrameElement | null = null;
    for (let i = 0; i < 10 && !newIframe; i++) {
      await vi.advanceTimersByTimeAsync(0);
      newIframe = mount.querySelector('iframe');
    }
    // Recovers well before the original (now-abandoned) iframe's 8s timeout would
    // have elapsed — proving the observer was already watching, not installed late.
    expect(newIframe).not.toBeNull();
    expect(newIframe?.src).toBe(firstSrc);

    newIframe?.dispatchEvent(new Event('load'));
    // The original awaited mountPortalIframe() call (on the now-detached first iframe)
    // only settles via its own 8s timeout — harmless (it writes into a node nobody
    // sees), but syncReturnPrimePage() doesn't resolve until it does.
    await vi.advanceTimersByTimeAsync(8000);
    await syncPromise;
  });

  it('recovers when the whole mount node is replaced (not just its children cleared) — e.g. React swapping in a fresh node from its own vdom during a hydration correction', async () => {
    fetchEnabled.mockResolvedValue(true);
    const { syncReturnPrimePage } = await import('./return-prime-page');

    const syncPromise = syncReturnPrimePage();
    const originalMount = document.querySelector('[data-rp-mount]') as HTMLElement;
    let iframe: HTMLIFrameElement | null = null;
    for (let i = 0; i < 10 && !iframe; i++) {
      await Promise.resolve();
      iframe = originalMount.querySelector('iframe');
    }
    expect(iframe).not.toBeNull();
    const firstSrc = iframe?.src;
    iframe?.dispatchEvent(new Event('load'));
    await syncPromise;

    // Simulate React discarding the entire node (not clearing its children) and
    // replacing it with a fresh, empty one of its own — the node identity changes.
    const freshMount = document.createElement('div');
    freshMount.setAttribute('data-rp-mount', '');
    originalMount.replaceWith(freshMount);
    expect(document.body.contains(originalMount)).toBe(false);
    expect(freshMount.querySelector('iframe')).toBeNull();

    let recovered: HTMLIFrameElement | null = null;
    for (let i = 0; i < 20 && !recovered; i++) {
      await Promise.resolve();
      recovered = document.querySelector('[data-rp-mount] iframe');
    }
    expect(recovered).not.toBeNull();
    expect(recovered?.src).toBe(firstSrc);
    expect(document.querySelectorAll('[data-rp-mount]').length).toBe(1);
  });
});
