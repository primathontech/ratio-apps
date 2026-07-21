import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LOADER_SRC = 'https://apps.example.com/loyalty/sdk/loyalty-loader.js?store=m1';

type LoaderModule = typeof import('./loader');

/** Fresh module per test so `initCalled` / script-ref state never leaks. */
async function loadModule(): Promise<LoaderModule> {
  vi.resetModules();
  return import('./loader');
}

function setUrl(url: string): void {
  // @ts-expect-error happyDOM is injected by the vitest happy-dom environment
  window.happyDOM.setURL(url);
}

function addLoaderScript(src = LOADER_SRC): void {
  const tag = document.createElement('script');
  tag.src = src;
  document.head.appendChild(tag);
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('loader', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    // @ts-expect-error test cleanup of the published global
    window.RatioLoyalty = undefined;
    // Keep injected <script type="module"> tags inert (no network fetch).
    // @ts-expect-error happyDOM is injected by the vitest happy-dom environment
    window.happyDOM.settings.disableJavaScriptFileLoading = true;
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is zero-cost without the loyalty_qr param: no bundle, no widget, no fetch', async () => {
    setUrl('https://shop.example.com/');
    addLoaderScript();
    const loader = await loadModule();
    loader.bootLoyaltyLoader();
    await tick();

    expect(window.RatioLoyalty).toBeDefined();
    expect(document.querySelector('script[data-loyalty-claim]')).toBeNull();
    expect(document.querySelector('loyalty-claim-widget')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('self-inits an overlay when ?loyalty_qr is present and nobody called initClaim', async () => {
    setUrl('https://shop.example.com/products/x?loyalty_qr=CODE123');
    addLoaderScript();
    const loader = await loadModule();
    loader.bootLoyaltyLoader();
    await tick();

    const bundle = document.querySelector<HTMLScriptElement>('script[data-loyalty-claim]');
    expect(bundle?.src).toBe('https://apps.example.com/loyalty/sdk/loyalty-claim.js');
    const widget = document.querySelector('loyalty-claim-widget');
    expect(widget).not.toBeNull();
    expect(widget?.parentElement).toBe(document.body);
    expect(widget?.hasAttribute('overlay')).toBe(true);
    expect(widget?.getAttribute('code')).toBe('CODE123');
    expect(widget?.getAttribute('api-base')).toBe('https://apps.example.com');
    expect(widget?.getAttribute('merchant-id')).toBe('m1');
  });

  it('injects the claim bundle only once across repeated inits', async () => {
    setUrl('https://shop.example.com/?loyalty_qr=CODE123');
    addLoaderScript();
    const loader = await loadModule();
    loader.initClaim(null);
    loader.initClaim(null);
    expect(document.querySelectorAll('script[data-loyalty-claim]')).toHaveLength(1);
  });

  it('explicit initClaim(containerId) mounts inline and suppresses self-init', async () => {
    setUrl('https://shop.example.com/?loyalty_qr=CODE123');
    addLoaderScript();
    document.body.innerHTML = '<div id="claim-mount"></div>';
    const loader = await loadModule();
    loader.bootLoyaltyLoader();

    const cleanup = window.RatioLoyalty?.initClaim('claim-mount', {
      merchantId: 'm2',
      apiBaseUrl: 'https://api.override.com/',
    });
    await tick(); // self-init tick passes — must NOT double-mount

    const widgets = document.querySelectorAll('loyalty-claim-widget');
    expect(widgets).toHaveLength(1);
    const widget = widgets[0] as Element;
    expect(widget.parentElement?.id).toBe('claim-mount');
    expect(widget.hasAttribute('overlay')).toBe(false);
    expect(widget.getAttribute('api-base')).toBe('https://api.override.com');
    expect(widget.getAttribute('merchant-id')).toBe('m2');
    expect(document.querySelector<HTMLScriptElement>('script[data-loyalty-claim]')?.src).toBe(
      'https://api.override.com/loyalty/sdk/loyalty-claim.js',
    );
    expect(typeof cleanup).toBe('function');
  });

  it('cleanup unmounts the widget', async () => {
    setUrl('https://shop.example.com/?loyalty_qr=CODE123');
    addLoaderScript();
    const loader = await loadModule();
    const cleanup = loader.initClaim(null);
    expect(document.querySelector('loyalty-claim-widget')).not.toBeNull();
    cleanup();
    expect(document.querySelector('loyalty-claim-widget')).toBeNull();
  });

  it('explicit initClaim without the param is a no-op (zero cost)', async () => {
    setUrl('https://shop.example.com/');
    addLoaderScript();
    const loader = await loadModule();
    const cleanup = loader.initClaim(null);
    cleanup();
    expect(document.querySelector('script[data-loyalty-claim]')).toBeNull();
    expect(document.querySelector('loyalty-claim-widget')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('parseScriptSrc', () => {
    it('derives apiBase and merchantId from the script src', async () => {
      const loader = await loadModule();
      expect(loader.parseScriptSrc(LOADER_SRC)).toEqual({
        apiBase: 'https://apps.example.com',
        merchantId: 'm1',
      });
    });

    it('keeps a path prefix on the apiBase', async () => {
      const loader = await loadModule();
      expect(
        loader.parseScriptSrc('https://cdn.example.com/api/loyalty/sdk/loyalty-loader.js?store=m9'),
      ).toEqual({ apiBase: 'https://cdn.example.com/api', merchantId: 'm9' });
    });

    it('returns null merchantId when ?store is missing', async () => {
      const loader = await loadModule();
      expect(
        loader.parseScriptSrc('https://apps.example.com/loyalty/sdk/loyalty-loader.js').merchantId,
      ).toBeNull();
    });
  });
});
