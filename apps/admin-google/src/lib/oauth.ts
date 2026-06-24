import { api } from './api';

const OAUTH_MESSAGE_SOURCE = 'ratio-google-oauth';

/** Origin the OAuth callback page posts from (the backend host). */
function apiOrigin(): string | null {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  try {
    return raw ? new URL(raw).origin : null;
  } catch {
    return null;
  }
}

/**
 * Start the Google connect flow in a POPUP and resolve when it completes —
 * WITHOUT navigating, so the merchant stays inside the Ratio dashboard iframe.
 *
 * Flow: open a blank popup synchronously (inside the click gesture, so it isn't
 * blocked) → fetch the merchant-guarded consent URL → point the popup at Google
 * → the backend callback page posts `{ source, connected:true }` back to us and
 * closes. We resolve `true` on that message, or `false` if the user closes the
 * popup first. If the popup is blocked, we fall back to a top-level navigation
 * (old behavior) and resolve `false` (the page will reload via the redirect).
 */
export async function startGoogleConnect(): Promise<boolean> {
  // Open synchronously in the user gesture so the popup blocker allows it.
  const popup = window.open('about:blank', 'ratio-google-oauth', 'popup,width=600,height=720');

  let url: string;
  try {
    ({ url } = await api<{ url: string }>('GET', '/api/v1/google-oauth/connect'));
  } catch (err) {
    popup?.close();
    throw err;
  }

  if (!popup || popup.closed) {
    // Popup blocked — fall back to a top-level navigation out to consent.
    try {
      const top = window.top ?? window;
      (top === window.self ? window : top).location.href = url;
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return false;
  }

  popup.location.href = url;

  return new Promise<boolean>((resolve) => {
    const expectedOrigin = apiOrigin();
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(poll);
      resolve(connected);
    };
    const onMessage = (e: MessageEvent): void => {
      if (expectedOrigin && e.origin !== expectedOrigin) return;
      const data = e.data as { source?: string; connected?: boolean } | null;
      if (data?.source === OAUTH_MESSAGE_SOURCE && data.connected) {
        try {
          popup.close();
        } catch {
          /* already closed */
        }
        finish(true);
      }
    };
    window.addEventListener('message', onMessage);
    // The popup closing without a message = user cancelled.
    const poll = window.setInterval(() => {
      if (popup.closed) finish(false);
    }, 500);
  });
}

// Disconnect the Google account: clears stored OAuth credentials server-side and
// reverts the config to manual. No navigation — the caller refetches the config
// afterwards so the UI flips to the not-connected (manual) state.
export async function disconnectGoogle(): Promise<void> {
  await api<{ disconnected: true }>('POST', '/api/v1/google-oauth/disconnect');
}
