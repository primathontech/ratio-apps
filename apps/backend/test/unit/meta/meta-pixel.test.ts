import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Loads the built `static/meta-pixel.js` bundle into a fake browser sandbox with
 * the OpenStore bus ATTACHED, and asserts the two events the bus never emits but
 * the SDK must still fire:
 *   - CompleteRegistration  ← KwikPass `otpVerifiedGk` postMessage (always-on)
 *   - Search                ← URL routing on a /collections page (bus supplement)
 * Plus the double-count guard: the commerce funnel (e.g. AddPaymentInfo) is NOT
 * fired from postMessage while the bus is attached (the bus already emits it).
 *
 * Call A (`fbq('trackSingle', …)`) is synchronous, so we assert on the fbq spy.
 */
const BUNDLE = readFileSync(join(__dirname, '../../../static/meta-pixel.js'), 'utf8');

const ALL_ENABLED = Object.fromEntries(
  ['PageView','ViewContent','AddToCart','InitiateCheckout','AddShippingInfo','AddPaymentInfo','Purchase','Search','AddToWishlist','Lead','CompleteRegistration','Contact','Subscribe'].map((n) => [n, n]),
);

interface Harness {
  fbq: ReturnType<typeof vi.fn>;
  message: (data: unknown, origin?: string) => void;
  windowEvent: (type: string) => void;
  firedMeta: () => string[];
}

function loadBundle(pathname: string): Harness {
  const fbq = vi.fn() as unknown as ReturnType<typeof vi.fn> & Record<string, unknown>;
  const listeners: Record<string, Array<(e: unknown) => void>> = {};

  const win: Record<string, unknown> = {
    fbq,
    _fbq: fbq,
    __META_RATIO_CONFIG__: {
      pixelId: '687607594424540',
      capiPath: 'https://meta-g4.example/meta/api/v1/capi/m1',
      dataSharingLevel: 'maximum',
      productIdType: 'product_id',
      debug: false,
      merchantId: 'm1',
      eventNameMap: ALL_ENABLED,
    },
    __OPENSTORE_EVENT_BUS__: { subscribeAll: () => undefined, getEventLog: () => [] },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
  };
  const loc = { pathname, search: '', href: `https://store${pathname}` };
  const hist = { pushState: () => undefined, replaceState: () => undefined };
  const nav = { sendBeacon: vi.fn(() => true), userAgent: 'test' };
  const doc = {
    cookie: '',
    createElement: () => ({}),
    head: { appendChild: () => undefined },
    addEventListener: () => undefined,
    visibilityState: 'visible',
  };

  // The bundle references these as free variables (window/document/console plus
  // the browser globals it reads bare).
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'console', 'location', 'history', 'navigator', BUNDLE)(
    win,
    doc,
    console,
    loc,
    hist,
    nav,
  );

  return {
    fbq,
    message: (data, origin = 'https://sandbox-pay.dev.gokwik.io') => {
      for (const fn of listeners.message ?? []) fn({ origin, data });
    },
    windowEvent: (type: string) => {
      for (const fn of listeners[type] ?? []) fn({ type, detail: {} });
    },
    // Meta event names passed to fbq('trackSingle', pixelId, <name>, …)
    firedMeta: () =>
      fbq.mock.calls.filter((c) => c[0] === 'trackSingle').map((c) => c[2] as string),
  };
}

describe('meta-pixel.js bundle — bus-attached supplements', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fires CompleteRegistration from a KwikPass otpVerifiedGk postMessage (bus attached)', () => {
    const h = loadBundle('/');
    h.message({ type: 'gokwik_events', eventName: 'otpVerifiedGk' });
    expect(h.firedMeta()).toContain('CompleteRegistration');
  });

  it('fires Search via URL routing on a /collections page (bus attached)', () => {
    const h = loadBundle('/collections/all');
    expect(h.firedMeta()).toContain('Search');
  });

  it('fires Search on a /pages/search page (bblunt search route)', () => {
    const h = loadBundle('/pages/search');
    expect(h.firedMeta()).toContain('Search');
  });

  it('fires CompleteRegistration on the KwikPass user-loggedin window event', () => {
    const h = loadBundle('/');
    h.windowEvent('user-loggedin');
    expect(h.firedMeta()).toContain('CompleteRegistration');
  });

  it('does NOT fire the commerce funnel from postMessage while the bus is attached (no double-count)', () => {
    const h = loadBundle('/');
    h.message({ type: 'gokwik_events', eventName: 'PaymentInfoAdded', cartData: { total: 100 } });
    expect(h.firedMeta()).not.toContain('AddPaymentInfo');
  });
});
