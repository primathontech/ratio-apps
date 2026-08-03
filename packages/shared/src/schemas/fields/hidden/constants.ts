/**
 * Zod-free hidden-field constants + the pure `resolveHiddenValue` resolver.
 *
 * The storefront widget (packages/forms-sdk) must never import runtime values
 * from `schema.ts` (that pulls Zod into the bundle and can't be traced from the
 * CJS dist). Everything the SDK needs to resolve a hidden value at render time
 * lives here — no Zod, no other runtime deps. `schema.ts` re-imports these
 * constants for its bounds; the SDK and the backend validator import the
 * resolver/bounds directly. Mirrors the `form-adornments.ts` zero-Zod pattern.
 */

/**
 * Where a hidden field's value is resolved from (§4). `url_param`/`cookie` read
 * the configured `paramName`; `referrer`/`landing_url`/`timestamp` are derived
 * from the page context; `constant` emits a fixed merchant string. Every source
 * is a closed enum — no open-ended behavior reaches the resolver.
 */
export const HIDDEN_SOURCES = [
  'url_param',
  'cookie',
  'referrer',
  'landing_url',
  'timestamp',
  'constant',
] as const;

export type HiddenSource = (typeof HIDDEN_SOURCES)[number];

/** Default source — preserves the legacy URL-param capture behavior. */
export const HIDDEN_DEFAULT_SOURCE: HiddenSource = 'url_param';

/**
 * Hard ceiling on a resolved hidden value. A captured/derived string longer
 * than this is truncated (SDK) / rejected (server) — a cheap DoS guard on a
 * value that is never user-typed. Also bounds `constantValue`/`fallback` in the
 * schema so the two can't drift.
 */
export const HIDDEN_MAX_VALUE_LENGTH = 2048;

/**
 * Provenance of one resolved hidden value, persisted per submission in
 * `form_submissions.context_json` (§4, migration 0005). `source` is the
 * configured/derived source the value came from; `value` is the raw resolved
 * string that was stored. Zod-free so both the backend writer and the admin
 * detail view import it type-only without pulling Zod. Optional/nullable at the
 * column level — a submission with no hidden fields writes no context.
 */
export interface HiddenFieldProvenance {
  /** Which source produced the value (`url_param` when the field left it unset). */
  source: HiddenSource;
  /** The raw resolved value that was submitted/derived for this field. */
  value: string;
}

/** field key → provenance for every hidden field that resolved a value. */
export type SubmissionContext = Record<string, HiddenFieldProvenance>;

/** The field config fields the resolver reads (a structural subset of the schema). */
export interface HiddenResolveField {
  source?: HiddenSource | undefined;
  paramName?: string | undefined;
  constantValue?: string | undefined;
  fallback?: string | undefined;
}

/** Ambient page context the resolver reads — passed in so the fn stays pure/testable. */
export interface HiddenResolveContext {
  /** `window.location.search` (leading `?` optional). */
  search: string;
  /** `document.cookie`. */
  cookie: string;
  /** `document.referrer`. */
  referrer: string;
  /** `window.location.href` — the landing URL. */
  href: string;
  /** A single "now" snapshot for the `timestamp` source. */
  now: Date;
}

/** Read a cookie value by name from a `document.cookie` string; null when absent. */
export function readCookieValue(cookie: string, name: string): string | null {
  if (!cookie || !name) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return null;
}

/**
 * Resolve a hidden field's value from its configured source, applying the
 * `fallback` when the source yields nothing, and clamping to the hard ceiling.
 * Pure and Zod-free so the SDK render path and (a mirror of) the server can
 * share one verdict. Returns `null` when nothing resolves and no fallback is set
 * (the field simply isn't submitted).
 */
export function resolveHiddenValue(
  field: HiddenResolveField,
  ctx: HiddenResolveContext,
): string | null {
  const source = field.source ?? HIDDEN_DEFAULT_SOURCE;
  let resolved: string | null = null;
  switch (source) {
    case 'url_param':
      resolved = field.paramName ? new URLSearchParams(ctx.search).get(field.paramName) : null;
      break;
    case 'cookie':
      resolved = field.paramName ? readCookieValue(ctx.cookie, field.paramName) : null;
      break;
    case 'referrer':
      resolved = ctx.referrer || null;
      break;
    case 'landing_url':
      resolved = ctx.href || null;
      break;
    case 'timestamp':
      resolved = ctx.now.toISOString();
      break;
    case 'constant':
      resolved = field.constantValue ?? null;
      break;
  }
  if (resolved === null || resolved === '') {
    resolved = field.fallback !== undefined && field.fallback !== '' ? field.fallback : null;
  }
  if (resolved === null) return null;
  return resolved.length > HIDDEN_MAX_VALUE_LENGTH
    ? resolved.slice(0, HIDDEN_MAX_VALUE_LENGTH)
    : resolved;
}
