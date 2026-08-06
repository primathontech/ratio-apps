const SENSITIVE_KEY_PATTERN = /(authorization|apikey|api_key|securitykey|security_key|password|secret|token|cookie)/i;

/**
 * Recursively redacts values under any key that looks credential-shaped
 * (authorization, apikey, securitykey, password, secret, token, cookie —
 * case-insensitive, substring match). Used to make full request/response
 * dumps safe to log — see Finding #12 in ratio.client.ts for why upstream
 * bodies aren't otherwise assumed safe to surface verbatim.
 */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '***redacted***' : redactSensitive(val);
    }
    return out;
  }
  return value;
}

/**
 * Renders a copy-pasteable curl command for an outbound request — purely a
 * debug-log convenience (paired with `redactSensitive`'d headers/body), not
 * used for the actual request.
 */
export function toCurl(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): string {
  const parts = [`curl -X ${method}`, `'${url}'`];
  for (const [key, val] of Object.entries(headers)) {
    parts.push(`-H '${key}: ${val}'`);
  }
  if (body !== undefined) {
    parts.push(`-d '${JSON.stringify(body)}'`);
  }
  return parts.join(' ');
}
