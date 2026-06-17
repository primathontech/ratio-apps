/*!
 * ratio-app — Template storefront pixel (TypeScript source)
 *
 * Compiled to `static/_template-pixel.js` by
 *   `pnpm --filter @ratio-app/backend pixel:build:all`.
 * The backend serves the compiled JS as-is, prepending a one-line config prelude:
 *   window.__TEMPLATE_RATIO_CONFIG__ = { apiKey, host, debug, merchantId, eventNameMap };
 *
 * Then the IIFE below:
 *   1. Reads that config (silently no-ops if missing)
 *   2. Loads Template Web SDK via the official async stub-queue snippet
 *   3. Registers with window.__OPEN_STORE_PIXEL_RUNTIME__ (or queues for it)
 *   4. Subscribes to enabled OpenStore events, maps attrs, forwards to Template
 *   5. Syncs identity (anon → identified, A→B, identified → anon)
 *
 * Compile target: ES2015 / no module wrapper. The file is a script (not a module).
 */

interface TemplateRatioConfig {
  apiKey: string;
  host: string;
  debug: boolean;
  merchantId: string;
  eventNameMap: Record<string, string>;
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

interface TemplateJS {
  __loaded?: boolean;
  init(apiKey: string, options: Record<string, unknown>): void;
  capture(event: string, properties: Record<string, unknown>): void;
  identify(distinctId: string, props?: Record<string, unknown>): void;
  reset(): void;
}

interface PixelRegistration {
  name: string;
  register(analytics: PixelAnalytics): void;
}

interface PixelRuntime {
  register(reg: PixelRegistration): void;
}

// Augment the global Window — this file is a script (no exports), so
// top-level interface declarations merge with lib.dom.d.ts.
interface Window {
  __TEMPLATE_RATIO_CONFIG__?: TemplateRatioConfig;
  __OPEN_STORE_PIXEL_RUNTIME__?: PixelRuntime;
  __OPEN_STORE_PIXEL_PENDING__?: PixelRegistration[];
  _template?: TemplateJS;
}

(() => {
  const LOG = '[TemplateRatioPixel]';

  const config = window.__TEMPLATE_RATIO_CONFIG__;
  if (!config?.apiKey || !config.host) {
    console.warn(LOG, 'config missing or incomplete — pixel did not initialize.', config);
    return;
  }
  const cfg: TemplateRatioConfig = config;

  // ─── Attribute mapping (OpenStore properties → Template snake_case) ──────────
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
    if (event.event_type === 'Purchase') attrs.revenue = p.value;
    return attrs;
  }

  // ─── Identity sync: 3-state machine ─────────────────────────────────────────
  let lastDistinctId: string | null = null;
  let lastSig: string | null = null;

  function syncIdentity(event: PixelEvent): void {
    const ph = window._template;
    if (!ph || typeof ph.identify !== 'function') return;
    const u = event.metadata?.user_data ?? null;
    const newDistinctId = u?.external_id ?? u?.email ?? null;

    if (lastDistinctId && !newDistinctId) {
      try {
        ph.reset();
      } catch (e) {
        console.error(LOG, 'reset failed:', e);
      }
      if (cfg.debug) console.log(LOG, 'reset (logout)');
      lastDistinctId = null;
      lastSig = null;
      return;
    }
    if (!newDistinctId || !u) return;

    if (lastDistinctId && lastDistinctId !== newDistinctId) {
      try {
        ph.reset();
      } catch (e) {
        console.error(LOG, 'reset failed:', e);
      }
      if (cfg.debug)
        console.log(LOG, 'reset (user switch:', lastDistinctId, '→', newDistinctId, ')');
      lastSig = null;
    }

    const sig = `${newDistinctId}|${u.phone ?? ''}|${u.first_name ?? ''}|${u.last_name ?? ''}`;
    if (sig === lastSig) return;
    lastSig = sig;
    lastDistinctId = newDistinctId;

    try {
      ph.identify(newDistinctId, {
        email: u.email,
        phone: u.phone ?? undefined,
        first_name: u.first_name ?? undefined,
        last_name: u.last_name ?? undefined,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ') || undefined,
      });
      if (cfg.debug) console.log(LOG, 'identified:', newDistinctId);
    } catch (e) {
      console.error(LOG, 'identify failed:', e);
    }
  }

  // ─── Template Web SDK loader (official async stub-queue snippet) ─────────────
  // Vendor code — narrow typing concessions made with explicit assertions.
  function loadTemplate(): void {
    if (window._template?.__loaded) return;
    const t = document;
    // biome-ignore-start lint/suspicious/noExplicitAny: vendor snippet uses dynamic property access
    // biome-ignore-start lint/complexity/noArguments: vendor snippet predates rest params
    const e = (window._template ?? ([] as unknown)) as any;
    if (e.__SV) return;
    (window as Window & { _template?: unknown })._template = e;
    e._i = [];
    e.init = (i: string, s: { api_host: string }, a?: string) => {
      function g(target: any, key: string): void {
        const parts = key.split('.');
        let t2: any = target;
        let k = key;
        if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
          t2 = target[parts[0]];
          k = parts[1];
        }
        t2[k] = function (this: unknown) {
          t2.push([k].concat(Array.prototype.slice.call(arguments, 0)));
        };
      }
      const p = t.createElement('script');
      p.type = 'text/javascript';
      p.crossOrigin = 'anonymous';
      p.async = true;
      p.src = `${s.api_host.replace('.i._template.com', '-assets.i._template.com')}/static/array.js`;
      const r = t.getElementsByTagName('script')[0];
      r?.parentNode?.insertBefore(p, r);
      let u: any = e;
      if (a !== undefined) {
        u = e[a] = [];
      } else {
        a = '_template';
      }
      u.people = u.people || [];
      u.toString = (withStub?: number) => {
        let out = '_template';
        if (a !== '_template') out += `.${a}`;
        if (!withStub) out += ' (stub)';
        return out;
      };
      u.people.toString = () => `${u.toString(1)}.people (stub)`;
      const fns =
        'init capture register register_once unregister identify alias people set people.set_once group reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags opt_out_capturing has_opted_out_capturing opt_in_capturing clear_opt_in_out_capturing debug'.split(
          ' ',
        );
      for (let n = 0; n < fns.length; n++) {
        const fn = fns[n];
        if (fn) g(u, fn);
      }
      e._i.push([i, s, a]);
    };
    e.__SV = 1;
    // biome-ignore-end lint/complexity/noArguments: vendor snippet predates rest params
    // biome-ignore-end lint/suspicious/noExplicitAny: vendor snippet uses dynamic property access
  }

  // ─── Registration with OpenStore PixelRuntime ───────────────────────────────
  const registration: PixelRegistration = {
    name: '_template-ratio',
    register: (analytics) => {
      console.log(LOG, 'registering for merchant', cfg.merchantId, 'host:', cfg.host);
      loadTemplate();
      try {
        window._template?.init(cfg.apiKey, {
          api_host: cfg.host,
          capture_pageview: false,
          capture_pageleave: false,
          autocapture: false,
          loaded: () => {
            if (cfg.debug) console.log(LOG, 'Template SDK loaded');
          },
        });
      } catch (e) {
        console.error(LOG, '_template.init failed:', e);
      }
      const eventNameMap = cfg.eventNameMap ?? {};
      Object.keys(eventNameMap).forEach((osName) => {
        analytics.subscribe(osName, (event) => {
          try {
            syncIdentity(event);
            const phName = eventNameMap[osName];
            if (!phName) return;
            const attrs = mapAttributes(event);
            const ph = window._template;
            if (ph && typeof ph.capture === 'function') {
              ph.capture(phName, attrs);
            } else {
              console.warn(LOG, 'Template handle not ready for', phName);
            }
            if (cfg.debug) console.log(LOG, '→', phName, attrs);
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
