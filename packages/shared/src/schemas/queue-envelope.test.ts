import { describe, expect, it } from 'vitest';
import {
  parseEnvelope,
  QUEUE_ENVELOPE_VERSION,
  withNextAttempt,
  wrapEnvelope,
} from './queue-envelope';

describe('queue envelope', () => {
  it('wraps a payload with version, attempt 0, and the given enqueuedAt', () => {
    expect(wrapEnvelope({ a: 1 }, '2026-01-01T00:00:00.000Z')).toEqual({
      v: QUEUE_ENVELOPE_VERSION,
      attempt: 0,
      enqueuedAt: '2026-01-01T00:00:00.000Z',
      payload: { a: 1 },
    });
  });

  it('round-trips through JSON via parseEnvelope', () => {
    const raw = JSON.stringify(wrapEnvelope({ x: 'y' }, '2026-01-01T00:00:00.000Z', 2));
    expect(parseEnvelope(raw)).toMatchObject({ v: 1, attempt: 2, payload: { x: 'y' } });
  });

  it('parseEnvelope returns null for malformed JSON', () => {
    expect(parseEnvelope('not json')).toBeNull();
  });

  it('parseEnvelope returns null for a non-conforming shape (missing fields / wrong version)', () => {
    expect(parseEnvelope(JSON.stringify({ attempt: 0 }))).toBeNull();
    expect(
      parseEnvelope(JSON.stringify({ v: 99, attempt: 0, enqueuedAt: 'x', payload: 1 })),
    ).toBeNull();
  });

  it('withNextAttempt increments attempt without mutating the original', () => {
    const e = wrapEnvelope('p', 'x', 1);
    expect(withNextAttempt(e).attempt).toBe(2);
    expect(e.attempt).toBe(1);
  });
});
