/**
 * Session = the Ratio merchant id, period.
 *
 * Resolution order:
 *   1. URL query `?merchant-id=<id>` — set by the OAuth callback redirect (one-shot)
 *   2. localStorage cache — survives reloads
 *   3. postMessage `{ type: 'ratio:session', merchantId }` from the dashboard
 *
 * The merchant id passes through as a Bearer token to the backend; MerchantTokenGuard
 * looks it up in `merchants` and rejects unknown ids. Inactive merchants STILL pass
 * the guard (with `isActive: false`) so the root layout can render an
 * "Invalid merchant" screen instead of a generic 401.
 */
const STORAGE_KEY = 'google-ratio:merchant-id';

export function readSession(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('merchant-id');
  if (fromUrl) {
    window.localStorage.setItem(STORAGE_KEY, fromUrl);
    url.searchParams.delete('merchant-id');
    window.history.replaceState({}, '', url.toString());
    return fromUrl;
  }
  return window.localStorage.getItem(STORAGE_KEY);
}

export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function installPostMessageListener(onSession: (id: string) => void): () => void {
  const allowed = (import.meta.env.VITE_RATIO_DASHBOARD_ORIGIN as string | undefined) ?? '';
  const handler = (ev: MessageEvent): void => {
    if (allowed && ev.origin !== allowed) return;
    const data = ev.data as { type?: string; merchantId?: string } | null;
    if (data?.type === 'ratio:session' && typeof data.merchantId === 'string') {
      window.localStorage.setItem(STORAGE_KEY, data.merchantId);
      onSession(data.merchantId);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
