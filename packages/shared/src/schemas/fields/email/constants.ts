// ── Email field constants & pure helpers (Batch-4 field depth) ─────────────
// Single source of truth for the email field's runtime behavior, shared by the
// storefront SDK (client mirror), the backend (server-authoritative), and the
// zod schema (refinements). Deliberately ZOD-FREE — the SDK imports these at
// runtime and must not pull Zod into the widget bundle (mirrors how
// `form-adornments.ts` stays Zod-free). schema.ts re-imports these for its
// refinements; SDK + server import the same helpers so verdicts never drift.

/** RFC-5321 practical address ceiling. Default cap applied when a merchant
 * leaves `validation.maxLength` unset — enforced server-side regardless. */
export const EMAIL_MAX_LENGTH_DEFAULT = 254;
/** Hard schema ceiling for `validation.maxLength` (local 64 + @ + domain 255). */
export const EMAIL_MAX_LENGTH_CEILING = 320;
/** Upper bound on entries in an allow/block domain list (bounded array). */
export const EMAIL_MAX_DOMAIN_LIST = 50;

/**
 * Tightened email shape (replaces the old `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`). The
 * final label (TLD) must be ≥2 ASCII letters, so `a@b.c` / `a@b.1` no longer
 * pass. Each label is a `[^\s@.]+` anchored by a literal `.`, so the repetition
 * is non-overlapping and linear-time (no catastrophic backtracking). The `i`
 * flag lets the client test a not-yet-lowercased value; the server lowercases
 * first. Length is bounded by the caller before this ever runs.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[a-z]{2,}$/i;

/**
 * Bare-hostname regex for allow/block list entries — no scheme, no path, no `@`.
 * Labels are 1–63 chars of `[a-z0-9-]` (not starting/ending in `-`), ≥2 labels,
 * TLD ≥2 letters. Linear-time; length is additionally bounded by the schema's
 * `.max()`. Used by schema.ts (zod `.regex()`) — never fed to the RE2 engine.
 */
export const EMAIL_DOMAIN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Curated free / consumer mailbox providers (lowercase). `blockFreeProviders`
 * rejects an address whose domain is in this set — server-enforced so a
 * client-bypassed POST is still refused. A closed curated list (not a pattern),
 * so it can never over-block a legitimate business domain.
 */
export const FORM_FREE_EMAIL_PROVIDERS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.co.uk',
  'ymail.com',
  'rocketmail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'rediffmail.com',
];

/** Popular domains a typo is likely a near-miss of (client "did you mean"). */
export const FORM_EMAIL_SUGGEST_DOMAINS: readonly string[] = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
];

/** Common TLDs, for suggesting `.com` when a shopper types `.con` / `.comm`. */
export const FORM_EMAIL_SUGGEST_TLDS: readonly string[] = [
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'co',
  'in',
  'io',
  'co.in',
  'co.uk',
];

/** Server-authoritative canonical form: trim + lowercase. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The domain portion (after the last `@`), lowercased; '' when malformed. */
export function emailDomain(value: string): string {
  const at = value.lastIndexOf('@');
  if (at === -1) return '';
  return value.slice(at + 1).toLowerCase();
}

/** True when `host` equals, or is a sub-domain of, any entry in `list`. */
export function matchesDomain(host: string, list: readonly string[]): boolean {
  const h = host.toLowerCase();
  return list.some((d) => {
    const dd = d.toLowerCase();
    return h === dd || h.endsWith(`.${dd}`);
  });
}

/** True when the address's domain is a known free/consumer provider. */
export function isFreeEmailProvider(value: string): boolean {
  return matchesDomain(emailDomain(value), FORM_FREE_EMAIL_PROVIDERS);
}

/**
 * Bounded Levenshtein distance with an early-exit ceiling. `max` caps both the
 * work and the answer (returns `max + 1` once the best row exceeds `max`), so a
 * pathological pair never costs more than O(a·b) with tiny inputs (domains are
 * ≤255 chars, and callers pass ≤2). Pure, allocation-light.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0] as number;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (prev[j] as number) + 1,
        (curr[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] as number;
  }
  return prev[b.length] as number;
}

/**
 * Non-blocking "did you mean" hint (client-only, no network). Given a raw email
 * value it returns a corrected address when the domain looks like a near-miss
 * of a popular domain (or its TLD is a near-miss of a common TLD), else null.
 * Conservative: only fires on a strictly-closer, non-equal match within edit
 * distance ≤2 (domain) / ≤1 (TLD), so a legitimate domain is left untouched.
 */
export function suggestEmailCorrection(value: string): string | null {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (domain.length === 0 || domain.length > 255 || domain.includes('@')) return null;

  // Whole-domain near-miss (e.g. gmial.com → gmail.com). Skip exact matches.
  let best: string | null = null;
  let bestDist = 3;
  for (const cand of FORM_EMAIL_SUGGEST_DOMAINS) {
    if (cand === domain) return null; // already a known-good domain
    const d = boundedLevenshtein(domain, cand, 2);
    if (d > 0 && d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  if (best) return `${local}@${best}`;

  // TLD-only near-miss (e.g. example.con → example.com). Keep the SLD intact.
  // Restricted to TLDs ≥3 chars at edit distance 1, so real 2-letter ccTLDs
  // (`.is` vs `.in`) are never "corrected" and the hint stays conservative.
  const dot = domain.lastIndexOf('.');
  if (dot > 0) {
    const sld = domain.slice(0, dot);
    const tld = domain.slice(dot + 1);
    if (tld.length >= 3) {
      for (const cand of FORM_EMAIL_SUGGEST_TLDS) {
        if (cand === tld) return null;
        if (cand.length >= 3 && boundedLevenshtein(tld, cand, 1) === 1) {
          return `${local}@${sld}.${cand}`;
        }
      }
    }
  }
  return null;
}
