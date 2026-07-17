// One config fetch per (adapter, store) page-load, shared by every caller — an order-history
// page can render dozens of buttons, and now also the /apps/return_prime page itself, none of
// which should fire their own separate request.
const enabledCache = new Map<string, Promise<boolean>>();

/**
 * Merchant enable/disable toggle (RP admin → adapter /rp/config). Fails CLOSED — resolves
 * false on any error, so an adapter outage hides the entry point rather than surfacing a
 * dead one.
 */
export function fetchEnabled(adapterUrl: string, store: string): Promise<boolean> {
  const key = `${adapterUrl}|${store}`;
  let cached = enabledCache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const res = await fetch(
          `${adapterUrl.replace(/\/$/, '')}/rp/config?shop=${encodeURIComponent(store)}`,
        );
        // A transient failure (network blip, adapter briefly down) isn't the same as the
        // merchant genuinely disabling Return/Exchange — don't let it stick as "false" for
        // the rest of the page's life once the adapter recovers.
        if (!res.ok) {
          enabledCache.delete(key);
          return false;
        }
        const json = (await res.json()) as {
          data?: { returnExchangeEnabled?: boolean };
          returnExchangeEnabled?: boolean;
        };
        return (json.data?.returnExchangeEnabled ?? json.returnExchangeEnabled) === true;
      } catch {
        enabledCache.delete(key);
        return false;
      }
    })();
    enabledCache.set(key, cached);
  }
  return cached;
}
