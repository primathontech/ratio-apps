type Rec = Record<string, unknown>;

function asNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Map the platform order's payment onto Delhivery's `payment_mode`.
 *
 * Verified against the GoKwik os-order model (TRD §7.3): the canonical field is
 * `payment_method` (`prepaid` | `cod`); there is NO dedicated COD boolean/amount
 * in the order payload. COD is also detectable via `financial_status` — COD is
 * never pre-collected, so it sits at `pending`/`unpaid`, whereas Prepaid is
 * `paid`/`authorized`. We therefore treat an order as COD when ANY of:
 *   - `payment_method` (or another descriptor / the `payment_gateway_names[]`
 *     array) contains "cod"/"cash on delivery", or an explicit `cod === true`;
 *   - `financial_status` is a not-collected state (`pending`/`unpaid`).
 * COD carries the order total as `cod_amount`; Prepaid carries 0.
 */
export function mapPaymentMode(order: Rec): { mode: 'COD' | 'Prepaid'; codAmount: number } {
  const gatewayNames = Array.isArray(order.payment_gateway_names)
    ? (order.payment_gateway_names as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const descriptors = [
    order.payment_mode,
    order.payment_method,
    order.payment_gateway,
    order.gateway,
    ...gatewayNames,
  ]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();

  const financial =
    typeof order.financial_status === 'string' ? order.financial_status.toLowerCase() : '';

  const isCod =
    order.cod === true ||
    descriptors.includes('cod') ||
    descriptors.includes('cash on delivery') ||
    financial === 'pending' ||
    financial === 'unpaid';

  const total = asNumber(order.total_price ?? order.total_amount ?? order.total ?? 0);
  return isCod ? { mode: 'COD', codAmount: total } : { mode: 'Prepaid', codAmount: 0 };
}
