// The KwikPass bridge — the ONLY module that knows how the storefront's
// KwikPass (GoKwik OTP) session is stored and triggered. Mirrors the live
// wellversed-2.0 integration (`src/integrations/kwikpass-custom/`): token keys
// from its `KWIKPASS_TOKEN_KEYS`, cookie-first lookup order, the
// `window.handleCustomLogin(false)` login trigger, and the `user-loggedin`
// resume event. If KwikPass renames anything, update it here only.

declare global {
  interface Window {
    /** KwikPass-provided global that opens the phone/OTP login modal. */
    handleCustomLogin?: (redirect: boolean) => void;
  }
}

/**
 * Active-session token keys written by the KwikPass SDK (per environment),
 * checked in this order. Source of truth: wellversed-2.0
 * `src/integrations/kwikpass-custom/utils.tsx` (`KWIKPASS_TOKEN_KEYS`).
 */
export const KWIKPASS_TOKEN_KEYS = [
  'KWIKUSERTOKEN',
  'SANDBOXKWIKUSERTOKEN',
  'QAKWIKUSERTOKEN',
  'DEVKWIKUSERTOKEN',
] as const;

/** CustomEvent the widget dispatches to ask the host page to open login. */
export const LOGIN_REQUEST_EVENT = 'loyalty:login:request';

/** Window event the KwikPass SDK fires once the user completes login. */
export const LOGGED_IN_EVENT = 'user-loggedin';

/** Read one cookie value; decode when possible (KwikPass URL-encodes it). */
function readCookie(key: string): string | null {
  const match = document.cookie
    .split('; ')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`));
  if (!match) return null;
  const value = match.split('=').slice(1).join('=');
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Read localStorage defensively (Safari private mode throws). */
function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Return the KwikPass session token, or `null` when logged out. Per key:
 * cookie first, then localStorage — the SDK's own lookup order.
 */
export function getKwikPassToken(): string | null {
  for (const key of KWIKPASS_TOKEN_KEYS) {
    const token = readCookie(key) ?? readLocalStorage(key);
    if (token) return token;
  }
  return null;
}

/**
 * Drop every stored KwikPass token (cookie + localStorage, all env variants).
 * Called before re-prompting login after a stale/expired session, so the
 * resume path doesn't immediately read the same dead token back.
 */
export function clearKwikPassToken(): void {
  for (const key of KWIKPASS_TOKEN_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Safari private mode throws — ignore.
    }
    // Expire the cookie on the current path and host.
    document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

/**
 * Ask the host page to open the KwikPass login modal: dispatch
 * `loyalty:login:request` (for the Shopkit wrapper widget) AND call
 * `window.handleCustomLogin(false)` directly as the non-wrapper fallback.
 */
export function requestLogin(): void {
  window.dispatchEvent(new CustomEvent(LOGIN_REQUEST_EVENT));
  try {
    window.handleCustomLogin?.(false);
  } catch {
    // the host's login trigger failing must not break the widget
  }
}

/**
 * Resume-after-login hook: invoke `cb` when KwikPass fires `user-loggedin`.
 * Returns an unsubscribe function.
 */
export function onLoggedIn(cb: () => void): () => void {
  const handler = (): void => cb();
  window.addEventListener(LOGGED_IN_EVENT, handler);
  return () => window.removeEventListener(LOGGED_IN_EVENT, handler);
}
