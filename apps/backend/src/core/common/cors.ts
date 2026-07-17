/**
 * Shared CORS origin allowlist logic. Single source of truth for BOTH the
 * global `enableCors` config in `main.ts` AND any handler that must reapply
 * CORS itself — e.g. a `reply.hijack()`ed streaming response, which bypasses
 * Fastify's normal CORS header injection (see the forms CSV export).
 */

export type CorsOriginType = string | boolean | RegExp;
type CorsOriginCallback = (err: Error | null, origin: CorsOriginType | CorsOriginType[]) => void;
export type CorsOriginFn = (origin: string | undefined, callback: CorsOriginCallback) => void;

type OriginPattern =
  | { kind: 'exact'; value: string }
  | { kind: 'suffix'; proto: string; suffix: string };

/**
 * Compile a comma-separated allowlist into matchers. The wildcard form
 * `https://*.gokwik.in` matches any subdomain by exact suffix (NOT substring)
 * — `evilgokwik.in` is rejected because the host must END with `.gokwik.in`
 * (leading dot included) and the proto prefix must match.
 *
 * CAVEAT: if a 3rd-party tenant ever hosts on a `gokwik.in`/`gokwik.io`
 * subdomain, the wildcard implicitly trusts them — audit when onboarding
 * tenants who control DNS under those domains.
 */
function compile(rawAllowed: string): OriginPattern[] {
  return rawAllowed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      if (!p.startsWith('https://*.') && !p.startsWith('http://*.')) {
        return { kind: 'exact' as const, value: p };
      }
      const proto = p.startsWith('https://') ? 'https://' : 'http://';
      const suffix = p.slice(`${proto}*`.length); // includes the leading dot, e.g. `.gokwik.in`
      return { kind: 'suffix' as const, proto, suffix };
    });
}

/**
 * True if `origin` is permitted by the allowlist. A missing origin (same-origin
 * or non-browser request) is allowed — callers that only want to emit an
 * `Access-Control-Allow-Origin` header should additionally guard on `origin`
 * being present.
 */
export function isOriginAllowed(origin: string | undefined, rawAllowed: string): boolean {
  if (!origin) return true;
  for (const p of compile(rawAllowed)) {
    if (p.kind === 'exact' && p.value === origin) return true;
    if (p.kind === 'suffix' && origin.startsWith(p.proto) && origin.endsWith(p.suffix)) return true;
  }
  return false;
}

/** The callback-style checker `@fastify/cors` (via `enableCors`) expects. */
export function buildCorsOriginChecker(rawAllowed: string): CorsOriginFn {
  const patterns = compile(rawAllowed);
  return (origin, cb) => {
    if (!origin) return cb(null, true);
    for (const p of patterns) {
      if (p.kind === 'exact' && p.value === origin) return cb(null, true);
      if (p.kind === 'suffix' && origin.startsWith(p.proto) && origin.endsWith(p.suffix))
        return cb(null, true);
    }
    cb(null, false);
  };
}
