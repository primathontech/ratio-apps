import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const TS_WINDOW_MS = 5 * 60 * 1000;

export interface ClaimSignaturePayload {
  merchantId: string;
  qr: string;
  phone: string;
  ts: number;
}

/**
 * Verifies the per-merchant HMAC that attests a QR-claim phone. The storefront
 * BFF signs `${merchantId}.${qr}.${phone}.${ts}` with the merchant's claim
 * secret; we recompute and constant-time compare. No KwikPass/GoKwik here.
 */
@Injectable()
export class ClaimSignatureService {
  static sign(payload: ClaimSignaturePayload, secret: string): string {
    const msg = `${payload.merchantId}.${payload.qr}.${payload.phone}.${payload.ts}`;
    return createHmac('sha256', secret).update(msg).digest('hex');
  }

  verify(input: ClaimSignaturePayload & { sig: string; secret: string }): 'ok' | 'bad_signature' | 'stale' {
    const expected = ClaimSignatureService.sign(input, input.secret);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(input.sig, 'utf8');
    // Length-guard BEFORE timingSafeEqual (it throws on length mismatch).
    if (a.length !== b.length || !timingSafeEqual(a, b)) return 'bad_signature';
    if (Math.abs(Date.now() - input.ts) > TS_WINDOW_MS) return 'stale';
    return 'ok';
  }
}
