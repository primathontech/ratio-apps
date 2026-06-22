import { api } from './api';

// The backend's Google OAuth "connect" route is merchant-guarded and returns
// the Google consent URL as JSON — it does NOT 302. A plain top-level browser
// navigation (an <a href>) can't send the `Authorization: Bearer <merchantId>`
// header the guard requires, so we fetch the URL via `api` (which attaches the
// header) and then navigate the browser to Google's consent screen.
export async function startGoogleConnect(): Promise<void> {
  const { url } = await api<{ url: string }>('GET', '/api/v1/google-oauth/connect');
  // Google's consent screen refuses to be framed (X-Frame-Options /
  // frame-ancestors), and this admin runs inside the Ratio dashboard iframe.
  // A same-frame `window.location` navigation would try to load Google INSIDE
  // the iframe and be blocked. Drive the TOP-LEVEL window out to consent
  // instead. If the embedder sandboxes us without `allow-top-navigation`,
  // assigning `window.top.location` throws a SecurityError — fall back to a
  // popup (the click is a user gesture, so it won't be blocked).
  try {
    const top = window.top ?? window;
    if (top === window.self) {
      // Not framed (standalone dev / direct open): plain navigation.
      window.location.href = url;
    } else {
      top.location.href = url;
    }
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// Disconnect the Google account: clears stored OAuth credentials server-side and
// reverts the config to manual. No navigation — the caller refetches the config
// afterwards so the UI flips to the not-connected (manual) state.
export async function disconnectGoogle(): Promise<void> {
  await api<{ disconnected: true }>('POST', '/api/v1/google-oauth/disconnect');
}
