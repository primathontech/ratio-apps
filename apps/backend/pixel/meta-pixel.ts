/*!
 * meta-g4-ratio-app — Meta (Facebook) storefront pixel (TypeScript source)
 *
 * Compiled to `static/meta-pixel.js` by
 *   `pnpm --filter @ratio-app/backend pixel:build:all`.
 * The backend serves the compiled JS per-merchant, prepending a one-line
 * config prelude (see MetaSdkService.buildPrelude):
 *   window.__META_RATIO_CONFIG__ =
 *     { pixelId, capiPath, dataSharingLevel, productIdType, debug, merchantId, eventNameMap };
 *
 * SELF-CONTAINED: the merchant pastes ONE <script> tag and nothing else.
 *
 * EVENT SOURCING — layered, best-available wins (see init at bottom):
 *   1. PRIMARY  — subscribe to the storefront's event bus
 *        `window.__OPENSTORE_EVENT_BUS__` (from @shopkit/events). Gives all
 *        13 Meta events already-shaped, with event_id + rich data, exactly
 *        like a first-party pixel. Not gated/expiring like the PixelRuntime.
 *   2. FALLBACK — observe, for stores without the bus:
 *        - URL routing       → PageView / ViewContent / Search
 *        - fetch interception → AddToCart
 *        - GoKwik iframe postMessage → InitiateCheckout / AddShippingInfo /
 *          AddPaymentInfo / Purchase / CompleteRegistration (with order data)
 *   3. MANUAL   — `window.__triggerPixelEvent__(name, props)` escape hatch:
 *        a merchant can paste 1–2 extra lines to fire anything we can't see.
 *
 * A cross-source dedup guard ensures each logical event fires once even if
 * two layers observe the same action.
 *
 * Call architecture (per event, whatever the source):
 *   CALL A: fbq('trackSingle', pixelId, name, data, { eventID }) — browser → Meta
 *   CALL B: POST capiPath { events:[...] }                       — browser → our backend (batched)
 *   CALL C: backend → graph.facebook.com (server-side, hashed PII)
 * Calls A + C share the same event_id → Meta deduplicates.
 */

interface MetaRatioConfig {
  pixelId: string;
  capiPath: string;
  dataSharingLevel: 'standard' | 'enhanced' | 'maximum';
  productIdType: string;
  debug: boolean;
  merchantId: string;
  eventNameMap: Record<string, string>;
  debugMockBase?: string; // dev only: base URL for Call A stub (e.g. http://localhost:8081)
}

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
  disablePushState?: boolean;
  allowDuplicatePageViews?: boolean;
};

/** An event as emitted by the @shopkit/events bus (window.__OPENSTORE_EVENT_BUS__). */
interface BusEvent {
  event_type: string;
  event_id?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
  page?: { url?: string };
}

// biome-ignore lint/correctness/noUnusedVariables: Window augmentation consumed via window.* in IIFE
interface Window {
  __META_RATIO_CONFIG__?: MetaRatioConfig;
  __triggerPixelEvent__?: (eventName: string, properties?: Record<string, unknown>) => void;
  fbq?: Fbq;
  _fbq?: Fbq;
  // Storefront event bus (@shopkit/events) — primary event source when present.
  __OPENSTORE_EVENT_BUS__?: {
    subscribeAll?: (fn: (e: BusEvent) => void) => unknown;
    getEventLog?: () => BusEvent[];
  };
  // PII the storefront/checkout publishes for match quality.
  __openstore_user?: Record<string, unknown>;
}

(() => {
  const LOG = '[MetaRatioPixel]';
  const config = window.__META_RATIO_CONFIG__;
  if (!config?.pixelId) {
    console.warn(LOG, 'config missing or incomplete — pixel did not initialize.', config);
    return;
  }
  const cfg: MetaRatioConfig = config;
  const PIXEL_IDS = String(cfg.pixelId).split(',').map((s) => s.trim()).filter(Boolean);
  const LEVEL = cfg.dataSharingLevel || 'maximum';
  const map = cfg.eventNameMap ?? {};
  // The merchant's ENABLED Meta event names. `eventNameMap` is built server-side
  // from config.events and already excludes disabled events, so its values are
  // exactly the Meta names the merchant left ON. Empty map => no toggles known
  // (older prelude) → fall back to every supported Meta event, matching the
  // server's backward-compatible behaviour.
  const ENABLED_META = new Set(Object.values(map));
  const isEventEnabled = (metaName: string): boolean =>
    ENABLED_META.size === 0 ? Boolean(META_EVENTS[metaName]) : ENABLED_META.has(metaName);

  // The 13 canonical Meta events we support. The bus emits these names
  // directly; URL/manual paths resolve to them via eventNameMap (or identity).
  const META_EVENTS: Record<string, true> = {
    PageView: true, ViewContent: true, AddToCart: true, InitiateCheckout: true,
    AddShippingInfo: true, AddPaymentInfo: true, Purchase: true, Search: true,
    AddToWishlist: true, Lead: true, CompleteRegistration: true, Contact: true,
    Subscribe: true,
  };

  // ─── CALL B batching ────────────────────────────────────────────────────
  const FLUSH_MS = 5000;
  const MAX_BATCH = 10;
  const MAX_QUEUE = 50;
  const HIGH_VALUE: Record<string, boolean> = { Purchase: true, InitiateCheckout: true };
  let queue: Record<string, unknown>[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function shouldSendCapi(eventName: string): boolean {
    if (LEVEL === 'standard') return false;
    if (LEVEL === 'enhanced') return eventName === 'Purchase';
    return true;
  }

  function flush(): void {
    if (!queue.length || !cfg.capiPath) return;
    const batch = queue.slice();
    queue = [];
    if (timer) { clearTimeout(timer); timer = null; }
    let body: string;
    try {
      body = JSON.stringify({ events: batch });
    } catch (err) {
      console.error(LOG, 'Event serialization failed — batch dropped', err);
      return;
    }
    try {
      if (navigator && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(cfg.capiPath, blob)) return;
      }
    } catch (_e) { /* fall through */ }
    if (typeof fetch === 'function') {
      fetch(cfg.capiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch((err) => console.error(LOG, 'CAPI fetch failed', err));
    }
  }

  function queueCapi(eventName: string, capiEvent: Record<string, unknown>): void {
    if (!shouldSendCapi(eventName) || !cfg.capiPath) return;
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push(capiEvent);
    if (HIGH_VALUE[eventName]) { flush(); return; }
    if (queue.length >= MAX_BATCH) { flush(); return; }
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', () => flush());

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function readCookie(name: string): string {
    const m = document.cookie.match(`(^|;)\\s*${name}\\s*=\\s*([^;]+)`);
    return m ? (m.pop() ?? '') : '';
  }

  function buildCustomData(p: Record<string, unknown>): Record<string, unknown> {
    const cd: Record<string, unknown> = {};
    const keys = [
      'content_ids', 'content_type', 'content_name', 'content_category', 'value',
      'currency', 'contents', 'num_items', 'order_id', 'search_string', 'coupon',
    ];
    for (const k of keys) { if (p[k] !== undefined) cd[k] = p[k]; }
    return cd;
  }

  function makeEventId(): string {
    return 'evt-' + Math.random().toString(36).slice(2, 11);
  }

  function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  }

  // Map the storefront's published PII (window.__openstore_user) + Meta cookies
  // to our backend's user_data keys. RAW values — the backend hashes (em/ph/fn/ln).
  function readUserData(): Record<string, unknown> {
    const ud: Record<string, unknown> = {};
    const u = asRecord(window.__openstore_user);
    if (u.email) ud.em = u.email;
    if (u.phone) ud.ph = u.phone;
    if (u.first_name) ud.fn = u.first_name;
    if (u.last_name) ud.ln = u.last_name;
    if (u.external_id) ud.external_id = u.external_id;
    const fbp = readCookie('_fbp'); if (fbp) ud.fbp = fbp;
    const fbc = readCookie('_fbc'); if (fbc) ud.fbc = fbc;
    return ud;
  }

  // ─── Cross-source dedup ───────────────────────────────────────────────────
  // Prevents the same logical event firing twice when two layers observe it
  // (e.g. SPA double-nav, or bus + postMessage). Keyed by event + identity.
  const DEDUP_MS = 1500;
  const lastFired: Record<string, number> = {};
  function isDuplicate(metaName: string, cd: Record<string, unknown>): boolean {
    const ids = Array.isArray(cd.content_ids) ? (cd.content_ids as unknown[]).join(',') : '';
    const key = `${metaName}|${cd.order_id ?? ''}|${ids}|${cd.search_string ?? ''}`;
    const now = Date.now();
    const prev = lastFired[key];
    if (prev !== undefined && now - prev < DEDUP_MS) return true;
    lastFired[key] = now;
    return false;
  }

  // ─── Core choke point: fire CALL A + CALL B for ONE Meta event ────────────
  function emit(
    metaName: string,
    props: Record<string, unknown> = {},
    opts: { eventId?: string; sourceUrl?: string; userData?: Record<string, unknown> } = {},
  ): void {
    if (!metaName || !META_EVENTS[metaName]) {
      if (cfg.debug) console.log(LOG, 'skip (unknown event)', metaName);
      return;
    }
    // Respect the merchant's per-event toggle. A canonical Meta name (e.g.
    // PageView from URL routing) would otherwise bypass the eventNameMap gate
    // and fire even when turned off in the admin.
    if (!isEventEnabled(metaName)) {
      if (cfg.debug) console.log(LOG, 'skip (disabled by merchant)', metaName);
      return;
    }
    const customData = buildCustomData(props);
    if (isDuplicate(metaName, customData)) {
      if (cfg.debug) console.log(LOG, 'deduped', metaName);
      return;
    }
    const eventId = opts.eventId || makeEventId();
    if (cfg.debug) console.log(LOG, '→', metaName, customData);

    // CALL A — browser pixel
    const fbq = window.fbq;
    if (fbq) {
      for (const id of PIXEL_IDS) {
        fbq('trackSingle', id, metaName, customData, { eventID: eventId });
      }
    }

    // CALL B — our backend (server-side CAPI dispatch)
    queueCapi(metaName, {
      event_name: metaName,
      event_id: eventId,
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: opts.sourceUrl || location.href,
      action_source: 'website',
      user_data: opts.userData || readUserData(),
      custom_data: customData,
    });
  }

  // Resolve an arbitrary name (OS or Meta) to a Meta event name.
  function resolveMeta(name: string): string {
    if (META_EVENTS[name]) return name;       // already a Meta name
    return map[name] || '';                    // OS name → Meta via merchant map
  }
  function fireByName(name: string, props: Record<string, unknown> = {}): void {
    emit(resolveMeta(name), props);
  }

  // ─── Load fbevents.js ────────────────────────────────────────────────────
  // In debug mode: skip loading fbevents.js from connect.facebook.net and
  // install a local stub that POSTs Call A to the mock server so both calls
  // show up in /debug/events. debugMockBase is injected by the backend
  // (sdk.service.ts) from FACEBOOK_CAPI_BASE_URL in .env.
  function loadFbq(): void {
    if (window.fbq) return;

    if (cfg.debug && cfg.debugMockBase) {
      const mockBase = cfg.debugMockBase;
      const stub: Fbq = function (...args: unknown[]): void {
        const [cmd, pixelId, eventName, data, opts] = args as [string, string, string, unknown, Record<string, unknown>];
        console.log('[MetaRatioPixel][debug][fbq]', cmd, pixelId, eventName, data, opts);
        if (cmd === 'trackSingle' && eventName) {
          // POST Call A to mock → shows as "Pixel (browser)" (no access_token)
          fetch(`${mockBase}/${pixelId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: [{
                event_name: eventName,
                event_id: (opts as Record<string, unknown>)?.eventID,
                event_time: Math.floor(Date.now() / 1000),
                event_source_url: location.href,
                action_source: 'website',
                custom_data: data ?? {},
              }],
            }),
            keepalive: true,
          }).catch(() => {/* ignore */});
        }
      } as unknown as Fbq;
      stub.push = stub; stub.loaded = true; stub.version = '2.0'; stub.queue = [];
      stub.disablePushState = true; stub.allowDuplicatePageViews = true;
      window.fbq = stub;
      if (!window._fbq) window._fbq = stub;
      console.log('[MetaRatioPixel][debug] fbq stub → Call A posting to', mockBase);
      return;
    }

    // Production (or debug without mockBase): load real fbevents.js
    const n: Fbq = function (this: unknown, ...args: unknown[]): void {
      n.callMethod ? n.callMethod.apply(n, args) : (n.queue as unknown[]).push(args);
    } as Fbq;
    window.fbq = n;
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    const t = document.createElement('script');
    t.async = true;
    t.src = 'https://connect.facebook.net/en_US/fbevents.js';
    const s = document.getElementsByTagName('script')[0];
    s?.parentNode?.insertBefore(t, s);
  }

  // ─── LAYER 1 (PRIMARY): subscribe to the storefront event bus ─────────────
  let busAttached = false;
  function tryAttachBus(): boolean {
    const bus = window.__OPENSTORE_EVENT_BUS__;
    if (!bus || typeof bus.subscribeAll !== 'function') return false;
    const handle = (e: BusEvent): void => {
      if (!e || !META_EVENTS[e.event_type]) return;
      emit(e.event_type, e.data ?? {}, {
        eventId: e.event_id,
        sourceUrl: e.page?.url,
        userData: readUserData(),
      });
    };
    try {
      // Backfill events that fired before our script loaded (e.g. initial PageView).
      if (typeof bus.getEventLog === 'function') {
        const past = bus.getEventLog();
        if (Array.isArray(past)) for (const e of past) handle(e);
      }
      bus.subscribeAll(handle);
      busAttached = true;
      // The bus never emits Search — supplement it via URL routing.
      attachSearchRouting();
      if (cfg.debug) console.log(LOG, 'PRIMARY: attached to __OPENSTORE_EVENT_BUS__');
      return true;
    } catch (err) {
      console.warn(LOG, 'bus attach failed — will fall back to observe', err);
      return false;
    }
  }

  // ─── LAYER 2 (FALLBACK): observe — URL routing ────────────────────────────
  function getPageEvent(): { name: string; props: Record<string, unknown> } {
    const parts = location.pathname.split('/').filter(Boolean);
    const p0 = parts[0];
    if (p0 === 'product' || p0 === 'products') {
      const slug = parts.slice(1).join('/') || p0;
      return { name: 'ViewContent', props: { content_ids: [slug], content_type: 'product', currency: 'INR', value: 0 } };
    }
    if (p0 === 'collection' || p0 === 'collections') {
      return { name: 'Search', props: { search_string: parts[1] ?? '', content_type: 'collection', currency: 'INR', value: 0 } };
    }
    if (p0 === 'search') {
      const q = new URLSearchParams(location.search).get('q') ?? '';
      return { name: 'Search', props: { search_string: q, content_type: 'product', currency: 'INR', value: 0 } };
    }
    return { name: 'PageView', props: {} };
  }
  function fireForCurrentPage(): void {
    const ev = getPageEvent();
    if (ev.name !== 'PageView') fireByName('PageView', {});
    fireByName(ev.name, ev.props);
  }

  // ─── LAYER 2 (FALLBACK): observe — GoKwik checkout/kwikpass postMessage ────
  // The GoKwik checkout & kwikpass iframes broadcast funnel events over
  // window.postMessage (same source the storefront's own CheckoutEmitter uses).
  // Any script can listen — so we capture the high-value conversion events
  // without the bus.
  function attachGokwikMessages(): void {
    // GoKwik-owned TLDs. `.io` is the dev/sandbox env (e.g. *.dev.gokwik.io),
    // so KwikPass/checkout postMessages there are accepted too.
    const ORIGIN_RE = /(^|\.)gokwik\.(co|com|in|io)$/i;
    window.addEventListener('message', (msg: MessageEvent) => {
      let host = '';
      try { host = new URL(msg.origin).hostname; } catch { return; }
      if (!ORIGIN_RE.test(host)) return;

      const d = asRecord(msg.data);
      const type = typeof d.type === 'string' ? d.type : '';
      if (!type) return;
      const evName = typeof d.eventName === 'string' ? d.eventName : type;

      const cart = asRecord(d.cartData);
      const itemsRaw = Array.isArray(cart.line_items) ? cart.line_items
        : Array.isArray(cart.items) ? cart.items : [];
      const items = (itemsRaw as unknown[]).map(asRecord);
      const value = typeof cart.total === 'number'
        ? cart.total
        : items.reduce((s, i) => s + (typeof i.price === 'number' ? i.price : 0) * (typeof i.quantity === 'number' ? i.quantity : 1), 0);
      const currency = typeof cart.currency === 'string' ? cart.currency : 'INR';
      const contents = items.map((i) => ({
        id: String(i.product_id ?? i.variant_id ?? i.sku ?? i.id ?? ''),
        quantity: typeof i.quantity === 'number' ? i.quantity : 1,
        item_price: typeof i.price === 'number' ? i.price : undefined,
      }));
      const content_ids = contents.map((c) => c.id).filter(Boolean);
      const coupon = typeof cart.coupon === 'string' ? cart.coupon : undefined;

      // Capture PII for match quality (mirrors the storefront's CheckoutEmitter).
      if (cart.email || cart.phone) {
        window.__openstore_user = {
          email: cart.email, phone: cart.phone,
          external_id: cart.customer_id ? String(cart.customer_id) : undefined,
        };
      }

      const base: Record<string, unknown> = { content_ids, contents, value, currency };
      if (coupon) base.coupon = coupon;

      // KwikPass auth is NOT published on the OpenStore bus, so honor it ALWAYS
      // (even when the bus is the active source) — otherwise login never fires
      // CompleteRegistration on bus-backed storefronts (e.g. bblunt).
      if (evName === 'otpVerifiedGk' || type === 'kp_token') {
        emit('CompleteRegistration', {});
        return;
      }
      // The commerce funnel below IS emitted by the bus. When the bus is the
      // active source, skip the postMessage funnel to avoid double-counting (the
      // two paths use different event_ids, so Meta would NOT dedupe them).
      if (busAttached) return;
      if (evName === 'CheckoutInitiated') emit('InitiateCheckout', base);
      else if (evName === 'ShippingInfoAdded') emit('AddShippingInfo', { value, currency, ...(coupon ? { coupon } : {}) });
      else if (evName === 'PaymentInfoAdded') emit('AddPaymentInfo', { value, currency, ...(coupon ? { coupon } : {}) });
      else if (evName === 'Purchase' || type === 'orderSuccess') {
        const resp = asRecord(d.response);
        const order_id = String(
          cart.merchant_order_id ?? cart.order_name ?? cart._id ??
          resp.merchant_order_id ?? resp.order_name ?? resp.orderId ?? '',
        );
        emit('Purchase', { ...base, order_id });
      }
    });
  }

  function activateObserve(): void {
    if (busAttached) return;
    if (cfg.debug) console.log(LOG, 'FALLBACK: observe mode (URL + fetch + GoKwik postMessage)');

    // SPA navigation
    let lastHref = location.href;
    const onNav = (): void => { if (location.href !== lastHref) { lastHref = location.href; fireForCurrentPage(); } };
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    // biome-ignore lint/suspicious/noExplicitAny: patching native API
    (history as any).pushState = function (...args: Parameters<typeof history.pushState>) { origPush(...args); onNav(); };
    // biome-ignore lint/suspicious/noExplicitAny: patching native API
    (history as any).replaceState = function (...args: Parameters<typeof history.replaceState>) { origReplace(...args); onNav(); };
    window.addEventListener('popstate', onNav);

    // AddToCart via fetch interception (genuine add endpoint only)
    const _fetch = window.fetch.bind(window);
    // biome-ignore lint/suspicious/noExplicitAny: patching native API
    (window as any).fetch = function (...args: Parameters<typeof fetch>): Promise<Response> {
      const [resource] = args;
      const url = typeof resource === 'string' ? resource : (resource as Request).url ?? '';
      const isCartAdd = /\/(api\/v1\/cart\/add|cart\/add)(\b|\/|$|\?)/i.test(url);
      const promise = _fetch(...args);
      if (isCartAdd) {
        promise.then((res) => { if (res.ok) fireByName('AddToCart', { currency: 'INR', value: 0 }); }).catch(() => {/* ignore */});
      }
      return promise;
    };

    // Fire the event for the page we're on now
    fireForCurrentPage();
  }

  // ─── Bus supplement: Search via URL routing ───────────────────────────────
  // The OpenStore bus emits PageView/ViewContent/AddToCart/etc. but NOT Search.
  // So when the bus is attached we still wire a nav listener that emits ONLY
  // Search on collection/search pages (PageView/ViewContent stay with the bus —
  // firing them here would double-count). In fallback mode (no bus) activateObserve
  // already covers Search, so this is attached only on a successful bus attach.
  function attachSearchRouting(): void {
    const fireSearchForPath = (): void => {
      const ev = getPageEvent();
      if (ev.name === 'Search') fireByName('Search', ev.props);
    };
    let lastHref = location.href;
    const onNav = (): void => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        fireSearchForPath();
      }
    };
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    // biome-ignore lint/suspicious/noExplicitAny: patching native API
    (history as any).pushState = function (...args: Parameters<typeof history.pushState>) { origPush(...args); onNav(); };
    // biome-ignore lint/suspicious/noExplicitAny: patching native API
    (history as any).replaceState = function (...args: Parameters<typeof history.replaceState>) { origReplace(...args); onNav(); };
    window.addEventListener('popstate', onNav);
    fireSearchForPath(); // current page
  }

  // ─── LAYER 3 (MANUAL): escape hatch for storefronts to fire anything ──────
  // Optional 1–2 line addition a merchant can paste, e.g. on their order page:
  //   window.__triggerPixelEvent__('Purchase', { value: 1299, currency:'INR',
  //     content_ids:['sku1'], order_id:'ORD-1' });
  window.__triggerPixelEvent__ = function (eventName: string, properties: Record<string, unknown> = {}): void {
    emit(resolveMeta(eventName), properties);
  };

  // ─── Init ─────────────────────────────────────────────────────────────────
  loadFbq();
  const fbq = window.fbq;
  if (fbq) {
    fbq.disablePushState = true;
    fbq.allowDuplicatePageViews = true;
    for (const id of PIXEL_IDS) fbq('init', id);
  }

  // KwikPass auth (CompleteRegistration) is never published on the bus, so
  // always listen for the GoKwik/KwikPass postMessages. The commerce funnel
  // inside self-gates to fallback-only (busAttached check) to avoid double-count.
  attachGokwikMessages();

  // Prefer the bus. It may not exist yet when we load (afterInteractive), so
  // poll briefly; if it never appears, fall back to observe. Whichever wins,
  // PageView is covered (bus backfills it; observe fires it on activation).
  if (!tryAttachBus()) {
    let tries = 0;
    const iv = setInterval(() => {
      tries += 1;
      if (tryAttachBus()) { clearInterval(iv); return; }
      if (tries >= 5) { clearInterval(iv); activateObserve(); } // ~5 × 200ms = 1s
    }, 200);
  }

  if (cfg.debug) console.log(LOG, 'initialized, merchantId=', cfg.merchantId, 'pixels=', PIXEL_IDS);
})();
