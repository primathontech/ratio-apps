import { useEffect, useState } from 'react';

export interface IframeAuthState {
  /** null = still checking, true = allowed to render, false = block. */
  isAuthorized: boolean | null;
  /** The parent origin we detected (for diagnostics in the block screen). */
  parentOrigin: string | null;
}

/** Hosts allowed to embed this admin in an iframe. Suffix match — covers any subdomain. */
const ALLOWED_HOST_SUFFIXES = ['.gokwik.co', '.gokwik.in'];

const REQUIRE_IFRAME =
  ((import.meta.env.VITE_REQUIRE_IFRAME as string | undefined) ?? 'true').toLowerCase() !== 'false';

function isLocalhost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_HOST_SUFFIXES.some(
      (suffix) => url.hostname === suffix.slice(1) || url.hostname.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

function detectParentOrigin(): string | null {
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList })
    .ancestorOrigins;
  if (ancestors && ancestors.length > 0) {
    return ancestors[0] ?? null;
  }
  return document.referrer || null;
}

export function useIframeAuth(): IframeAuthState {
  const [state, setState] = useState<IframeAuthState>({ isAuthorized: null, parentOrigin: null });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!REQUIRE_IFRAME) {
      setState({ isAuthorized: true, parentOrigin: null });
      return;
    }

    if (isLocalhost(window.location.hostname)) {
      setState({ isAuthorized: true, parentOrigin: null });
      return;
    }

    if (window.self === window.top) {
      setState({ isAuthorized: false, parentOrigin: null });
      return;
    }

    const parent = detectParentOrigin();
    setState({
      isAuthorized: parent ? isAllowedOrigin(parent) : false,
      parentOrigin: parent,
    });
  }, []);

  return state;
}
