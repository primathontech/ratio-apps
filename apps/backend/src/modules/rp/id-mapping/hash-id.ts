const MAX = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Deterministic Shopify-compatible numeric id from an arbitrary OS id (UUID or numeric
 * string). Shopify-style ids (already ≤ MAX_SAFE_INTEGER) pass through unchanged so they
 * stay consistent with order line items. Larger numeric ids and UUIDs are reduced modulo
 * MAX_SAFE_INTEGER — deterministic and within the safe range RP's numeric id fields +
 * Joi `number` validation require.
 *
 * This is the SINGLE canonical implementation — every code path that mints a Shopify-shape
 * numeric id from a real OS id (transformer.service.ts, normalize-order.ts) must delegate
 * here. Previously normalize-order.ts had its own, different (truncated-hex) algorithm
 * despite a comment claiming it matched this one — the same real id could hash to two
 * different numbers depending on whether RP learned about it via an order line item or a
 * direct product fetch, fragmenting RP's own product cache. Unifying on one function makes
 * that impossible going forward.
 */
export function hashId(value: string): string {
  if (!value) return '0';
  const direct = Number(value);
  if (!isNaN(direct) && Number.isInteger(direct) && direct > 0 && direct <= Number.MAX_SAFE_INTEGER) {
    return String(direct);
  }
  try {
    if (/^\d+$/.test(value)) {
      const n = BigInt(value) % MAX;
      return (n === 0n ? 1n : n).toString();
    }
    const hex = value.replace(/-/g, '').replace(/[^0-9a-f]/gi, '');
    if (!hex) return '0';
    const n = BigInt('0x' + hex) % MAX;
    return (n === 0n ? 1n : n).toString();
  } catch {
    return '0';
  }
}
