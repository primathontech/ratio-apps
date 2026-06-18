import { describe, expect, it } from 'vitest';
import {
  classifyCapiError,
  summarize,
} from '../../../src/modules/meta/capi/capi-stats.service';

describe('capi stats summarize', () => {
  it('sums daily counters into totals', () => {
    const s = summarize([
      { day: '2026-06-16', batches: 2, dispatched: 1600, failed: 0 },
      { day: '2026-06-15', batches: 1, dispatched: 800, failed: 200 },
    ]);
    expect(s.totals).toEqual({ batches: 3, dispatched: 2400, failed: 200 });
  });

  it('derives success rate = dispatched / (dispatched + failed)', () => {
    const s = summarize([{ day: '2026-06-16', batches: 1, dispatched: 900, failed: 100 }]);
    expect(s.successRate).toBe(0.9);
  });

  it('returns null success rate when there were no attempts (no 0% / NaN)', () => {
    expect(summarize([]).successRate).toBeNull();
    expect(summarize([{ day: '2026-06-16', batches: 0, dispatched: 0, failed: 0 }]).successRate).toBeNull();
  });

  it('rounds success rate to 4 decimal places', () => {
    const s = summarize([{ day: '2026-06-16', batches: 1, dispatched: 2, failed: 1 }]);
    expect(s.successRate).toBe(0.6667);
  });

  it('aggregates failures per reason (sum events, newest message, most-events first)', () => {
    const s = summarize(
      [],
      [
        { reason: 'rate_limited', events: 100, lastMessage: 'old', lastAt: 1 },
        { reason: 'rate_limited', events: 50, lastMessage: 'newer', lastAt: 2 },
        { reason: 'invalid_request', events: 300, lastMessage: 'bad param', lastAt: 5 },
      ],
    );
    expect(s.failures).toEqual([
      { reason: 'invalid_request', events: 300, lastMessage: 'bad param' },
      { reason: 'rate_limited', events: 150, lastMessage: 'newer' },
    ]);
  });
});

describe('classifyCapiError', () => {
  it.each([
    ['Meta CAPI 429 (non-retryable): rate limit', 'rate_limited'],
    ['Meta CAPI timeout after 10s', 'timeout'],
    ['Meta CAPI 400 (non-retryable): Invalid parameter user_data', 'invalid_request'],
    ['Meta CAPI 403: invalid access token', 'auth'],
    ['Meta CAPI 503: upstream', 'server_error'],
    ['something weird', 'unknown'],
  ])('classifies %j as %s', (message, reason) => {
    expect(classifyCapiError(message)).toBe(reason);
  });
});
