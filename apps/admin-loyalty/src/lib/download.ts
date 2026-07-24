import { useMerchantStore } from '@/stores/useMerchantStore';

/**
 * Authenticated binary downloads. Poster PNG/PDF, bulk errors.csv and export
 * downloads all sit behind the merchant-token guard, so a plain <a href> can't
 * fetch them — we fetch with the bearer header, take the body as a Blob, and
 * trigger a client-side download.
 *
 * NOTE on exports: `GET /api/exports/:id/download` answers with a 302 to a
 * short-lived S3 presigned URL. `fetch` follows the redirect (default
 * `redirect: 'follow'`), so the blob we save IS the CSV — no token ever
 * reaches S3 (the presign query auth takes over after the hop).
 */

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const BASE = RAW_BASE.endsWith('/') ? `${RAW_BASE.slice(0, -1)}/loyalty` : `${RAW_BASE}/loyalty`;

export async function downloadAuthenticated(path: string, filename: string): Promise<void> {
  const token = useMerchantStore.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    headers,
    credentials: 'include',
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  triggerBlobDownload(await res.blob(), filename);
}

/** Save a client-generated text file (e.g. the invalid-rows CSV preview). */
export function downloadTextFile(
  text: string,
  filename: string,
  mime = 'text/csv;charset=utf-8',
): void {
  triggerBlobDownload(new Blob([text], { type: mime }), filename);
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
