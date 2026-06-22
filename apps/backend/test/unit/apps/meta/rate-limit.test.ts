// apps/backend/test/unit/apps/meta/rate-limit.test.ts
import { describe, expect, it } from 'vitest';
import { CapiRateLimiter } from '../../../../src/modules/meta/capi/rate-limit';

function fakeRedis() {
  const store = new Map<string, number>();
  return {
    enabled: true,
    client: {
      async incrby(k: string, n: number) { const v = (store.get(k) ?? 0) + n; store.set(k, v); return v; },
      async expire() { return 1; },
      async get(k: string) { return store.has(k) ? String(store.get(k)) : null; },
      async set(k: string) { store.set(k, 1); return 'OK'; },
      async pexpire() { return 1; },
      async del(k: string) { store.delete(k); return 1; },
    },
  };
}

describe('CapiRateLimiter', () => {
  it('allows up to the budget then denies', async () => {
    const rl = new CapiRateLimiter(fakeRedis() as never, 1000);
    expect(await rl.take('m1', 600)).toBe(true);
    expect(await rl.take('m1', 600)).toBe(false); // 1200 > 1000
  });
  it('trips and reports the breaker', async () => {
    const rl = new CapiRateLimiter(fakeRedis() as never, 1000);
    expect(await rl.tripped('m1')).toBe(false);
    await rl.trip('m1', 30_000);
    expect(await rl.tripped('m1')).toBe(true);
  });
  it('degrades open when redis disabled (take=true, tripped=false)', async () => {
    const rl = new CapiRateLimiter({ enabled: false, client: null } as never, 1000);
    expect(await rl.take('m1', 10)).toBe(true);
    expect(await rl.tripped('m1')).toBe(false);
  });
});
