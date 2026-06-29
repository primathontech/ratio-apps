import { beforeEach, describe, expect, it } from 'vitest';
import { getAnonId } from './anon-id';

describe('getAnonId', () => {
  beforeEach(() => localStorage.clear());

  it('returns a stable wz_ id across calls', () => {
    const a = getAnonId();
    const b = getAnonId();
    expect(a).toBe(b);
    expect(a).toMatch(/^wz_[a-z0-9]+$/);
  });

  it('persists to localStorage', () => {
    const a = getAnonId();
    expect(localStorage.getItem('wizzy:uid')).toBe(a);
  });
});
