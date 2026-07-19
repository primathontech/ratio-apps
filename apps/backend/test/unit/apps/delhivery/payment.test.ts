import { describe, expect, it } from 'vitest';
import { mapPaymentMode } from '../../../../src/modules/delhivery/shipments/payment';

describe('mapPaymentMode (payment.mapsCod / payment.mapsPrepaid)', () => {
  // Order amounts arrive in PAISE and are converted to RUPEES for Delhivery.
  it('payment.mapsCod — COD descriptors carry the total (paise→rupees) as cod_amount', () => {
    expect(mapPaymentMode({ payment_method: 'COD', total_price: 149900 })).toEqual({
      mode: 'COD',
      codAmount: 1499,
    });
    expect(mapPaymentMode({ payment_gateway: 'Cash on Delivery (GoKwik)', total_price: '99900' })).toEqual({
      mode: 'COD',
      codAmount: 999,
    });
    expect(mapPaymentMode({ cod: true, total_amount: 25000 })).toEqual({ mode: 'COD', codAmount: 250 });
    // payment_gateway_names is an ARRAY on the real order payload
    expect(mapPaymentMode({ payment_gateway_names: ['cod'], total_price: 50000 })).toEqual({
      mode: 'COD',
      codAmount: 500,
    });
    // COD is never pre-collected → financial_status pending/unpaid
    expect(mapPaymentMode({ financial_status: 'pending', total_price: 70000 })).toEqual({
      mode: 'COD',
      codAmount: 700,
    });
    expect(mapPaymentMode({ financial_status: 'unpaid', total_price: 80000 })).toEqual({
      mode: 'COD',
      codAmount: 800,
    });
  });

  it('payment.mapsPrepaid — anything else is Prepaid with cod_amount 0', () => {
    expect(mapPaymentMode({ payment_method: 'razorpay_upi', total_price: 1499 })).toEqual({
      mode: 'Prepaid',
      codAmount: 0,
    });
    expect(mapPaymentMode({ financial_status: 'paid', total_price: 100 })).toEqual({
      mode: 'Prepaid',
      codAmount: 0,
    });
    // prepaid: canonical payment_method + captured status + real gateway
    expect(
      mapPaymentMode({
        payment_method: 'prepaid',
        financial_status: 'paid',
        payment_gateway_names: ['razorpay'],
        total_price: 100,
      }),
    ).toEqual({ mode: 'Prepaid', codAmount: 0 });
    expect(mapPaymentMode({ financial_status: 'authorized', total_price: 100 })).toEqual({
      mode: 'Prepaid',
      codAmount: 0,
    });
    expect(mapPaymentMode({})).toEqual({ mode: 'Prepaid', codAmount: 0 });
  });
});
