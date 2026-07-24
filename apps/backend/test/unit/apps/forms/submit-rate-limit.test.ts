import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FORMS_SUBMIT_RATE_LIMIT,
  FORMS_SUBMIT_RATE_WINDOW_MS,
  SubmitRateLimitService,
} from '../../../../src/modules/forms/spam/submit-rate-limit.service';
import { FakeRedis } from './fixtures/fakes';

/** PRD F14 / AC6: 5 submissions per 10 minutes per (form, IP), sliding window. */
describe('SubmitRateLimitService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('redis-backed window', () => {
    it('allows the first 5 and rejects the 6th submission in the window', async () => {
      const service = new SubmitRateLimitService(new FakeRedis());
      for (let i = 0; i < FORMS_SUBMIT_RATE_LIMIT; i++) {
        expect(await service.allow('form_contact', '203.0.113.9')).toBe(true);
      }
      expect(await service.allow('form_contact', '203.0.113.9')).toBe(false);
    });

    it('slides: submissions older than 10 minutes fall out of the window (fake timers)', async () => {
      const service = new SubmitRateLimitService(new FakeRedis());
      for (let i = 0; i < FORMS_SUBMIT_RATE_LIMIT; i++) {
        await service.allow('form_contact', '203.0.113.9');
      }
      expect(await service.allow('form_contact', '203.0.113.9')).toBe(false);

      vi.advanceTimersByTime(FORMS_SUBMIT_RATE_WINDOW_MS + 1);
      expect(await service.allow('form_contact', '203.0.113.9')).toBe(true);
    });

    it('scopes keys to (form, IP): another form or another IP is not counted together', async () => {
      const service = new SubmitRateLimitService(new FakeRedis());
      for (let i = 0; i < FORMS_SUBMIT_RATE_LIMIT; i++) {
        await service.allow('form_contact', '203.0.113.9');
      }
      expect(await service.allow('form_contact', '203.0.113.9')).toBe(false);
      // Same IP, different form → its own bucket.
      expect(await service.allow('form_other', '203.0.113.9')).toBe(true);
      // Same form, different IP → its own bucket.
      expect(await service.allow('form_contact', '198.51.100.1')).toBe(true);
    });

    it('fails OPEN when redis errors (availability over strictness)', async () => {
      const broken = {
        zremrangebyscore: async () => {
          throw new Error('redis down');
        },
        zcard: async () => 0,
        zadd: async () => 0,
        expire: async () => 0,
      };
      const service = new SubmitRateLimitService(broken);
      expect(await service.allow('form_contact', '203.0.113.9')).toBe(true);
    });
  });

  describe('in-memory fallback (REDIS_URL unset)', () => {
    const savedUrl = process.env.REDIS_URL;

    beforeEach(() => {
      delete process.env.REDIS_URL;
    });

    afterEach(() => {
      if (savedUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = savedUrl;
    });

    it('enforces the same 5-per-10-min sliding window per (form, IP)', async () => {
      const service = new SubmitRateLimitService();
      for (let i = 0; i < FORMS_SUBMIT_RATE_LIMIT; i++) {
        expect(await service.allow('form_contact', '203.0.113.9')).toBe(true);
      }
      expect(await service.allow('form_contact', '203.0.113.9')).toBe(false);
      expect(await service.allow('form_other', '203.0.113.9')).toBe(true);

      vi.advanceTimersByTime(FORMS_SUBMIT_RATE_WINDOW_MS + 1);
      expect(await service.allow('form_contact', '203.0.113.9')).toBe(true);
    });
  });
});
