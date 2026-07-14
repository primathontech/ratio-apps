import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FORMS_IDEMPOTENCY_BUCKET_MS,
  IdempotencyService,
} from '../../../../src/modules/forms/submissions/idempotency.service';
import { GOLDEN_IDEMPOTENCY } from './fixtures/submissions';

describe('IdempotencyService (AC6/F10)', () => {
  const service = new IdempotencyService();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches the golden digests (determinism, TDD §1)', () => {
    vi.setSystemTime(1_400_000_000_000);
    expect(service.computeKey('form_contact', 'sess_1')).toBe(GOLDEN_IDEMPOTENCY.session);
    expect(service.computeKey('form_contact', '203.0.113.9')).toBe(GOLDEN_IDEMPOTENCY.ipFallback);
  });

  it('collapses submissions inside the same 5s bucket (4.9s later → same key)', () => {
    vi.setSystemTime(1_400_000_000_000);
    const first = service.computeKey('form_contact', 'sess_1');
    vi.setSystemTime(1_400_000_004_900);
    expect(service.computeKey('form_contact', 'sess_1')).toBe(first);
    expect(first).toBe(GOLDEN_IDEMPOTENCY.session);
  });

  it('separates submissions across the 5s boundary (5.1s later → new key)', () => {
    vi.setSystemTime(1_400_000_005_100);
    expect(service.computeKey('form_contact', 'sess_1')).toBe(GOLDEN_IDEMPOTENCY.sessionNextBucket);
    expect(GOLDEN_IDEMPOTENCY.sessionNextBucket).not.toBe(GOLDEN_IDEMPOTENCY.session);
  });

  it('varies by form and by session', () => {
    vi.setSystemTime(1_400_000_000_000);
    const base = service.computeKey('form_contact', 'sess_1');
    expect(service.computeKey('form_other', 'sess_1')).not.toBe(base);
    expect(service.computeKey('form_contact', 'sess_2')).not.toBe(base);
  });

  it('accepts an explicit clock (bucket size respected)', () => {
    const now = 1_400_000_000_000;
    expect(service.computeKey('f', 's', now)).toBe(
      service.computeKey('f', 's', now + FORMS_IDEMPOTENCY_BUCKET_MS - 1),
    );
    expect(service.computeKey('f', 's', now)).not.toBe(
      service.computeKey('f', 's', now + FORMS_IDEMPOTENCY_BUCKET_MS),
    );
  });

  describe('isDuplicateKeyError (UNIQUE violation → duplicate, not 500)', () => {
    it('recognizes mysql2 ER_DUP_ENTRY / errno 1062', () => {
      expect(service.isDuplicateKeyError({ code: 'ER_DUP_ENTRY' })).toBe(true);
      expect(service.isDuplicateKeyError({ errno: 1062 })).toBe(true);
    });

    it('rejects everything else', () => {
      expect(service.isDuplicateKeyError(new Error('boom'))).toBe(false);
      expect(service.isDuplicateKeyError({ code: 'ER_LOCK_DEADLOCK' })).toBe(false);
      expect(service.isDuplicateKeyError(null)).toBe(false);
      expect(service.isDuplicateKeyError('ER_DUP_ENTRY')).toBe(false);
    });
  });
});
