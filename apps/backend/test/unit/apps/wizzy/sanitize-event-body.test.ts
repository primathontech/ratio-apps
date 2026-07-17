import { describe, expect, it } from 'vitest';
import { sanitizeEventBody } from '../../../../src/modules/wizzy/storefront/storefront.controller';

describe('sanitizeEventBody', () => {
  it('preserves the top-level `qty` required by Wizzy ConvertedEvent', () => {
    const out = sanitizeEventBody({
      name: 'Product Purchased',
      searchResponseId: 'resp-1',
      id: 'O1',
      value: 999,
      qty: 5,
      items: [{ itemId: 'P1', position: 0, qty: 2 }],
    });
    expect(out.qty).toBe(5);
    expect(out.value).toBe(999);
    expect(out.id).toBe('O1');
    expect(out.items).toEqual([{ itemId: 'P1', position: 0, qty: 2 }]);
  });

  it('keeps the click `source` and drops unknown fields', () => {
    const out = sanitizeEventBody({
      name: 'Product Viewed',
      searchResponseId: 'resp-1',
      source: 'SEARCH_RESULTS',
      evil: 'DROP ME',
      items: [{ itemId: 'P1', position: 2, qty: 1 }],
    });
    expect(out.source).toBe('SEARCH_RESULTS');
    expect('evil' in out).toBe(false);
    expect('qty' in out).toBe(false); // no qty on a click payload
  });

  it('omits qty when it is not a finite number', () => {
    const out = sanitizeEventBody({ name: 'x', qty: 'nope' });
    expect('qty' in out).toBe(false);
  });
});
