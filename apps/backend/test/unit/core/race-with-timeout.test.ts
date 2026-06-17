import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { raceWithTimeout } from '../../../src/core/common/race-with-timeout';

describe('raceWithTimeout', () => {
  it('resolves with the promise value when it settles before the timeout', async () => {
    const result = await raceWithTimeout(Promise.resolve('ok'), 1000, 'timeout');
    expect(result).toBe('ok');
  });

  it('propagates the underlying promise rejection (not the timeout error)', async () => {
    const boom = new Error('underlying failure');
    await expect(raceWithTimeout(Promise.reject(boom), 1000, 'timeout')).rejects.toBe(boom);
  });

  it('rejects with the timeout error when the promise hangs past timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      // A promise that never resolves on its own.
      const pending = new Promise<string>(() => {
        /* never settles */
      });
      const racing = raceWithTimeout(pending, 50, 'probe timeout');
      // Attach the assertion (and its rejection handler) BEFORE advancing
      // the fake clock. Otherwise the timer fires inside `advanceTimersByTimeAsync`
      // and vitest flags the not-yet-awaited rejection as unhandled.
      const assertion = expect(racing).rejects.toThrow('probe timeout');
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  describe('timer cleanup', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears the pending timer after the promise resolves fast (no dangling timers)', async () => {
      const racing = raceWithTimeout(Promise.resolve(42), 60_000, 'timeout');
      await expect(racing).resolves.toBe(42);
      // If the timer wasn't cleared, vitest's fake timer queue would still
      // have it pending. After settle, there must be zero pending timers.
      expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the timer after the promise rejects fast', async () => {
      const racing = raceWithTimeout(Promise.reject(new Error('nope')), 60_000, 'timeout');
      await expect(racing).rejects.toThrow('nope');
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
