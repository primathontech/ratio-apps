/*!
 * google-ratio-app — Google combined storefront pixel (GA4 + Google Ads).
 *
 * Compiled to `static/google-pixel.js` by
 *   `pnpm --filter @ratio-app/backend pixel:build:all`
 * and served per-merchant by GoogleSdkService at /google/sdk/<merchantId>.js,
 * with a one-line config prelude prepended (see GoogleSdkService.buildPrelude):
 *   window.__GOOGLE_RATIO_CONFIG__ = {
 *     merchantId: "...",
 *     ga4: { measurementId: "G-XXXX", isolated: false } | null,
 *     ads: { conversionId: "AW-123", conversionLabel?: "lbl",
 *            events?: { Purchase: "lbl", ... } } | null,
 *     enhancedConversions: true | false
 *   }
 *
 * Isolation contract: GA4 registers with isolated:false so events fan out to
 * every gtag destination (enabling Ads remarketing / enhanced conversions);
 * Google Ads owns its own conversions via `send_to: conversionId/label`.
 *
 * The shared pixel-runtime contract types (`PixelEvent`, `PixelAnalytics`,
 * `PixelRegistration`, `PixelRuntime`) are declared once in `_template-pixel.ts`
 * — every pixel source compiles into one global scope, so we REUSE them here.
 */

interface Ga4Config {
  measurementId?: string;
  isolated?: boolean;
}

interface AdsConfig {
  conversionId?: string;
  conversionLabel?: string;
  events?: Record<string, string>;
}

interface GoogleRatioConfig {
  merchantId?: string;
  ga4?: Ga4Config | null;
  ads?: AdsConfig | null;
  enhancedConversions?: boolean;
}

type Gtag = (...args: unknown[]) => void;

/** Storefront event properties — every field optional/best-effort. */
interface GoogleEventProps {
  content_ids?: string[];
  content_name?: string;
  contents?: Array<{ id?: string; name?: string; item_price?: number; quantity?: number }>;
  value?: number | string;
  currency?: string;
  order_id?: string | number;
  tax?: number;
  shipping?: number;
  coupon?: string;
  search_string?: string;
  shipping_method?: string;
  payment_method?: string;
  method?: string;
}

// Google's pixel events carry first-party `user_data` at the top level (used for
// Ads enhanced conversions) — a superset of the shared PixelEvent shape.
type GoogleEvent = PixelEvent & { user_data?: Record<string, unknown> };

// biome-ignore lint/correctness/noUnusedVariables: Window augmentation consumed via window.* in the IIFE
interface Window {
  __GOOGLE_RATIO_CONFIG__?: GoogleRatioConfig;
  dataLayer?: unknown[];
  gtag?: Gtag;
}

(() => {
  const CFG: GoogleRatioConfig = window.__GOOGLE_RATIO_CONFIG__ || {};

  /** Read the (loosely-typed) properties of a runtime event as Google props. */
  function props(event: PixelEvent): GoogleEventProps {
    return (event.properties || {}) as GoogleEventProps;
  }

  function ensureGtag(id: string): Gtag {
    window.dataLayer = window.dataLayer || [];
    if (!window.gtag) {
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
      document.head.appendChild(s);
      window.gtag = function gtag(): void {
        // biome-ignore lint/complexity/noArguments: gtag's documented shim pushes `arguments`
        (window.dataLayer as unknown[]).push(arguments);
      };
      window.gtag('js', new Date());
    }
    return window.gtag;
  }

  function mapItems(
    contents: GoogleEventProps['contents'],
    fallbackName?: string,
  ): Array<Record<string, unknown>> {
    return (contents || []).map((c) => ({
      item_id: c.id,
      item_name: c.name || fallbackName || '',
      price: c.item_price,
      quantity: c.quantity,
    }));
  }

  // ─── GA4 adapter ───────────────────────────────────────────────────────────
  // Maps the PascalCase storefront events to GA4 snake_case event names.
  const ga4Registration: PixelRegistration = {
    name: 'ga4',
    register(analytics: PixelAnalytics): void {
      const c: Ga4Config = CFG.ga4 || {};
      const mid = c.measurementId;
      if (!mid) return;
      const gtag = ensureGtag(mid);
      gtag('config', mid, { send_page_view: true });

      // isolated:false (default) → no send_to, events fan out to all destinations.
      function iso(payload: Record<string, unknown>): Record<string, unknown> {
        return c.isolated ? Object.assign({ send_to: mid }, payload) : payload;
      }
      function on(name: string, fn: (event: PixelEvent) => void): void {
        analytics.subscribe(name, (event) => {
          try {
            fn(event);
          } catch (_e) {
            /* swallow — one bad event must not break sibling subscriptions */
          }
        });
      }

      on('ViewContent', (e) => {
        const p = props(e);
        gtag(
          'event',
          'view_item',
          iso({
            items: [
              {
                item_id: (p.content_ids || [])[0],
                item_name: p.content_name || '',
                price: p.value,
              },
            ],
            currency: p.currency || 'INR',
            value: p.value,
          }),
        );
      });
      on('AddToCart', (e) => {
        const p = props(e);
        gtag(
          'event',
          'add_to_cart',
          iso({
            items: mapItems(p.contents, p.content_name),
            currency: p.currency || 'INR',
            value: p.value,
          }),
        );
      });
      on('InitiateCheckout', (e) => {
        const p = props(e);
        gtag(
          'event',
          'begin_checkout',
          iso({
            items: mapItems(p.contents),
            currency: p.currency || 'INR',
            value: p.value,
            coupon: p.coupon || undefined,
          }),
        );
      });
      on('AddShippingInfo', (e) => {
        const p = props(e);
        gtag(
          'event',
          'add_shipping_info',
          iso({ shipping_tier: p.shipping_method, currency: p.currency || 'INR', value: p.value }),
        );
      });
      on('AddPaymentInfo', (e) => {
        const p = props(e);
        gtag(
          'event',
          'add_payment_info',
          iso({ payment_type: p.payment_method, currency: p.currency || 'INR', value: p.value }),
        );
      });
      on('Purchase', (e) => {
        const p = props(e);
        gtag(
          'event',
          'purchase',
          iso({
            transaction_id: p.order_id,
            value: p.value,
            currency: p.currency || 'INR',
            tax: p.tax,
            shipping: p.shipping,
            coupon: p.coupon || undefined,
            items: mapItems(p.contents),
          }),
        );
      });
      on('Search', (e) => {
        gtag('event', 'search', iso({ search_term: props(e).search_string }));
      });
      on('AddToWishlist', (e) => {
        const p = props(e);
        gtag(
          'event',
          'add_to_wishlist',
          iso({
            items: [
              {
                item_id: (p.content_ids || [])[0],
                item_name: p.content_name || '',
                price: p.value,
              },
            ],
            currency: p.currency || 'INR',
            value: p.value,
          }),
        );
      });
      on('Lead', (e) => {
        const p = props(e);
        gtag('event', 'generate_lead', iso({ value: p.value, currency: p.currency || 'INR' }));
      });
      on('CompleteRegistration', (e) => {
        gtag('event', 'sign_up', iso({ method: props(e).method }));
      });
      on('Contact', () => {
        gtag('event', 'contact', iso({}));
      });
      on('Subscribe', () => {
        gtag('event', 'subscribe', iso({}));
      });
      // PageView handled by GA4 Enhanced Measurement + send_page_view:true.
    },
  };

  // ─── Google Ads adapter ──────────────────────────────────────────────────
  // Fires conversions for the labelled events; attaches hashed first-party
  // user_data when enhanced conversions are enabled.
  const adsRegistration: PixelRegistration = {
    name: 'google-ads',
    register(analytics: PixelAnalytics): void {
      const c: AdsConfig = CFG.ads || {};
      const convId = c.conversionId;
      if (!convId) return;
      const labelMap: Record<string, string> = c.events || {};
      if (c.conversionLabel && !labelMap.Purchase) labelMap.Purchase = c.conversionLabel;
      const gtag = ensureGtag(convId);
      gtag('config', convId, { send_page_view: false });
      const enhanced = !!CFG.enhancedConversions;

      Object.keys(labelMap).forEach((eventName) => {
        const sendTo = `${convId}/${labelMap[eventName]}`;
        analytics.subscribe(eventName, (event) => {
          try {
            const p = props(event);
            const userData = (event as GoogleEvent).user_data;
            // Enhanced conversions: attach first-party data so Google can match.
            if (enhanced && userData) {
              gtag('set', 'user_data', userData);
            }
            const payload: Record<string, unknown> = {
              send_to: sendTo,
              currency: p.currency || 'INR',
            };
            if (p.value !== undefined && p.value !== null && Number.isFinite(Number(p.value))) {
              payload.value = Number(p.value);
            }
            if (eventName === 'Purchase' && p.order_id) {
              payload.transaction_id = String(p.order_id);
            }
            gtag('event', 'conversion', payload);
          } catch (_e) {
            /* swallow */
          }
        });
      });
    },
  };

  // ─── Register with the storefront pixel runtime ─────────────────────────────
  // One app = one pixel. `google-ratio` wires whichever of GA4 / Google Ads is
  // configured (both share window.gtag).
  const googleRatioRegistration: PixelRegistration = {
    name: 'google-ratio',
    register(analytics: PixelAnalytics): void {
      ga4Registration.register(analytics); // no-ops if CFG.ga4 absent
      adsRegistration.register(analytics); // no-ops if CFG.ads absent
    },
  };

  const shouldRegister = !!(CFG.ga4?.measurementId || CFG.ads?.conversionId);
  if (shouldRegister) {
    if (window.__OPEN_STORE_PIXEL_RUNTIME__) {
      window.__OPEN_STORE_PIXEL_RUNTIME__.register(googleRatioRegistration);
    } else {
      // Runtime not ready — queue so it picks us up on init.
      window.__OPEN_STORE_PIXEL_PENDING__ = window.__OPEN_STORE_PIXEL_PENDING__ || [];
      window.__OPEN_STORE_PIXEL_PENDING__.push(googleRatioRegistration);
    }
  }
})();
