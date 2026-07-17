import { useMerchantStore } from '@/stores/useMerchantStore';

export interface ApiError {
  status_code: number;
  message: string;
  error_code?: string;
  details?: unknown;
}

export class ApiException extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiException';
  }
}

// VITE_API_BASE_URL points at the backend root; the Delhivery vendor is mounted
// under /delhivery/*, so prepend it here.
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const BASE = RAW_BASE.endsWith('/')
  ? `${RAW_BASE.slice(0, -1)}/delhivery`
  : `${RAW_BASE}/delhivery`;

// Error bodies aren't always JSON (Delhivery sends plain text, proxies send HTML).
function parseJsonSafe<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function toApiException(res: Response, text: string): ApiException {
  const json = parseJsonSafe<ApiError>(text);
  return new ApiException(
    json?.message ?? (text ? text.slice(0, 300) : res.statusText),
    res.status,
    json?.error_code,
    json?.details,
  );
}

function buildHeaders(opts: { auth?: boolean; jsonBody?: boolean; accept?: string | null }): Record<string, string> {
  const headers: Record<string, string> = {};
  const accept = opts.accept === undefined ? 'application/json' : opts.accept;
  if (accept) headers.accept = accept;
  if (opts.jsonBody) headers['content-type'] = 'application/json';
  if (BASE.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true';
  if (opts.auth) {
    const token = useMerchantStore.getState().token;
    if (token) headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { auth?: boolean } = { auth: true },
): Promise<T> {
  const headers = buildHeaders({ auth: !!options.auth, jsonBody: body !== undefined });
  const init: RequestInit = { method, headers, credentials: 'include' };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  if (!res.ok) throw toApiException(res, text);
  const json = parseJsonSafe<ApiError & { data?: unknown }>(text);
  return (json?.data ?? json ?? (text as unknown)) as T;
}

// Label-PDF proxy: backend streams the PDF, browser only carries the session token.
export async function apiBlob(path: string): Promise<Blob> {
  const headers = buildHeaders({ auth: true, accept: null });
  const res = await fetch(`${BASE}${path}`, { method: 'GET', headers, credentials: 'include' });
  if (!res.ok) throw toApiException(res, await res.text());
  return res.blob();
}
