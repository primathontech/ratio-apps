import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Loads the static `google-pixel.js` bundle into a fake browser sandbox and
 * drives it: a fake pixel runtime captures the GA4 + Ads registrations, a fake
 * `gtag` records every call, and a fake analytics API (supporting multiple
 * handlers per event) lets us emit storefront events and assert the emitted
 * `gtag(...)` calls (TDD §3.14 / §3.15).
 */
const BUNDLE = readFileSync(join(__dirname, '../../../../static/google-pixel.js'), 'utf8');

interface Harness {
  gtag: ReturnType<typeof vi.fn>;
  registrations: Record<string, { register: (analytics: unknown) => void }>;
  /** event name → all subscribed handlers (both adapters can subscribe one name) */
  handlers: Record<string, Array<(event: unknown) => void>>;
  subscribed: (name: string) => boolean;
  emit: (name: string, event: unknown) => void;
  registerAndWire: () => void;
}

function loadBundle(config: unknown): Harness {
  const gtag = vi.fn();
  const registrations: Harness['registrations'] = {};
  const handlers: Harness['handlers'] = {};

  const runtime = {
    register: (reg: { name: string; register: (a: unknown) => void }) => {
      registrations[reg.name] = reg;
    },
  };
  const win: Record<string, unknown> = {
    dataLayer: [],
    gtag, // pre-set so ensureGtag reuses our spy instead of injecting a script
    __GOOGLE_RATIO_CONFIG__: config,
    __OPEN_STORE_PIXEL_RUNTIME__: runtime,
  };
  const doc = { createElement: () => ({}), head: { appendChild: () => undefined } };

  // The IIFE references `window`, `document`, `console` as free variables.
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'console', BUNDLE)(win, doc, console);

  const analytics = {
    subscribe: (name: string, fn: (e: unknown) => void) => {
      (handlers[name] ??= []).push(fn);
    },
  };
  return {
    gtag,
    registrations,
    handlers,
    subscribed: (name) => (handlers[name]?.length ?? 0) > 0,
    emit: (name, event) => {
      for (const fn of handlers[name] ?? []) fn(event);
    },
    registerAndWire: () => {
      for (const reg of Object.values(registrations)) reg.register(analytics);
    },
  };
}

describe('google-pixel.js bundle', () => {
  it('registers GA4 + Ads with the runtime when both are configured', () => {
    const h = loadBundle({
      ga4: { measurementId: 'G-TEST', isolated: false },
      ads: { conversionId: 'AW-123', conversionLabel: 'lbl' },
      enhancedConversions: true,
    });
    expect(Object.keys(h.registrations)).toEqual(['google-ratio']);
  });

  it('registers only GA4 when Ads is absent', () => {
    const h = loadBundle({ ga4: { measurementId: 'G-X', isolated: false }, ads: null });
    expect(Object.keys(h.registrations)).toEqual(['google-ratio']);
  });

  describe('GA4 event mapping (isolated:false → no send_to)', () => {
    let h: Harness;
    beforeEach(() => {
      h = loadBundle({ ga4: { measurementId: 'G-TEST', isolated: false }, ads: null, enhancedConversions: false });
      h.registerAndWire();
      h.gtag.mockClear();
    });

    it('AddToCart → add_to_cart with items/value/currency, no send_to', () => {
      h.emit('AddToCart', {
        properties: { contents: [{ id: 'v1', item_price: 10, quantity: 2 }], value: 20, currency: 'INR' },
      });
      const call = h.gtag.mock.calls.find((c) => c[1] === 'add_to_cart');
      expect(call?.[2].value).toBe(20);
      expect(call?.[2].currency).toBe('INR');
      expect(call?.[2].send_to).toBeUndefined();
      expect(call?.[2].items[0].item_id).toBe('v1');
    });

    it('Purchase → purchase with transaction_id from order_id', () => {
      h.emit('Purchase', { properties: { order_id: 'o9', value: 99, currency: 'INR' } });
      const call = h.gtag.mock.calls.find((c) => c[1] === 'purchase');
      expect(call?.[2].transaction_id).toBe('o9');
      expect(call?.[2].value).toBe(99);
    });

    it('Search → search with search_term', () => {
      h.emit('Search', { properties: { search_string: 'shoes' } });
      expect(h.gtag.mock.calls.find((c) => c[1] === 'search')?.[2].search_term).toBe('shoes');
    });

    it('currency falls back to INR', () => {
      h.emit('AddToCart', { properties: { contents: [], value: 5 } });
      expect(h.gtag.mock.calls.find((c) => c[1] === 'add_to_cart')?.[2].currency).toBe('INR');
    });

    it('does not subscribe PageView (handled by Enhanced Measurement)', () => {
      expect(h.subscribed('PageView')).toBe(false);
    });

    it('a throwing handler does not break sibling subscriptions', () => {
      expect(() => h.emit('AddToCart', {})).not.toThrow();
    });
  });

  it('GA4 isolated:true scopes events with send_to: measurementId', () => {
    const h = loadBundle({ ga4: { measurementId: 'G-ISO', isolated: true }, ads: null });
    h.registerAndWire();
    h.gtag.mockClear();
    h.emit('AddToCart', { properties: { contents: [], value: 1, currency: 'INR' } });
    expect(h.gtag.mock.calls.find((c) => c[1] === 'add_to_cart')?.[2].send_to).toBe('G-ISO');
  });

  describe('Google Ads conversion mapping', () => {
    let h: Harness;
    beforeEach(() => {
      h = loadBundle({
        ga4: null,
        ads: { conversionId: 'AW-123', events: { Purchase: 'pl', AddToCart: 'al' } },
        enhancedConversions: true,
      });
      h.registerAndWire();
      h.gtag.mockClear();
    });

    it('Purchase → conversion with send_to=conversionId/label + transaction_id', () => {
      h.emit('Purchase', { properties: { order_id: 'o1', value: 50, currency: 'INR' } });
      const call = h.gtag.mock.calls.find((c) => c[0] === 'event' && c[1] === 'conversion');
      expect(call?.[2].send_to).toBe('AW-123/pl');
      expect(call?.[2].transaction_id).toBe('o1');
      expect(call?.[2].value).toBe(50);
    });

    it('AddToCart → conversion with send_to=conversionId/label, no transaction_id', () => {
      h.emit('AddToCart', { properties: { value: 5, currency: 'INR' } });
      const call = h.gtag.mock.calls.find((c) => c[1] === 'conversion');
      expect(call?.[2].send_to).toBe('AW-123/al');
      expect(call?.[2].transaction_id).toBeUndefined();
    });

    it('omits non-finite value (no NaN sent)', () => {
      h.emit('AddToCart', { properties: { value: 'oops', currency: 'INR' } });
      const call = h.gtag.mock.calls.find((c) => c[1] === 'conversion');
      expect('value' in (call?.[2] ?? {})).toBe(false);
    });

    it('enhanced conversions: attaches user_data via gtag set when enabled', () => {
      h.emit('Purchase', {
        properties: { order_id: 'o2', value: 1, currency: 'INR' },
        user_data: { sha256_email_address: 'abc' },
      });
      const setCall = h.gtag.mock.calls.find((c) => c[0] === 'set' && c[1] === 'user_data');
      expect(setCall?.[2]).toEqual({ sha256_email_address: 'abc' });
    });

    it('only labelled events subscribe', () => {
      expect(h.subscribed('InitiateCheckout')).toBe(false);
    });
  });

  it('GA4 + Ads coexist: one Purchase yields one GA4 purchase AND one Ads conversion', () => {
    const h = loadBundle({
      ga4: { measurementId: 'G-CO', isolated: false },
      ads: { conversionId: 'AW-9', conversionLabel: 'pl' },
      enhancedConversions: false,
    });
    h.registerAndWire();
    h.gtag.mockClear();
    h.emit('Purchase', { properties: { order_id: 'o', value: 10, currency: 'INR' } });
    const purchases = h.gtag.mock.calls.filter((c) => c[1] === 'purchase');
    const conversions = h.gtag.mock.calls.filter((c) => c[1] === 'conversion');
    expect(purchases).toHaveLength(1);
    expect(conversions).toHaveLength(1);
  });
});
