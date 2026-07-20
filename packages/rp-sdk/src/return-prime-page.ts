import { fetchEnabled } from './enabled-check';
import { scriptConfig } from './loader';

/**
 * Fills a merchant's own chrome-wrapped returns page (e.g. /apps/return_prime) — the page
 * itself just renders its header/footer/chrome around a `[data-rp-mount]` placeholder; this
 * owns the enable/disable check, the portal URL (from order/email/orderId in this page's own
 * query string), and the iframe, so the page's own code needs zero RP config or logic.
 */
/** Waits for `[data-rp-mount]` to exist, since this `async` module script can execute before
 *  the page-builder's client-only widgets have hydrated and inserted it. Gives up after ~5s. */
function waitForMount(): Promise<HTMLElement | null> {
  const existing = document.querySelector<HTMLElement>('[data-rp-mount]');
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, 5000);

    const observer = new MutationObserver(() => {
      const mount = document.querySelector<HTMLElement>('[data-rp-mount]');
      if (mount) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve(mount);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/** How long to wait for the portal iframe's `load` event before treating the navigation as
 *  failed. Only catches "the iframe's own load never completed" — a cross-origin sub-resource
 *  failure inside an iframe that itself reports `load` (e.g. a 403 on the portal's own JS
 *  bundle) is invisible from here and out of scope. */
const IFRAME_LOAD_TIMEOUT_MS = 8000;

function renderMessage(mount: HTMLElement, message: string): void {
  mount.innerHTML = `
    <div style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem">
      <h1 style="font-size:1.5rem;margin-bottom:0.5rem">Returns &amp; Exchanges</h1>
      <p style="color:#666;max-width:28rem">${message}</p>
    </div>
  `;
}

const UNAVAILABLE_MESSAGE =
  'Returns and exchanges are currently unavailable. Please contact our support team for help with your order.';
const FALLBACK_MESSAGE =
  'Returns & Exchanges is temporarily unavailable. Please contact our support team for help with your order.';

function createPortalIframe(portalUrl: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = portalUrl;
  iframe.title = 'Returns & Exchanges';
  // local-network-access: required since Chrome 142 — without it, the iframe (a
  // cross-origin subframe) can't reach RP even if the user grants the top-level
  // page's own Local Network Access permission prompt; the grant doesn't delegate
  // to iframes without this attribute.
  iframe.setAttribute('allow', 'clipboard-write; local-network-access');
  iframe.style.cssText = 'width:100%;min-height:85vh;border:0;display:block';
  return iframe;
}

/** Inserts a fresh iframe pointed at `portalUrl` into `mount` and races its `load`/`error`
 *  events against `IFRAME_LOAD_TIMEOUT_MS`. Resolves `true` on success, `false` on failure
 *  (in which case the fallback message has already been rendered in place of the iframe). */
function mountPortalIframe(mount: HTMLElement, portalUrl: string): Promise<boolean> {
  const iframe = createPortalIframe(portalUrl);
  mount.replaceChildren(iframe);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (failed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      iframe.removeEventListener('load', onLoad);
      iframe.removeEventListener('error', onError);
      if (failed) renderMessage(mount, FALLBACK_MESSAGE);
      resolve(!failed);
    };
    const onLoad = () => finish(false);
    const onError = () => finish(true);
    const timeout = setTimeout(() => finish(true), IFRAME_LOAD_TIMEOUT_MS);
    iframe.addEventListener('load', onLoad);
    iframe.addEventListener('error', onError);
  });
}

/** Watches `mount` for its content being wiped out from under the SDK after it was already
 *  populated (e.g. a Next.js hydration correction reconciling `[data-rp-mount]` back to its
 *  own empty virtual-DOM version, discarding the iframe we just inserted). This is a distinct
 *  concern from `waitForMount()`'s observer, which only watches for the mount *appearing*.
 *  On detecting a wipe, re-applies whatever was showing before: a fresh iframe (re-running the
 *  same load/error/timeout race) if the portal was up, or the same message otherwise. */
function watchForExternalWipe(mount: HTMLElement, restore: () => void): void {
  let selfWriting = false;

  const observer = new MutationObserver(() => {
    if (selfWriting) return;
    if (mount.children.length > 0) return; // still has content — not a wipe.

    selfWriting = true;
    try {
      restore();
    } finally {
      selfWriting = false;
    }
  });
  observer.observe(mount, { childList: true });
}

export async function syncReturnPrimePage(): Promise<void> {
  if (location.pathname.replace(/\/$/, '') !== scriptConfig.returnPrimePath.replace(/\/$/, '')) {
    return;
  }
  const mount = await waitForMount();
  if (!mount) return;

  const { adapterUrl, store } = scriptConfig;
  if (!adapterUrl || !store) {
    renderMessage(mount, FALLBACK_MESSAGE);
    watchForExternalWipe(mount, () => renderMessage(mount, FALLBACK_MESSAGE));
    return;
  }

  const enabled = await fetchEnabled(adapterUrl, store);
  if (!enabled) {
    renderMessage(mount, UNAVAILABLE_MESSAGE);
    watchForExternalWipe(mount, () => renderMessage(mount, UNAVAILABLE_MESSAGE));
    return;
  }

  const pageParams = new URLSearchParams(location.search);
  const params = new URLSearchParams({ shop: store });
  for (const key of ['order', 'email', 'orderId']) {
    const value = pageParams.get(key);
    if (value) params.set(key, value);
  }
  const portalUrl = `${adapterUrl.replace(/\/$/, '')}/rp/customer/portal?${params.toString()}`;

  await mountPortalIframe(mount, portalUrl);
  watchForExternalWipe(mount, () => {
    void mountPortalIframe(mount, portalUrl);
  });
}
