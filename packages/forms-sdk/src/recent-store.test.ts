import { beforeEach, describe, expect, it } from 'vitest';
import { RecentStore } from './recent-store';

describe('RecentStore', () => {
  beforeEach(() => localStorage.clear());

  it('lists most-recent-first, deduped case-insensitively, capped at 8', () => {
    const s = new RecentStore('store1');
    s.add('creatine');
    s.add('bcaa');
    s.add('Creatine'); // dedupe (case-insensitive) -> moves to front as 'Creatine'
    expect(s.list()).toEqual(['Creatine', 'bcaa']);
    for (let i = 0; i < 10; i++) s.add(`q${i}`);
    expect(s.list()).toHaveLength(8);
    expect(s.list()[0]).toBe('q9');
  });

  it('persists across instances sharing the same storeId key', () => {
    new RecentStore('store1').add('protein');
    expect(new RecentStore('store1').list()).toEqual(['protein']);
  });

  it('remove and clear work', () => {
    const s = new RecentStore('store1');
    s.add('a');
    s.add('b');
    s.remove('a');
    expect(s.list()).toEqual(['b']);
    s.clear();
    expect(s.list()).toEqual([]);
  });

  it('ignores blank queries', () => {
    const s = new RecentStore('store1');
    s.add('   ');
    expect(s.list()).toEqual([]);
  });
});
