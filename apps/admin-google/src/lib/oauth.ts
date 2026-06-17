import { api } from './api';

// The backend's Google OAuth "connect" route is merchant-guarded and returns
// the Google consent URL as JSON — it does NOT 302. A plain top-level browser
// navigation (an <a href>) can't send the `Authorization: Bearer <merchantId>`
// header the guard requires, so we fetch the URL via `api` (which attaches the
// header) and then navigate the browser to Google's consent screen.
export async function startGoogleConnect(): Promise<void> {
  const { url } = await api<{ url: string }>('GET', '/api/v1/google-oauth/connect');
  window.location.href = url;
}
