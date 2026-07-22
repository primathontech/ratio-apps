import { isAllowedOrigin, isLocalhost } from '../hooks/useIframeAuth';

const STORAGE_KEY = 'rp-ratio:merchant-id';

// Fail-closed by construction: VITE_RATIO_DASHBOARD_ORIGIN ships blank in
// .env.example ("leave empty in dev to accept any origin"), which meant a
// prod deployment that forgot to set it silently accepted a `ratio:session`
// postMessage — and the merchant-id inside it — from ANY origin. Reuse the
// same real allow-list useIframeAuth already enforces for iframe embedding
// (real gokwik.co/gokwik.in hosts, plus localhost for local dev) instead of
// an env var that can be left unset.
function isAllowedMessageOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  return isLocalhost(hostname) || isAllowedOrigin(origin);
}

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
  const handler = (ev: MessageEvent): void => {
    if (!isAllowedMessageOrigin(ev.origin)) return;
    const data = ev.data as { type?: string; merchantId?: string } | null;
    if (data?.type === 'ratio:session' && typeof data.merchantId === 'string') {
      window.localStorage.setItem(STORAGE_KEY, data.merchantId);
      onSession(data.merchantId);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
