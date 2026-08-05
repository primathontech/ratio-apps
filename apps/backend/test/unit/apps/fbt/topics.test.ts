import { describe, expect, it } from 'vitest';
import { FBT_TOPICS } from '../../../../src/modules/fbt/webhooks/topics';

/**
 * These assertions pin the LITERAL wire values, deliberately not comparing against the
 * constant they come from.
 *
 * Why that matters: on the superseded branch every topic test asserted
 * `handler.topic === FBT_TOPICS.X`, which proves internal consistency and nothing about
 * correctness. All four values were wrong — dot-form instead of slash-form — and the
 * mistake survived a fully green suite and seven separate reviews. Only querying the
 * platform registry caught it. A literal here turns "someone edits topics.ts and every
 * test still passes" into a visible diff in this file.
 */
describe('FBT_TOPICS wire values', () => {
  it('matches the platform registry exactly', () => {
    expect(FBT_TOPICS.APP_UNINSTALLED).toBe('app/uninstalled');
    expect(FBT_TOPICS.PRODUCT_CREATED).toBe('products/create');
    expect(FBT_TOPICS.PRODUCT_UPDATED).toBe('products/update');
    expect(FBT_TOPICS.PRODUCT_DELETED).toBe('products/delete');
  });

  it('uses slash-delimited form, never the dot-form _template ships', () => {
    for (const topic of Object.values(FBT_TOPICS)) {
      expect(topic).toContain('/');
      expect(topic).not.toContain('.');
    }
  });

  it('has four distinct topics', () => {
    expect(new Set(Object.values(FBT_TOPICS)).size).toBe(4);
  });
});
