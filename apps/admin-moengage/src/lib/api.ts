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

// The unified backend mounts the MoEngage vendor under the `/moengage/*`
// subpath. VITE_API_BASE_URL points at the backend root (e.g.
// http://localhost:3000), so we prepend `/moengage` here so every call from
// this SPA lands on the correct vendor namespace.
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const BASE = RAW_BASE.endsWith('/') ? `${RAW_BASE.slice(0, -1)}/moengage` : `${RAW_BASE}/moengage`;

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { auth?: boolean } = { auth: true },
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (options.auth) {
    const token = useMerchantStore.getState().token;
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const init: RequestInit = { method, headers, credentials: 'include' };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  const json = text
    ? (JSON.parse(text) as ApiError & { data?: unknown })
    : ({} as ApiError & { data?: unknown });
  if (!res.ok) {
    throw new ApiException(
      json.message ?? res.statusText,
      res.status,
      json.error_code,
      json.details,
    );
  }
  return (json.data ?? json) as T;
}
