// End-to-end proof of the ZERO-CODE storefront path: a single
// `<script src=".../loyalty-loader.js?store=m1">` on a page whose URL carries
// `?loyalty_qr=CODE`. Unlike the unit tests (loader OR widget in isolation),
// this wires the REAL loader self-init to the REAL <loyalty-claim-widget>,
// which builds its OWN LoyaltyClient from the `api-base` attribute and calls
// the global `fetch` — the exact production flow. Only the network and the
// KwikPass token are stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Static import registers the custom element ONCE (customElements.define is
// global and must not be re-run; only the loader needs fresh module state).
import './claim-widget';

const LOADER_SRC = 'https://api.example.com/loyalty/sdk/loyalty-loader.js?store=m1';
const CODE = 'EXPO24';

const ACTIVE_STATUS = {
  state: 'active',
  eventName: 'Health Expo',
  points: 100,
  programName: 'Wellversed Coins',
};
const CREDITED = {
  status: 'credited',
  points: 100,
  newBalance: 1500,
  programName: 'Wellversed Coins',
};

function setUrl(url: string): void {
  // @ts-expect-error happyDOM is injected by the vitest happy-dom environment
  window.happyDOM.setURL(url);
}

function addLoaderScript(): void {
  const tag = document.createElement('script');
  tag.src = LOADER_SRC;
  document.head.appendChild(tag);
}

/** Route the widget's real fetch calls to canned backend responses. */
function stubBackend(): ReturnType<typeof vi.fn> {
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(`/loyalty/qr/${CODE}/status`)) {
      return new Response(JSON.stringify(ACTIVE_STATUS), { status: 200 });
    }
    if (url.endsWith(`/loyalty/qr/${CODE}/claim`)) {
      // Assert the browser sends ONLY the KwikPass token (never a phone).
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(Object.keys(body)).toEqual(['gkAccessToken']);
      expect(body.gkAccessToken).toBe('gk-tok-123');
      return new Response(JSON.stringify(CREDITED), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

async function settle(): Promise<void> {
  // self-init is setTimeout(0); then status fetch + Lit updates.
  await new Promise((r) => setTimeout(r, 5));
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 5));
}

describe('zero-code script-include flow', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    // @ts-expect-error test cleanup of the published global
    window.RatioLoyalty = undefined;
    window.localStorage.clear();
    // Keep the injected <script type="module"> inert — the element is already
    // defined via the static import above, so no real bundle load is needed.
    // @ts-expect-error happyDOM is injected by the vitest happy-dom environment
    window.happyDOM.settings.disableJavaScriptFileLoading = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mounts the overlay, fetches status, and completes a claim after login', async () => {
    setUrl(`https://wellversed.in/products/creatine?${new URLSearchParams({ loyalty_qr: CODE })}`);
    addLoaderScript();
    window.localStorage.setItem('KWIKUSERTOKEN', 'gk-tok-123'); // customer already logged in
    const fetchMock = stubBackend();
    const onSuccess = vi.fn();
    window.addEventListener('loyalty:claim:success', onSuccess);

    // Boot the loader exactly as the injected script would.
    const { bootLoyaltyLoader } = await import('./loader');
    bootLoyaltyLoader();
    await settle();

    // Self-init mounted the real widget as a body overlay, derived from the
    // loader's own <script src> (api-base + store).
    const widget = document.querySelector('loyalty-claim-widget') as HTMLElement & {
      updateComplete: Promise<unknown>;
      onClaimClick: () => Promise<void>;
    };
    expect(widget).not.toBeNull();
    expect(widget.getAttribute('api-base')).toBe('https://api.example.com');
    expect(widget.getAttribute('merchant-id')).toBe('m1');

    // Status was fetched from the backend and the active CTA rendered.
    await widget.updateComplete;
    const text = () => widget.shadowRoot?.textContent ?? '';
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/loyalty/qr/EXPO24/status',
      expect.anything(),
    );
    expect(text()).toContain('Health Expo');

    // Customer taps "Claim" — token present → claim → credited render + event.
    await widget.onClaimClick();
    await widget.updateComplete;
    await Promise.resolve();
    await widget.updateComplete;

    expect(text()).toContain('1500');
    expect(onSuccess).toHaveBeenCalledOnce();
    const event = onSuccess.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toMatchObject({ code: CODE, points: 100, newBalance: 1500 });
  });

  it('is completely inert on a normal page (no ?loyalty_qr): no widget, no fetch', async () => {
    setUrl('https://wellversed.in/products/creatine');
    addLoaderScript();
    const fetchMock = stubBackend();

    const { bootLoyaltyLoader } = await import('./loader');
    bootLoyaltyLoader();
    await settle();

    expect(document.querySelector('loyalty-claim-widget')).toBeNull();
    expect(document.querySelector('script[data-loyalty-claim]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
