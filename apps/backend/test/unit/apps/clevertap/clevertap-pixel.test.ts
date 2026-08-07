import { describe, expect, it } from 'vitest';
import {
  CLEVERTAP_PIXEL_BUNDLE,
  EXPECTED_SDK_URL,
  loadPixel,
  makeConfig,
  makeEvent,
} from './helpers/pixel-harness';

describe('clevertap-pixel.js — config prelude (A5)', () => {
  it('no-ops silently when the config is missing', () => {
    const h = loadPixel({ noConfig: true });
    expect(Object.keys(h.registrations)).toEqual([]);
    expect(h.pending()).toEqual([]);
    expect(h.warns).toHaveLength(1);
    expect(h.clevertap?.account.calls).toEqual([]);
  });

  it('no-ops silently when accountId is missing', () => {
    const h = loadPixel({ config: makeConfig({ accountId: '' }) });
    expect(Object.keys(h.registrations)).toEqual([]);
    expect(h.warns).toHaveLength(1);
  });

  it('no-ops silently when region is missing', () => {
    const h = loadPixel({ config: makeConfig({ region: '' }) });
    expect(Object.keys(h.registrations)).toEqual([]);
    expect(h.warns).toHaveLength(1);
  });

  it('never reads a passcode from the prelude (the passcode is server-side only)', () => {
    expect(CLEVERTAP_PIXEL_BUNDLE).not.toMatch(/\.passcode\b/i);
    expect(CLEVERTAP_PIXEL_BUNDLE).not.toMatch(/["']passcode["']/i);
  });
});

describe('clevertap-pixel.js — SDK init + runtime registration (A5)', () => {
  it('initialises the SDK with accountId + region', () => {
    const h = loadPixel({ config: makeConfig({ accountId: 'ACC-123', region: 'sg1' }) });
    h.registerAll();
    expect(h.clevertap?.account.calls).toEqual([[{ id: 'ACC-123' }, 'sg1']]);
    expect(h.clevertap?.region).toBe('sg1');
  });

  it('injects the CleverTap Web SDK async from the documented CDN (R5)', () => {
    const h = loadPixel();
    h.registerAll();
    expect(h.scripts).toHaveLength(1);
    expect(h.scripts[0]?.src).toBe(EXPECTED_SDK_URL);
    expect(h.scripts[0]?.async).toBe(true);
    expect(h.scripts[0]?.tagName).toBe('script');
  });

  it('does not init or inject twice if register runs again', () => {
    const h = loadPixel();
    h.registerAll();
    h.registerAll();
    expect(h.clevertap?.account.calls).toHaveLength(1);
    expect(h.scripts).toHaveLength(1);
  });

  it('registers with the runtime when present', () => {
    const h = loadPixel();
    expect(Object.keys(h.registrations)).toEqual(['clevertap-ratio']);
    expect(h.pending()).toEqual([]);
  });

  it('queues into __OPEN_STORE_PIXEL_PENDING__ when the runtime is absent', () => {
    const h = loadPixel({ runtime: false });
    expect(Object.keys(h.registrations)).toEqual([]);
    expect(h.pending().map((r) => r.name)).toEqual(['clevertap-ratio']);
  });

  it('declares the six array-push queues when the page has no clevertap global', () => {
    const h = loadPixel({ stubClevertap: false });
    h.registerAll();
    const ct = h.rawClevertap() as Record<string, unknown[]> & { region?: string };
    for (const key of ['event', 'profile', 'account', 'onUserLogin', 'notifications', 'privacy']) {
      expect(Array.isArray(ct[key])).toBe(true);
    }
    expect(ct.account).toEqual([{ id: 'TEST-ACC-ID' }, 'in1']);
    expect(ct.region).toBe('in1');

    h.emit('ViewContent', makeEvent('ViewContent', { properties: { content_ids: ['v1'] } }));
    expect(ct.event[0]).toBe('Product Viewed');
  });

  it('still registers subscriptions when SDK init throws', () => {
    const h = loadPixel({ throwOn: 'account' });
    expect(() => h.registerAll()).not.toThrow();
    expect(h.subscribed('ViewContent')).toBe(true);
    expect(h.errors.length).toBeGreaterThan(0);
  });
});

describe('clevertap-pixel.js — event mapping (A5)', () => {
  it('forwards a subscribed event under its mapped CleverTap name', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('AddToCart', makeEvent('AddToCart', { properties: { value: 499, currency: 'INR' } }));
    const [name, attrs] = h.events()[0] ?? [];
    expect(name).toBe('Added to Cart');
    expect(attrs?.Value).toBe(499);
    expect(attrs?.Currency).toBe('INR');
  });

  it('honours a merchant-renamed event name', () => {
    const h = loadPixel({
      config: makeConfig({ eventNameMap: { AddToCart: 'Cart Add (Ratio)' } }),
    });
    h.registerAll();
    h.emit('AddToCart');
    expect(h.events().map(([n]) => n)).toEqual(['Cart Add (Ratio)']);
  });

  it('ignores events absent from the event map', () => {
    const h = loadPixel({
      config: makeConfig({ eventNameMap: { ViewContent: 'Product Viewed' } }),
    });
    h.registerAll();
    expect(h.subscribed('ViewContent')).toBe(true);
    expect(h.subscribed('Purchase')).toBe(false);
    expect(h.subscribed('AddToCart')).toBe(false);
  });

  it('does not subscribe an event mapped to an empty name (disabled)', () => {
    const h = loadPixel({
      config: makeConfig({ eventNameMap: { ViewContent: '', Search: 'Search' } }),
    });
    h.registerAll();
    expect(h.subscribed('ViewContent')).toBe(false);
    expect(h.subscribed('Search')).toBe(true);
  });

  it('maps page + session metadata onto CleverTap attributes', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('PageView');
    const attrs = h.events()[0]?.[1] ?? {};
    expect(attrs['Page URL']).toBe('https://store.example/p/1');
    expect(attrs['Page Path']).toBe('/p/1');
    expect(attrs['Session Id']).toBe('s1');
  });

  it('omits attributes that are absent (no undefined keys leak)', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('Search', makeEvent('Search', { properties: { search_string: 'kurta' } }));
    const attrs = h.events()[0]?.[1] ?? {};
    expect(attrs['Search Term']).toBe('kurta');
    expect('Order Id' in attrs).toBe(false);
    expect('Value' in attrs).toBe(false);
  });

  it('Purchase carries the Charged reserved fields (Amount, Charged ID, Items)', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit(
      'Purchase',
      makeEvent('Purchase', {
        properties: {
          order_id: 'o-77',
          value: 1559,
          currency: 'INR',
          contents: [{ id: 'v1', name: 'Kurta', item_price: 779.5, quantity: 2 }],
        },
      }),
    );
    const [name, attrs] = h.events()[0] ?? [];
    expect(name).toBe('Charged');
    expect(attrs?.Amount).toBe(1559);
    expect(attrs?.['Charged ID']).toBe('o-77');
    expect(attrs?.Items).toEqual([
      { 'Product Id': 'v1', 'Product Name': 'Kurta', Price: 779.5, Quantity: 2 },
    ]);
  });

  it('forwards pixel-bus values unchanged — the paise conversion is server-side only', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('Purchase', makeEvent('Purchase', { properties: { value: 1559, order_id: 'o1' } }));
    expect(h.events()[0]?.[1]?.Amount).toBe(1559);
  });

  it('an empty/absent contents list yields no Items key rather than throwing', () => {
    const h = loadPixel();
    h.registerAll();
    expect(() =>
      h.emit('Purchase', makeEvent('Purchase', { properties: { value: 1 } })),
    ).not.toThrow();
    expect('Items' in (h.events()[0]?.[1] ?? {})).toBe(false);
    h.emit('AddToCart', makeEvent('AddToCart', { properties: { contents: [] } }));
    expect(h.events()[1]?.[1]?.Items).toEqual([]);
  });

  it('a handler throw does not break the storefront', () => {
    const h = loadPixel({ throwOn: 'event' });
    h.registerAll();
    expect(() => h.emit('AddToCart')).not.toThrow();
    expect(h.errors.length).toBeGreaterThan(0);
  });

  it('survives a malformed event with no properties or metadata', () => {
    const h = loadPixel();
    h.registerAll();
    expect(() => h.emit('AddToCart', {})).not.toThrow();
    expect(h.events()).toHaveLength(1);
  });
});

describe('clevertap-pixel.js — identity bridge (A6)', () => {
  const user = {
    external_id: 'cust-1',
    email: 'shopper@example.com',
    phone: '9876543210',
    first_name: 'Asha',
    last_name: 'Rao',
  };

  it('fires onUserLogin on the first identified event', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('ViewContent', makeEvent('ViewContent', { user }));
    expect(h.logins()).toEqual([
      {
        Identity: 'cust-1',
        Phone: '+919876543210',
        Email: 'shopper@example.com',
        Name: 'Asha Rao',
      },
    ]);
  });

  it('fires onUserLogin before the event push', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('ViewContent', makeEvent('ViewContent', { user }));
    expect(h.order.indexOf('onUserLogin')).toBeLessThan(h.order.indexOf('event'));
  });

  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['0919876543210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
  ])('normalises phone %s to %s', (raw, expected) => {
    const h = loadPixel();
    h.registerAll();
    h.emit('ViewContent', makeEvent('ViewContent', { user: { external_id: 'c', phone: raw } }));
    expect(h.logins()[0]?.Phone).toBe(expected);
  });

  it('does not double-prefix an already-prefixed number', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('ViewContent', makeEvent('ViewContent', { user: { phone: '+919876543210' } }));
    expect(h.logins()[0]?.Phone).toBe('+919876543210');
    expect(h.logins()[0]?.Phone).not.toContain('+91+91');
    expect(h.logins()[0]?.Phone).not.toBe('+91919876543210');
  });

  it('uses the normalised phone as Identity when there is no external_id', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('InitiateCheckout', makeEvent('InitiateCheckout', { user: { phone: '9876543210' } }));
    expect(h.logins()[0]).toEqual({ Identity: '+919876543210', Phone: '+919876543210' });
  });

  it('falls back to email as Identity when neither external_id nor phone is present', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('Search', makeEvent('Search', { user: { email: 'e@example.com' } }));
    expect(h.logins()[0]).toEqual({ Identity: 'e@example.com', Email: 'e@example.com' });
  });

  it('does NOT re-fire for an unchanged identity', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('ViewContent', makeEvent('ViewContent', { user }));
    h.emit('AddToCart', makeEvent('AddToCart', { user }));
    h.emit('Purchase', makeEvent('Purchase', { user }));
    expect(h.logins()).toHaveLength(1);
    expect(h.events()).toHaveLength(3);
  });

  it('re-identifies when the identity changes A→B', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('ViewContent', makeEvent('ViewContent', { user: { external_id: 'A' } }));
    h.emit('ViewContent', makeEvent('ViewContent', { user: { external_id: 'B' } }));
    expect(h.logins().map((s) => s.Identity)).toEqual(['A', 'B']);
  });

  it('re-identifies when the same identity gains a phone (profile enrichment)', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('ViewContent', makeEvent('ViewContent', { user: { external_id: 'A' } }));
    h.emit(
      'AddToCart',
      makeEvent('AddToCart', { user: { external_id: 'A', phone: '9876543210' } }),
    );
    expect(h.logins()).toHaveLength(2);
    expect(h.logins()[1]?.Phone).toBe('+919876543210');
  });

  it('clears identity state on logout, so the next login re-identifies', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('ViewContent', makeEvent('ViewContent', { user }));
    h.emit('PageView', makeEvent('PageView'));
    expect(h.logins()).toHaveLength(1);
    h.emit('ViewContent', makeEvent('ViewContent', { user }));
    expect(h.logins()).toHaveLength(2);
    expect(h.logins()[1]?.Identity).toBe('cust-1');
  });

  it('never fires onUserLogin for a purely anonymous event', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('PageView', makeEvent('PageView'));
    h.emit('ViewContent', makeEvent('ViewContent', { properties: { content_ids: ['v1'] } }));
    expect(h.logins()).toEqual([]);
    expect(h.events()).toHaveLength(2);
  });

  it('omits Phone/Email/Name when only external_id is known', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('PageView', makeEvent('PageView', { user: { external_id: 'cust-9' } }));
    expect(h.logins()[0]).toEqual({ Identity: 'cust-9' });
  });

  it('ignores a blank phone rather than emitting "+91"', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('PageView', makeEvent('PageView', { user: { external_id: 'c', phone: '   ' } }));
    expect(h.logins()[0]).toEqual({ Identity: 'c' });
  });

  it('an onUserLogin failure still forwards the event and retries next time', () => {
    const h = loadPixel({ throwOn: 'onUserLogin' });
    h.registerAll();
    expect(() => h.emit('ViewContent', makeEvent('ViewContent', { user }))).not.toThrow();
    expect(h.events()).toHaveLength(1);
    h.emit('AddToCart', makeEvent('AddToCart', { user }));
    expect(h.clevertap?.onUserLogin.calls).toHaveLength(2);
    expect(h.errors.length).toBeGreaterThan(0);
  });

  it('still identifies from metadata.user_data alone (no __openstore_user) — no regression', () => {
    const h = loadPixel();
    h.registerAll();
    expect(h.openstoreUser()).toBeUndefined();
    h.emit('AddToCart', makeEvent('AddToCart', { user }));
    expect(h.logins()).toHaveLength(1);
    expect(h.logins()[0]?.Identity).toBe('cust-1');
  });
});

describe('clevertap-pixel.js — identity source 1: window.__openstore_user (A6)', () => {
  const published = {
    external_id: 'cust-7',
    email: 'shopper@example.com',
    phone: '9876543210',
    first_name: 'Asha',
    last_name: 'Rao',
  };

  it('identifies from window.__openstore_user with NO bus event at all', () => {
    const h = loadPixel({ openstoreUser: published });
    expect(h.logins()).toEqual([
      {
        Identity: 'cust-7',
        Phone: '+919876543210',
        Email: 'shopper@example.com',
        Name: 'Asha Rao',
      },
    ]);
    expect(h.events()).toEqual([]);
  });

  it('takes __openstore_user as primary when metadata.user_data disagrees', () => {
    const h = loadPixel({ openstoreUser: { phone: '9000000001' } });
    h.registerAll();
    h.emit('AddToCart', makeEvent('AddToCart', { user: { phone: '9000000002' } }));
    expect(h.logins()).toHaveLength(1);
    expect(h.logins()[0]?.Phone).toBe('+919000000001');
  });

  it('lets metadata.user_data fill the gaps __openstore_user leaves', () => {
    const h = loadPixel({ openstoreUser: { phone: '9876543210' } });
    h.registerAll();
    expect(h.logins()[0]).toEqual({ Identity: '+919876543210', Phone: '+919876543210' });
    h.emit(
      'AddToCart',
      makeEvent('AddToCart', { user: { email: 'e@example.com', first_name: 'Asha' } }),
    );
    expect(h.logins()).toHaveLength(2);
    expect(h.logins()[1]).toEqual({
      Identity: '+919876543210',
      Phone: '+919876543210',
      Email: 'e@example.com',
      Name: 'Asha',
    });
  });

  it('re-reads __openstore_user before every event (identity appearing mid-session)', () => {
    const h = loadPixel();
    h.registerAll();
    h.emit('PageView');
    expect(h.logins()).toEqual([]);
    h.setOpenstoreUser({ phone: '9876543210' });
    h.emit('ViewContent');
    expect(h.logins()).toEqual([{ Identity: '+919876543210', Phone: '+919876543210' }]);
  });

  it('does not identify when __openstore_user holds no identity field', () => {
    expect(loadPixel({ openstoreUser: {} }).logins()).toEqual([]);
    expect(loadPixel({ openstoreUser: { first_name: 'Asha' } }).logins()).toEqual([]);
  });

  it.each([
    ['a string'],
    [42],
    [null],
    [[]],
    [true],
  ])('survives a non-object __openstore_user (%s)', (value) => {
    const h = loadPixel({ openstoreUser: value });
    expect(h.logins()).toEqual([]);
    h.registerAll();
    expect(() => h.emit('AddToCart')).not.toThrow();
    expect(h.events()).toHaveLength(1);
  });

  it('initialises the CleverTap SDK on demand for an identity that precedes register()', () => {
    const h = loadPixel({ stubClevertap: false, openstoreUser: { phone: '9876543210' } });
    const ct = h.rawClevertap() as Record<string, unknown[]> & { region?: string };
    expect(ct.account).toEqual([{ id: 'TEST-ACC-ID' }, 'in1']);
    expect(ct.onUserLogin[0]).toEqual({
      Site: { Identity: '+919876543210', Phone: '+919876543210' },
    });
    expect(h.scripts).toHaveLength(1);
  });

  it('does NOT initialise the SDK at load when there is no identity', () => {
    const h = loadPixel({ stubClevertap: false });
    expect(h.rawClevertap()).toBeUndefined();
    expect(h.scripts).toEqual([]);
  });
});

describe('clevertap-pixel.js — identity source 2: GoKwik/KwikPass postMessage (A6)', () => {
  const OTP_MSG = { type: 'gk-event', eventName: 'otpVerifiedGk', data: { phone: '9876543210' } };

  it('attaches the message + login listeners at load, before any registration', () => {
    const h = loadPixel();
    expect(h.listenerCount('message')).toBe(1);
    expect(h.listenerCount('user-loggedin')).toBe(1);
    expect(h.listenerCount('user_loggedin_merchant')).toBe(1);
  });

  it.each([
    ['https://pdp.gokwik.co'],
    ['https://api.gokwik.com'],
    ['https://checkout.gokwik.in'],
    ['https://sandbox.dev.gokwik.io'],
    ['https://gokwik.co'],
    ['https://checkout.gokwik.co:8443'],
  ])('identifies on an otpVerifiedGk postMessage from %s', (origin) => {
    const h = loadPixel();
    h.postMessage(origin, OTP_MSG);
    expect(h.logins()).toEqual([{ Identity: '+919876543210', Phone: '+919876543210' }]);
  });

  it('identifies on a kp_token postMessage', () => {
    const h = loadPixel();
    h.postMessage('https://pdp.gokwik.co', {
      type: 'kp_token',
      data: { phone: '98765 43210', email: 'otp@example.com' },
    });
    expect(h.logins()).toEqual([
      { Identity: '+919876543210', Phone: '+919876543210', Email: 'otp@example.com' },
    ]);
  });

  it('re-reads __openstore_user on an auth signal that carries no PII itself', () => {
    const h = loadPixel();
    h.setOpenstoreUser({ external_id: 'cust-9', phone: '9876543210' });
    h.postMessage('https://pdp.gokwik.co', { type: 'gk-event', eventName: 'otpVerifiedGk' });
    expect(h.logins()).toEqual([{ Identity: 'cust-9', Phone: '+919876543210' }]);
  });

  it.each([
    ['https://evil.example.com'],
    ['https://gokwik.co.evil.com'],
    ['https://notgokwik.com'],
    ['https://fakegokwik.in'],
    ['https://gokwik.io.attacker.net'],
    ['https://gokwik.net'],
    ['http://localhost:3000'],
  ])('IGNORES a postMessage from the non-GoKwik origin %s', (origin) => {
    const h = loadPixel();
    h.postMessage(origin, {
      type: 'kp_token',
      eventName: 'otpVerifiedGk',
      cartData: { email: 'leak@evil.com', phone: '9999999999', customer_id: 'x' },
    });
    expect(h.logins()).toEqual([]);
    expect(h.openstoreUser()).toBeUndefined();
  });

  it('a cart postMessage carrying email/phone populates __openstore_user and identifies', () => {
    const h = loadPixel();
    h.postMessage('https://checkout.gokwik.in', {
      type: 'gk-event',
      eventName: 'CheckoutInitiated',
      cartData: {
        email: 'cart@example.com',
        phone: '9812345678',
        customer_id: 4321,
        total: 1299,
        line_items: [{ product_id: 'v1', quantity: 1, price: 1299 }],
      },
    });
    expect(h.openstoreUser()).toEqual({
      email: 'cart@example.com',
      phone: '9812345678',
      external_id: '4321',
    });
    expect(h.logins()).toEqual([
      { Identity: '4321', Phone: '+919812345678', Email: 'cart@example.com' },
    ]);
  });

  it('merges captured PII into an existing __openstore_user instead of clobbering it', () => {
    const h = loadPixel({ openstoreUser: { first_name: 'Asha', last_name: 'Rao' } });
    expect(h.logins()).toEqual([]);
    h.postMessage('https://pdp.gokwik.co', {
      type: 'gk-event',
      eventName: 'CheckoutInitiated',
      cartData: { phone: '9812345678' },
    });
    expect(h.openstoreUser()).toEqual({
      first_name: 'Asha',
      last_name: 'Rao',
      phone: '9812345678',
    });
    expect(h.logins()).toEqual([
      { Identity: '+919812345678', Phone: '+919812345678', Name: 'Asha Rao' },
    ]);
  });

  it('captures nothing from a GoKwik cart message with no email or phone', () => {
    const h = loadPixel();
    h.postMessage('https://pdp.gokwik.co', {
      type: 'gk-event',
      eventName: 'CheckoutInitiated',
      cartData: { total: 1299, line_items: [] },
    });
    expect(h.logins()).toEqual([]);
    expect(h.openstoreUser()).toBeUndefined();
  });

  it.each([
    ['no data', 'https://pdp.gokwik.co', undefined],
    ['null data', 'https://pdp.gokwik.co', null],
    ['string data', 'https://pdp.gokwik.co', 'otpVerifiedGk'],
    ['array data', 'https://pdp.gokwik.co', [1, 2, 3]],
    ['numeric type', 'https://pdp.gokwik.co', { type: 123, eventName: 456 }],
    ['nested null', 'https://pdp.gokwik.co', { type: 'kp_token', data: null, cartData: null }],
    ['no origin', undefined, { type: 'kp_token', data: { phone: '9876543210' } }],
    ['blank origin', '', { type: 'kp_token', data: { phone: '9876543210' } }],
    ['unparseable origin', 'not-a-url', { type: 'kp_token', data: { phone: '9876543210' } }],
    ['null origin', null, { type: 'kp_token', data: { phone: '9876543210' } }],
  ])('a malformed/hostile postMessage (%s) does not throw', (_label, origin, data) => {
    const h = loadPixel();
    expect(() => h.postMessage(origin, data)).not.toThrow();
    expect(h.logins()).toEqual([]);
    expect(h.openstoreUser()).toBeUndefined();
    h.registerAll();
    expect(() => h.emit('AddToCart')).not.toThrow();
  });

  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
  ])('normalises phone %s to %s through the postMessage path', (raw, expected) => {
    const h = loadPixel();
    h.postMessage('https://pdp.gokwik.co', {
      type: 'gk-event',
      eventName: 'otpVerifiedGk',
      data: { phone: raw },
    });
    expect(h.logins()[0]?.Phone).toBe(expected);
    expect(h.logins()[0]?.Phone).not.toContain('+91+91');
  });
});

describe('clevertap-pixel.js — identity source 3: KwikPass login CustomEvents (A6)', () => {
  it.each([
    ['user-loggedin'],
    ['user_loggedin_merchant'],
  ])('identifies when the %s window event fires', (eventName) => {
    const h = loadPixel();
    h.setOpenstoreUser({ external_id: 'cust-3', phone: '9876543210' });
    h.fireWindowEvent(eventName);
    expect(h.logins()).toEqual([{ Identity: 'cust-3', Phone: '+919876543210' }]);
  });

  it('normalises phone through the user-loggedin path', () => {
    const h = loadPixel();
    h.setOpenstoreUser({ phone: '+91-98765-43210' });
    h.fireWindowEvent('user-loggedin');
    expect(h.logins()[0]?.Phone).toBe('+919876543210');
  });

  it('fires nothing when user-loggedin arrives with no PII published anywhere', () => {
    const h = loadPixel();
    expect(() => h.fireWindowEvent('user-loggedin')).not.toThrow();
    expect(() => h.fireWindowEvent('user_loggedin_merchant')).not.toThrow();
    expect(h.logins()).toEqual([]);
  });
});

describe('clevertap-pixel.js — identity bridge: cross-source dedup (A6)', () => {
  const cartMsg = (phone: string, customerId: string) => ({
    type: 'gk-event',
    eventName: 'otpVerifiedGk',
    cartData: { phone, customer_id: customerId },
  });

  it('fires exactly ONE onUserLogin for one login seen by postMessage AND user-loggedin', () => {
    const h = loadPixel();
    h.postMessage('https://pdp.gokwik.co', cartMsg('9876543210', 'cust-1'));
    h.fireWindowEvent('user-loggedin');
    h.fireWindowEvent('user_loggedin_merchant');
    h.postMessage('https://pdp.gokwik.co', cartMsg('9876543210', 'cust-1'));
    expect(h.logins()).toHaveLength(1);
    expect(h.logins()[0]?.Identity).toBe('cust-1');
  });

  it('does not re-fire for an unchanged identity across many bus events and signals', () => {
    const h = loadPixel();
    h.postMessage('https://pdp.gokwik.co', cartMsg('9876543210', 'cust-1'));
    h.registerAll();
    h.emit('ViewContent');
    h.emit('AddToCart');
    h.emit('Purchase');
    h.fireWindowEvent('user-loggedin');
    expect(h.logins()).toHaveLength(1);
    expect(h.events()).toHaveLength(3);
  });

  it('keeps onUserLogin before the event push when identity came from a postMessage', () => {
    const h = loadPixel();
    h.registerAll();
    h.postMessage('https://pdp.gokwik.co', cartMsg('9876543210', 'cust-1'));
    h.emit('AddToCart', makeEvent('AddToCart', { user: { external_id: 'cust-1', phone: '999' } }));
    expect(h.order.indexOf('onUserLogin')).toBeLessThan(h.order.lastIndexOf('event'));
  });

  it('re-identifies on an A→B switch seen entirely through postMessages', () => {
    const h = loadPixel();
    h.postMessage('https://pdp.gokwik.co', cartMsg('9876543210', 'cust-A'));
    h.postMessage('https://pdp.gokwik.co', cartMsg('9812345678', 'cust-B'));
    expect(h.logins().map((s) => s.Identity)).toEqual(['cust-A', 'cust-B']);
    expect(h.logins()[1]?.Phone).toBe('+919812345678');
  });

  it('clears identity on logout, then a later KwikPass login re-fires', () => {
    const h = loadPixel();
    h.registerAll();
    h.postMessage('https://pdp.gokwik.co', cartMsg('9876543210', 'cust-1'));
    expect(h.logins()).toHaveLength(1);

    h.setOpenstoreUser(undefined);
    h.emit('PageView');
    expect(h.logins()).toHaveLength(1);

    h.setOpenstoreUser({ external_id: 'cust-1', phone: '9876543210' });
    h.fireWindowEvent('user-loggedin');
    expect(h.logins()).toHaveLength(2);
    expect(h.logins()[1]?.Identity).toBe('cust-1');
  });

  it('never fires onUserLogin when every source is anonymous', () => {
    const h = loadPixel();
    h.registerAll();
    h.postMessage('https://pdp.gokwik.co', { type: 'gk-event', eventName: 'CheckoutInitiated' });
    h.fireWindowEvent('user-loggedin');
    h.emit('PageView');
    h.emit('ViewContent');
    expect(h.logins()).toEqual([]);
    expect(h.events()).toHaveLength(2);
  });

  it.each([
    ['a KWIKUSERTOKEN cookie', { cookie: 'foo=bar; KWIKUSERTOKEN=tok-1' }],
    ['a SANDBOXKWIKUSERTOKEN cookie', { cookie: 'SANDBOXKWIKUSERTOKEN=tok-2' }],
    ['a DEVKWIKUSERTOKEN in localStorage', { localStorage: { DEVKWIKUSERTOKEN: 'tok-3' } }],
    ['a QAKWIKUSERTOKEN in localStorage', { localStorage: { QAKWIKUSERTOKEN: 'tok-4' } }],
  ])('keeps the identity while %s proves the KwikPass session is still live', (_label, opts) => {
    const h = loadPixel({ ...opts, openstoreUser: { external_id: 'cust-1', phone: '9876543210' } });
    h.registerAll();
    expect(h.logins()).toHaveLength(1);

    h.setOpenstoreUser(undefined);
    h.emit('PageView');
    h.setOpenstoreUser({ external_id: 'cust-1', phone: '9876543210' });
    h.fireWindowEvent('user-loggedin');
    expect(h.logins()).toHaveLength(1);
  });

  it('treats a throwing localStorage (Safari private mode) as no session', () => {
    const h = loadPixel({
      localStorage: 'throw',
      openstoreUser: { external_id: 'cust-1', phone: '9876543210' },
    });
    h.registerAll();
    expect(h.logins()).toHaveLength(1);
    h.setOpenstoreUser(undefined);
    expect(() => h.emit('PageView')).not.toThrow();
    h.setOpenstoreUser({ external_id: 'cust-1', phone: '9876543210' });
    h.fireWindowEvent('user-loggedin');
    expect(h.logins()).toHaveLength(2);
  });
});
