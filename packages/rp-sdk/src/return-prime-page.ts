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

/** Watches for the mount's content being wiped out from under the SDK after it was already
 *  populated. This covers two distinct ways a Next.js hydration correction can discard our
 *  work: (1) `[data-rp-mount]`'s children get cleared but the element itself is reused, or
 *  (2) the whole element gets discarded and replaced with a fresh node from React's own
 *  virtual DOM (a different node identity entirely — observing the old node's own childList
 *  would never fire for this case, since the mutation happens on its *parent*). Observing
 *  `document.body` with `subtree: true` and re-querying `[data-rp-mount]` fresh on every
 *  mutation handles both: a same-node wipe still resolves to the same element with 0 children;
 *  a full replacement resolves to the new element, which also starts with 0 children.
 *  This is a distinct concern from `waitForMount()`'s observer, which only watches for the
 *  mount *appearing* for the first time. On detecting a wipe, re-applies whatever was showing
 *  before: a fresh iframe (re-running the same load/error/timeout race) if the portal was up,
 *  or the same message otherwise — into whichever element is actually in the document now. */
// Module-scoped so a second `syncReturnPrimePage()` run (there's only ever one per real page
// load in production, but tests re-invoke it repeatedly against a reused module instance)
// disconnects the previous observer instead of piling up — without this, a stale observer
// from an earlier run reacts to unrelated later DOM resets and re-inserts stale content.
let activeWipeObserver: MutationObserver | null = null;

function watchForExternalWipe(restore: (mount: HTMLElement) => void): void {
  activeWipeObserver?.disconnect();
  let selfWriting = false;

  const observer = new MutationObserver(() => {
    if (selfWriting) return;
    const current = document.querySelector<HTMLElement>('[data-rp-mount]');
    if (!current || current.children.length > 0) return; // gone, or already has content — not an actionable wipe.

    selfWriting = true;
    try {
      restore(current);
    } finally {
      selfWriting = false;
    }
  });
  activeWipeObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true });
}

/** Test-only: disconnects any live wipe-observer. There's exactly one real page load in
 *  production (nothing to reset), but a test file reruns `syncReturnPrimePage()` repeatedly
 *  against the same long-lived jsdom `document` — without disconnecting between runs, a
 *  stale observer keeps firing (and eventually throws once that test's environment tears
 *  down), fires on unrelated later tests' DOM resets, and reinserts stale content. */
export function __disconnectWipeObserverForTests(): void {
  activeWipeObserver?.disconnect();
  activeWipeObserver = null;
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
    watchForExternalWipe((freshMount) => renderMessage(freshMount, FALLBACK_MESSAGE));
    return;
  }

  const enabled = await fetchEnabled(adapterUrl, store);
  if (!enabled) {
    renderMessage(mount, UNAVAILABLE_MESSAGE);
    watchForExternalWipe((freshMount) => renderMessage(freshMount, UNAVAILABLE_MESSAGE));
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
  watchForExternalWipe((freshMount) => {
    void mountPortalIframe(freshMount, portalUrl);
  });
}
