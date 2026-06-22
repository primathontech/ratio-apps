import { describe, expect, it } from 'vitest';
import { hashEventPii, parseWhaleBuckets, partitionKey } from '../../../../src/modules/meta/capi/edge';

const HEX64 = /^[a-f0-9]{64}$/;

describe('hashEventPii', () => {
  it('hashes email/phone/name, leaves fbp/fbc, is idempotent', () => {
    const once = hashEventPii({ event_name: 'Purchase', user_data: { em: 'A@B.com ', ph: '9876543210', fbp: 'fb.1' } });
    expect(once.user_data!.em).toMatch(HEX64);
    expect(once.user_data!.ph).toMatch(HEX64);
    expect(once.user_data!.fbp).toBe('fb.1');
    const twice = hashEventPii(once);
    expect(twice.user_data!.em).toBe(once.user_data!.em); // no double-hash
  });
  it('does not mutate the input', () => {
    const input = { event_name: 'X', user_data: { em: 'a@b.com' } };
    hashEventPii(input);
    expect(input.user_data!.em).toBe('a@b.com');
  });
});

describe('partitionKey + parseWhaleBuckets', () => {
  it('returns bare merchantId for non-whales', () => {
    expect(partitionKey('m1', 'e1', new Map())).toBe('m1');
  });
  it('buckets whales by event_id hash within B', () => {
    const buckets = parseWhaleBuckets('m1:4');
    const k = partitionKey('m1', 'evt-123', buckets);
    expect(k).toMatch(/^m1#[0-3]$/);
  });
  it('is stable for the same event_id', () => {
    const b = parseWhaleBuckets('m1:8');
    expect(partitionKey('m1', 'evt-x', b)).toBe(partitionKey('m1', 'evt-x', b));
  });
});
