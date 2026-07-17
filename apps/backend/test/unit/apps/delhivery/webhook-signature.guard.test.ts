import { createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../../src/config/env.schema';
import { DelhiveryWebhookSignatureGuard } from '../../../../src/modules/delhivery/guards';

const SECRET = 'delhivery-client-secret';

function makeGuard(): DelhiveryWebhookSignatureGuard {
  const config = { get: () => SECRET } as unknown as ConfigService<Env, true>;
  return new DelhiveryWebhookSignatureGuard(config);
}

function ctxFor(rawBody: Buffer, signature?: string): ExecutionContext {
  const req = {
    rawBody,
    url: '/delhivery/api/v1/oauth/webhook',
    headers: signature ? { 'x-ratio-hmac-sha256': signature } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('DelhiveryWebhookSignatureGuard', () => {
  const body = Buffer.from(JSON.stringify({ event_type: 'orders/paid', merchant_id: 'm1' }));

  it('accepts a valid HMAC-SHA256 signature (hex)', () => {
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(makeGuard().canActivate(ctxFor(body, sig))).toBe(true);
  });

  it('accepts a valid signature in base64 too', () => {
    const sig = createHmac('sha256', SECRET).update(body).digest('base64');
    expect(makeGuard().canActivate(ctxFor(body, sig))).toBe(true);
  });

  it('webhook.badHmacRejected — a forged signature throws 401', () => {
    const forged = createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    expect(() => makeGuard().canActivate(ctxFor(body, forged))).toThrow(UnauthorizedException);
  });

  it('rejects a tampered body under a previously-valid signature', () => {
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    const tampered = Buffer.from(JSON.stringify({ event_type: 'orders/paid', merchant_id: 'EVIL' }));
    expect(() => makeGuard().canActivate(ctxFor(tampered, sig))).toThrow(UnauthorizedException);
  });

  it('rejects a request with no raw body', () => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {}, url: '/x' }) }),
    } as unknown as ExecutionContext;
    expect(() => makeGuard().canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
