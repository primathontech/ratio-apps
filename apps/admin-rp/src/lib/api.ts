import { useMerchantStore } from '@/stores/useMerchantStore';

export class ApiException extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode?: string,
  ) {
    super(message);
    this.name = 'ApiException';
  }
}

// In dev: Vite proxy routes /rp/* → :3100 (relative path works).
// In production (marketplace ZIP): must use an absolute VITE_API_BASE_URL so
// the CDN-served SPA can reach the backend.
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const BASE = RAW_BASE
  ? RAW_BASE.endsWith('/')
    ? `${RAW_BASE.slice(0, -1)}/rp`
    : `${RAW_BASE}/rp`
  : '/rp';

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = useMerchantStore.getState().token;
  if (token) headers.authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers, credentials: 'include' };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new ApiException(
      (json.message as string) ?? res.statusText,
      res.status,
      json.error_code as string | undefined,
    );
  }
  return (json.data ?? json) as T;
}
