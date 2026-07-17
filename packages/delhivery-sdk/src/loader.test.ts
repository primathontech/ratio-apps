import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootDelhivery } from './loader';

const RESULT = {
  serviceable: true,
  cod_available: false,
  edd_min: 2,
  edd_max: 5,
  carrier: 'DELHIVERY',
};

describe('loader', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete window.__DELHIVERY__;
    delete window.RatioDelhivery;
    // The loader injects a real <script type="module"> — happy-dom would
    // otherwise try to load it over the network (ENOTFOUND, raised as an
    // unhandled error that crashes the worker). Disabling script file loading
    // keeps injection observable in the DOM with no network call.
    // @ts-expect-error happyDOM is injected by the vitest happy-dom environment
    window.happyDOM.settings.disableJavaScriptFileLoading = true;
  });
  afterEach(() => vi.restoreAllMocks());

  function addScript(src: string) {
    document.head.innerHTML = `<script id="dlv-sdk" src="${src}"></script>`;
  }

  it('loader.readsMerchantFromPrelude — boots from the backend-injected window.__DELHIVERY__', () => {
    window.__DELHIVERY__ = { merchantId: 'mer_1', apiBase: 'https://apps.ratio.example' };
    bootDelhivery();
    expect(window.RatioDelhivery).toBeDefined();
    expect(window.RatioDelhivery?.merchantId).toBe('mer_1');
    // config is normalized back onto the global
    expect(window.__DELHIVERY__?.apiBase).toBe('https://apps.ratio.example');
    expect(window.__DELHIVERY__?.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('loader.readsMerchantFromSrcPath — falls back to the /delhivery/sdk/<id>.js filename', () => {
    addScript('https://apps.ratio.example/delhivery/sdk/mer_42.js');
    bootDelhivery();
    expect(window.RatioDelhivery?.merchantId).toBe('mer_42');
    expect(window.__DELHIVERY__?.apiBase).toBe('https://apps.ratio.example');
  });

  it('loader.readsMerchantFromQuery — supports the ?store=<merchantId> form', () => {
    addScript('https://apps.ratio.example/delhivery/sdk/delhivery-loader.js?store=mer_7');
    bootDelhivery();
    expect(window.RatioDelhivery?.merchantId).toBe('mer_7');
  });

  it('loader.noMerchantNoBoot — does nothing when no merchant id can be derived', () => {
    bootDelhivery();
    expect(window.RatioDelhivery).toBeUndefined();
  });

  it('loader.exposesHeadlessClient — window.RatioDelhivery.checkServiceability hits the public endpoint', async () => {
    window.__DELHIVERY__ = { merchantId: 'mer_1', apiBase: 'https://apps.ratio.example' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(RESULT), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    bootDelhivery();
    const r = await window.RatioDelhivery?.checkServiceability('110001', { cod: true });
    expect(r?.serviceable).toBe(true);
    const url = (fetchMock.mock.calls[0] as unknown as [string])[0];
    expect(url).toBe(
      'https://apps.ratio.example/delhivery/api/serviceability?merchantId=mer_1&pincode=110001&cod=true',
    );
  });

  it('loader.noInjectWithoutElement — the widget bundle is NOT injected when the element is unused', () => {
    window.__DELHIVERY__ = { merchantId: 'mer_1', apiBase: 'https://apps.ratio.example' };
    bootDelhivery();
    expect(document.querySelector('script[data-delhivery-widget]')).toBeNull();
  });

  it('loader.lazyInjectsWidget — injects the widget ESM when <delhivery-serviceability> is on the page', () => {
    document.body.innerHTML = '<delhivery-serviceability></delhivery-serviceability>';
    window.__DELHIVERY__ = { merchantId: 'mer_1', apiBase: 'https://apps.ratio.example' };
    bootDelhivery();
    const tag = document.querySelector('script[data-delhivery-widget]') as HTMLScriptElement | null;
    expect(tag).not.toBeNull();
    expect(tag?.type).toBe('module');
    expect(tag?.src).toContain('https://apps.ratio.example/delhivery/sdk/delhivery-widget.js?v=');
  });

  it('loader.loadWidgetOnDemand — RatioDelhivery.loadWidget() injects once, idempotently', () => {
    window.__DELHIVERY__ = { merchantId: 'mer_1', apiBase: 'https://apps.ratio.example' };
    bootDelhivery();
    window.RatioDelhivery?.loadWidget();
    window.RatioDelhivery?.loadWidget();
    expect(document.querySelectorAll('script[data-delhivery-widget]').length).toBe(1);
  });

  it('loader.idempotentBoot — a second boot does not clobber the existing global', () => {
    window.__DELHIVERY__ = { merchantId: 'mer_1', apiBase: 'https://apps.ratio.example' };
    bootDelhivery();
    const first = window.RatioDelhivery;
    bootDelhivery();
    expect(window.RatioDelhivery).toBe(first);
  });
});
