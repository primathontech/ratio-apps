import { describe, expect, it } from 'vitest';
import { dlqKey } from '../../../../src/modules/meta/capi/dlq';

describe('dlqKey', () => {
  it('builds a date-partitioned, merchant-scoped key', () => {
    const k = dlqKey('m1', Date.parse('2026-06-22T10:00:00Z'), 'abc');
    expect(k).toBe('meta-capi/2026-06-22/m1/1782122400000-abc.json');
  });
});
