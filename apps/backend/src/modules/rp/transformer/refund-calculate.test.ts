import { describe, it, expect } from 'vitest';
import { RpTransformerService } from './transformer.service';

// OS refund-calculate response (paise integers), as returned by the OS order service.
const OS_CALC = {
  lineItems: [
    { lineItemId: '3843', quantity: 1, unitPrice: 39900, subtotal: 39900, taxAmount: 0, discountAmount: 4000, totalAmount: 35900 },
  ],
  subtotalAmount: 39900,
  totalTaxAmount: 0,
  totalDiscountAmount: 4000,
  shippingAmount: 0,
  totalAmount: 35900,
  totalPaid: 52800,
  totalRefundable: 52800,
  previouslyRefunded: 0,
  currency: 'INR',
};

describe('RpTransformerService.shopifyRefundCalculate', () => {
  const t = new RpTransformerService();

  it('maps the OS calculate response to the Shopify shape RP requires (paise → rupee strings)', () => {
    const out = t.shopifyRefundCalculate(OS_CALC, '2439') as Record<string, any>;

    // RP's actualSource.helper reads these three; without them it crashes.
    expect(out.currency).toBe('INR');
    expect(Array.isArray(out.transactions)).toBe(true);
    expect(Array.isArray(out.refund_line_items)).toBe(true);

    // transactions[].maximum_refundable must be a rupee string RP can parseFloat and compare.
    expect(out.transactions[0].maximum_refundable).toBe('528.00');
    expect(out.transactions[0].amount).toBe('359.00'); // 35900 paise

    // refund_line_items carry the OS line id + quantity (mapRefundRequest maps these back to OS).
    expect(out.refund_line_items[0].line_item_id).toBe('3843');
    expect(out.refund_line_items[0].quantity).toBe(1);
    expect(out.refund_line_items[0].subtotal).toBe('359.00');
  });

  it('unwraps a { data } envelope and tolerates a missing lineItems array', () => {
    const out = t.shopifyRefundCalculate({ data: { ...OS_CALC, lineItems: undefined } }, '2439') as Record<string, any>;
    expect(out.refund_line_items).toEqual([]);
    expect(out.transactions[0].maximum_refundable).toBe('528.00');
  });
});
