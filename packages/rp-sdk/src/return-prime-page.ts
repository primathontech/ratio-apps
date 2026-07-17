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

export async function syncReturnPrimePage(): Promise<void> {
  if (location.pathname.replace(/\/$/, '') !== scriptConfig.returnPrimePath.replace(/\/$/, '')) {
    return;
  }
  const mount = await waitForMount();
  if (!mount) return;

  const { adapterUrl, store } = scriptConfig;
  if (!adapterUrl || !store) return;

  const enabled = await fetchEnabled(adapterUrl, store);
  if (!enabled) {
    mount.innerHTML = `
      <div style="min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem">
        <h1 style="font-size:1.5rem;margin-bottom:0.5rem">Returns &amp; Exchanges</h1>
        <p style="color:#666;max-width:28rem">Returns and exchanges are currently unavailable. Please contact our support team for help with your order.</p>
      </div>
    `;
    return;
  }

  const pageParams = new URLSearchParams(location.search);
  const params = new URLSearchParams({ shop: store });
  for (const key of ['order', 'email', 'orderId']) {
    const value = pageParams.get(key);
    if (value) params.set(key, value);
  }
  const portalUrl = `${adapterUrl.replace(/\/$/, '')}/rp/customer/portal?${params.toString()}`;

  const iframe = document.createElement('iframe');
  iframe.src = portalUrl;
  iframe.title = 'Returns & Exchanges';
  // local-network-access: required since Chrome 142 — without it, the iframe (a
  // cross-origin subframe) can't reach RP even if the user grants the top-level
  // page's own Local Network Access permission prompt; the grant doesn't delegate
  // to iframes without this attribute.
  iframe.setAttribute('allow', 'clipboard-write; local-network-access');
  iframe.style.cssText = 'width:100%;min-height:85vh;border:0;display:block';
  mount.replaceChildren(iframe);
}
