import { describe, it, expect } from 'vitest';
import { RpTransformerService } from './transformer.service';

// Shape of Ratio ecosystem's RefundResponseDto (POST /api/v1/refunds, GET /api/v1/refunds/{id}) —
// note there is NO top-level `amount` field, only `totalAmount` (paise). A prior version of
// this transformer read `.amount`, which doesn't exist on this API's response at all.
const RATIO_REFUND = {
  id: 'ref_17139564000005678',
  merchantId: 'merchant-id',
  orderId: 'ordr_17139564000001234',
  status: 'SUCCESS',
  trigger: 'MERCHANT_INITIATED',
  restockType: 'NO_RESTOCK',
  notifyCustomer: true,
  subtotalAmount: 49900,
  totalTaxAmount: 7612,
  totalDiscountAmount: 4990,
  shippingAmount: 0,
  totalAmount: 52522,
  currency: 'INR',
  inventoryRestocked: false,
  createdBy: 'staff@merchant.com',
  lineItems: [{ id: 'li_1', lineItemId: '700', quantity: 1 }],
  createdAt: '2026-07-22T10:15:30.000Z',
  updatedAt: '2026-07-22T10:15:30.000Z',
};

describe('RpTransformerService.shopifyRefund', () => {
  const t = new RpTransformerService();

  it('reads the refund total from totalAmount (paise → rupee string) — not a nonexistent top-level amount field', () => {
    const out = t.shopifyRefund(RATIO_REFUND, '2439') as Record<string, any>;

    expect(out.transactions[0].amount).toBe('525.22');
    expect(out.transactions[0].currency).toBe('INR');
    expect(typeof out.refund_line_items[0].line_item_id).toBe('string');
    expect(out.refund_line_items[0].quantity).toBe(1);
  });
});
