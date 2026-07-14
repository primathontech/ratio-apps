const KEY = 'forms:uid';
const ID_RE = /^wz_[a-z0-9]+$/;

/**
 * Returns a stable anonymous user id (e.g. `wz_ab12...`) for the `x-forms-userId`
 * header, generating and persisting one on first use. Private-mode safe.
 */
export function getAnonId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && ID_RE.test(existing)) return existing;
  } catch {}

  const id = `wz_${genHex()}`;
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  return id;
}

function genHex(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) {
    return c.randomUUID().replace(/-/g, '').toLowerCase();
  }
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
  }
  let out = '';
  while (out.length < 32) {
    out += Math.random().toString(36).slice(2);
  }
  return out.replace(/[^a-z0-9]/g, '').slice(0, 32) || '0';
}
