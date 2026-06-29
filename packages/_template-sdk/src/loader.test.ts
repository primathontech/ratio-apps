import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot__Slug__ } from './loader';

const CONFIG = {
  storeId: 's1',
  apiKey: 'pub',
  version: '0.1.0',
  inputSelector: '#search',
  resultsMountSelector: '#results',
  resultsPagePath: '/search',
  searchEnabled: true,
  theme: { primary: '#0fb3a9' },
};

describe('loader', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    // @ts-expect-error reset test global
    window.____SLUG____ = undefined;
    // The loader injects a real <script type="module"> — happy-dom would
    // otherwise try to load it over the network (ENOTFOUND on cdn.example.com,
    // raised as an unhandled error that crashes the worker). Disabling script
    // file loading keeps injection observable in the DOM with no network call.
    // @ts-expect-error happyDOM is injected by the vitest happy-dom environment
    window.happyDOM.settings.disableJavaScriptFileLoading = true;
  });
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    document.head.innerHTML =
      '<script id="__slug__-sdk" src="https://cdn.example.com/__slug__/sdk/__slug__-loader.js?store=m1"></script>';
    document.body.innerHTML = '<input id="search" type="search" /><div id="results"></div>';
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(CONFIG), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('fetches the config from the script origin and stashes it on window', async () => {
    const fetchMock = setup();
    await boot__Slug__();
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/__slug__/sdk/config/m1');
    // @ts-expect-error test global
    expect(window.____SLUG____.storeId).toBe('s1');
  });

  it('injects the widget module script on first focus of the input', async () => {
    setup();
    await boot__Slug__();
    expect(document.querySelector('script[type="module"]')).toBeNull();
    document.querySelector('#search')!.dispatchEvent(new Event('focusin', { bubbles: true }));
    const widget = document.querySelector('script[type="module"]') as HTMLScriptElement | null;
    expect(widget).not.toBeNull();
    expect(widget!.src).toBe('https://cdn.example.com/__slug__/sdk/__slug__-widget.js?v=0.1.0');
  });

  it('does nothing when searchEnabled is false', async () => {
    document.head.innerHTML =
      '<script src="https://cdn.example.com/__slug__/sdk/__slug__-loader.js?store=m1"></script>';
    document.body.innerHTML = '<input id="search" type="search" />';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...CONFIG, searchEnabled: false }), { status: 200 }),
      ),
    );
    await boot__Slug__();
    document.querySelector('#search')!.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(document.querySelector('script[type="module"]')).toBeNull();
  });
});
