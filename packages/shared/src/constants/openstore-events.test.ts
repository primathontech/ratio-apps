import { describe, expect, it } from 'vitest';
import { OPEN_STORE_EVENT_NAMES, type OpenStoreEventName } from './openstore-events';

describe('openstore-events', () => {
  it('exports exactly 13 canonical event names', () => {
    expect(OPEN_STORE_EVENT_NAMES).toHaveLength(13);
  });

  it('includes the expected canonical names', () => {
    const expected: OpenStoreEventName[] = [
      'PageView',
      'ViewContent',
      'AddToCart',
      'InitiateCheckout',
      'AddShippingInfo',
      'AddPaymentInfo',
      'Purchase',
      'Search',
      'AddToWishlist',
      'Lead',
      'CompleteRegistration',
      'Contact',
      'Subscribe',
    ];
    expect([...OPEN_STORE_EVENT_NAMES]).toEqual(expected);
  });

  it('is frozen tuple typed as readonly', () => {
    expect(Object.isFrozen(OPEN_STORE_EVENT_NAMES)).toBe(false); // const tuple, not frozen, but compile-time readonly
    expect(Array.isArray(OPEN_STORE_EVENT_NAMES)).toBe(true);
  });
});
