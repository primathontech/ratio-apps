/*!
 * ratio-app — MoEngage storefront pixel (TypeScript source)
 *
 * Compiled to `static/moengage-pixel.js` by
 *   `pnpm --filter @ratio-app/backend pixel:build:all`.
 * The backend serves the compiled JS as-is, prepending a one-line config prelude:
 *   window.__MOENGAGE_RATIO_CONFIG__ = { appId, cluster, apiHost, debug, merchantId, eventNameMap, swPath };
 *
 * Then the IIFE below:
 *   1. Reads that config (silently no-ops if missing)
 *   2. Loads MoEngage Web SDK via its official async stub-queue snippet
 *   3. Registers with window.__OPEN_STORE_PIXEL_RUNTIME__ (or queues for it)
 *   4. Subscribes to enabled OpenStore events, maps attrs, forwards to MoEngage
 *   5. Syncs identity (anon → identified, A→B, identified → anon)
 *
 * Compile target: ES2015 / no module wrapper. The file is a script (not a module).
 */

interface MoEngageRatioConfig {
  appId: string;
  cluster: string;
  apiHost: string;
  debug: boolean;
  merchantId: string;
  eventNameMap: Record<string, string>;
  swPath: string;
}

interface PixelEvent {
  event_type: string;
  properties?: Record<string, unknown>;
  metadata?: {
    session_id?: string;
    event_id?: string;
    user_data?: {
      external_id?: string;
      email?: string;
      phone?: string;
      first_name?: string;
      last_name?: string;
    };
    page?: { url?: string; path?: string; title?: string; referrer?: string };
  };
}

interface PixelAnalytics {
  subscribe(eventType: string, handler: (event: PixelEvent) => void): void;
}

interface MoEngageInstance {
  track_event(name: string, attrs: Record<string, unknown>): void;
  add_unique_user_id(id: string): void;
  add_email(email: string): void;
  add_first_name(name: string): void;
  add_last_name(name: string): void;
  add_mobile(phone: string): void;
  destroy_session(): void;
}

type MoEngageLoader = (cfg: Record<string, unknown>) => MoEngageInstance;

interface PixelRegistration {
  name: string;
  register(analytics: PixelAnalytics): void;
}

interface PixelRuntime {
  register(reg: PixelRegistration): void;
}

// Augment the global Window — this file is a script (no exports), so
// top-level interface declarations merge with lib.dom.d.ts.
// biome-ignore lint/correctness/noUnusedVariables: declaration merge with lib.dom.d.ts global Window
interface Window {
  __MOENGAGE_RATIO_CONFIG__?: MoEngageRatioConfig;
  __OPEN_STORE_PIXEL_RUNTIME__?: PixelRuntime;
  __OPEN_STORE_PIXEL_PENDING__?: PixelRegistration[];
  Moengage?: MoEngageInstance;
  moe?: MoEngageLoader;
}

(() => {
  const LOG = '[MoEngageRatioPixel]';

  const config = window.__MOENGAGE_RATIO_CONFIG__;
  if (!config?.appId || !config.cluster) {
    console.warn(LOG, 'config missing or incomplete — pixel did not initialize.', config);
    return;
  }
  const cfg: MoEngageRatioConfig = config;

  // ─── Attribute mapping (OpenStore properties → MoEngage flat attrs) ─────────
  function mapAttributes(event: PixelEvent): Record<string, unknown> {
    const p = event.properties ?? {};
    const m = event.metadata ?? {};
    const page = m.page ?? {};
    const attrs: Record<string, unknown> = {
      session_id: m.session_id,
      event_id: m.event_id,
      page_url: page.url,
      page_path: page.path,
      page_title: page.title,
      referrer: page.referrer,
    };
    if (p.content_ids !== undefined) attrs.product_ids = p.content_ids;
    if (p.content_type !== undefined) attrs.content_type = p.content_type;
    if (p.value !== undefined) attrs.value = p.value;
    if (p.currency !== undefined) attrs.currency = p.currency;
    if (p.num_items !== undefined) attrs.quantity = p.num_items;
    if (p.contents !== undefined) attrs.items = p.contents;
    if (p.order_id !== undefined) attrs.order_id = p.order_id;
    if (p.search_string !== undefined) attrs.search_term = p.search_string;
    if (p.shipping_method !== undefined) attrs.shipping_method = p.shipping_method;
    if (p.payment_method !== undefined) attrs.payment_method = p.payment_method;
    if (p.lead_source !== undefined) attrs.lead_source = p.lead_source;
    if (p.contact_method !== undefined) attrs.contact_method = p.contact_method;
    if (p.subscription_type !== undefined) attrs.subscription_type = p.subscription_type;
    if (p.method !== undefined) attrs.method = p.method;
    if (event.event_type === 'Purchase') {
      // MoEngage commerce reports key off both `revenue` and `Amount`.
      attrs.revenue = p.value;
      attrs.Amount = p.value;
    }
    return attrs;
  }

  // ─── Identity sync: 3-state machine ─────────────────────────────────────────
  let lastDistinctId: string | null = null;
  let lastSig: string | null = null;

  function applyIdentity(
    moe: MoEngageInstance,
    distinctId: string,
    u: NonNullable<PixelEvent['metadata']>['user_data'],
  ): void {
    moe.add_unique_user_id(distinctId);
    if (u?.email) moe.add_email(u.email);
    if (u?.first_name) moe.add_first_name(u.first_name);
    if (u?.last_name) moe.add_last_name(u.last_name);
    if (u?.phone) moe.add_mobile(u.phone);
  }

  function syncIdentity(event: PixelEvent): void {
    const moe = window.Moengage;
    if (!moe) return;
    const u = event.metadata?.user_data ?? null;
    const newDistinctId = u?.external_id ?? u?.email ?? null;

    if (lastDistinctId && !newDistinctId) {
      try {
        moe.destroy_session();
      } catch (e) {
        console.error(LOG, 'destroy_session failed:', e);
      }
      if (cfg.debug) console.log(LOG, 'destroy_session (logout)');
      lastDistinctId = null;
      lastSig = null;
      return;
    }
    if (!newDistinctId || !u) return;

    if (lastDistinctId && lastDistinctId !== newDistinctId) {
      try {
        moe.destroy_session();
      } catch (e) {
        console.error(LOG, 'destroy_session failed:', e);
      }
      if (cfg.debug)
        console.log(LOG, 'destroy_session (user switch:', lastDistinctId, '→', newDistinctId, ')');
      lastSig = null;
    }

    const sig = `${newDistinctId}|${u.phone ?? ''}|${u.first_name ?? ''}|${u.last_name ?? ''}|${u.email ?? ''}`;
    if (sig === lastSig) return;
    lastSig = sig;
    lastDistinctId = newDistinctId;

    try {
      applyIdentity(moe, newDistinctId, u);
      if (cfg.debug) console.log(LOG, 'identified:', newDistinctId);
    } catch (e) {
      console.error(LOG, 'identify failed:', e);
    }
  }

  // ─── MoEngage Web SDK loader (official async stub-queue snippet) ────────────
  // Vendor code — narrow typing concessions made with explicit assertions.
  // The inner stub functions rely on `arguments`, so they must remain function
  // expressions (arrow functions don't bind their own `arguments`).
  function loadMoEngage(): void {
    if (window.Moengage) return;
    // biome-ignore-start lint/suspicious/noExplicitAny: vendor snippet uses dynamic property access
    // biome-ignore-start lint/complexity/noArguments: vendor snippet predates rest params
    // biome-ignore-start lint/complexity/useArrowFunction: inner stubs must use `arguments`
    const w = window as any;
    (function (i: any, s: any, o: any, g: any, r: any) {
      i.moengage_object = r;
      const q: any = {};
      const f = function (c: any) {
        return function () {
          i.moengage_q = i.moengage_q || [];
          i.moengage_q.push({ a: arguments, f: c });
        };
      };
      const h = [
        'track_event',
        'add_user_attribute',
        'add_first_name',
        'add_last_name',
        'add_email',
        'add_mobile',
        'add_user_name',
        'add_gender',
        'add_birthday',
        'destroy_session',
        'add_unique_user_id',
        'update_unique_user_id',
        'moe_events',
        'call_web_push',
        'track',
        'location_type_attribute',
      ];
      for (let k = 0; k < h.length; k++) q[h[k]] = f(h[k]);
      const a = s.createElement(o);
      const m = s.getElementsByTagName(o)[0];
      a.async = 1;
      a.src = g;
      m.parentNode.insertBefore(a, m);
      i.moe =
        i.moe ||
        function () {
          q.name = arguments[0] ? arguments[0].app_id : '';
          return q;
        };
      q.name = '';
      i[r] = q;
    })(
      w,
      document,
      'script',
      'https://cdn.moengage.com/webpush/moe_webSdk.min.latest.js',
      'Moengage',
    );
    // biome-ignore-end lint/complexity/useArrowFunction: inner stubs must use `arguments`
    // biome-ignore-end lint/complexity/noArguments: vendor snippet predates rest params
    // biome-ignore-end lint/suspicious/noExplicitAny: vendor snippet uses dynamic property access
  }

  // ─── Registration with OpenStore PixelRuntime ───────────────────────────────
  const registration: PixelRegistration = {
    name: 'moengage-ratio',
    register: (analytics) => {
      console.log(LOG, 'registering for merchant', cfg.merchantId, 'cluster:', cfg.cluster);
      loadMoEngage();
      try {
        const initCfg: Record<string, unknown> = {
          app_id: cfg.appId,
          cluster: cfg.cluster,
          debug_logs: cfg.debug ? 1 : 0,
        };
        if (cfg.swPath) initCfg.swPath = cfg.swPath;
        const moe = window.moe?.(initCfg);
        if (moe) window.Moengage = moe;
      } catch (e) {
        console.error(LOG, 'moe.init failed:', e);
      }
      const eventNameMap = cfg.eventNameMap ?? {};
      Object.keys(eventNameMap).forEach((osName) => {
        analytics.subscribe(osName, (event) => {
          try {
            syncIdentity(event);
            const moeName = eventNameMap[osName];
            if (!moeName) return;
            const attrs = mapAttributes(event);
            const moe = window.Moengage;
            if (moe && typeof moe.track_event === 'function') {
              moe.track_event(moeName, attrs);
            } else {
              console.warn(LOG, 'MoEngage handle not ready for', moeName);
            }
            if (cfg.debug) console.log(LOG, '→', moeName, attrs);
          } catch (e) {
            console.error(LOG, osName, 'failed:', e);
          }
        });
      });
    },
  };

  if (window.__OPEN_STORE_PIXEL_RUNTIME__) {
    window.__OPEN_STORE_PIXEL_RUNTIME__.register(registration);
  } else {
    window.__OPEN_STORE_PIXEL_PENDING__ = window.__OPEN_STORE_PIXEL_PENDING__ ?? [];
    window.__OPEN_STORE_PIXEL_PENDING__.push(registration);
  }
})();
