import { describe, expect, it } from 'vitest';
import { aggregate } from '../../../../src/core/stream/aggregation';

describe('aggregate', () => {
  it('chunks into groups of at most max', () => {
    expect(aggregate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('returns [] for empty input', () => {
    expect(aggregate([], 100)).toEqual([]);
  });
});
