import { describe, expect, it } from 'vitest';
import { ClaimSignatureService } from '../../../../src/modules/loyalty/qr/claim-signature.service';

const SECRET = 'test-secret-value';
const base = { merchantId: 'm1', qr: 'CODE1', phone: '+919876543210' };
const svc = new ClaimSignatureService();

function signed(ts: number) {
  return ClaimSignatureService.sign({ ...base, ts }, SECRET);
}

describe('ClaimSignatureService', () => {
  it('accepts a valid, fresh signature', () => {
    const ts = Date.now();
    expect(svc.verify({ ...base, ts, sig: signed(ts), secret: SECRET })).toBe('ok');
  });

  it('rejects a tampered field (phone)', () => {
    const ts = Date.now();
    expect(
      svc.verify({ ...base, phone: '+910000000000', ts, sig: signed(ts), secret: SECRET }),
    ).toBe('bad_signature');
  });

  it('rejects a signature made with a different secret', () => {
    const ts = Date.now();
    const otherSig = ClaimSignatureService.sign({ ...base, ts }, 'other-secret');
    expect(svc.verify({ ...base, ts, sig: otherSig, secret: SECRET })).toBe('bad_signature');
  });

  it('rejects a stale timestamp (> 5 min)', () => {
    const ts = Date.now() - 6 * 60 * 1000;
    expect(svc.verify({ ...base, ts, sig: signed(ts), secret: SECRET })).toBe('stale');
  });

  it('rejects a future-skewed timestamp (> 5 min ahead)', () => {
    const ts = Date.now() + 6 * 60 * 1000;
    expect(svc.verify({ ...base, ts, sig: signed(ts), secret: SECRET })).toBe('stale');
  });

  it('rejects a malformed-length sig without throwing', () => {
    const ts = Date.now();
    expect(svc.verify({ ...base, ts, sig: 'short', secret: SECRET })).toBe('bad_signature');
  });
});
