import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CapiHmacGuard } from '../../../../src/modules/meta/capi/capi-hmac.guard';

const SECRET = 'test-capi-hmac-secret';

function currentWindow(): number {
  return Math.floor(Date.now() / 300000);
}

function computeSig(ts: number, secret = SECRET): string {
  return createHmac('sha256', secret).update(String(ts)).digest('hex');
}

function makeCtx(body: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T = unknown>() => ({ body } as unknown as T),
    }),
  } as unknown as ExecutionContext;
}

describe('CapiHmacGuard', () => {
  const origSecret = process.env.RATIO_META_CAPI_HMAC_SECRET;

  beforeEach(() => {
    process.env.RATIO_META_CAPI_HMAC_SECRET = SECRET;
  });

  afterEach(() => {
    if (origSecret === undefined) {
      delete process.env.RATIO_META_CAPI_HMAC_SECRET;
    } else {
      process.env.RATIO_META_CAPI_HMAC_SECRET = origSecret;
    }
  });

  it('passes for valid signature in current window', () => {
    const ts = currentWindow();
    const guard = new CapiHmacGuard();
    const ctx = makeCtx({ _ts: ts, _sig: computeSig(ts) });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('passes for valid signature in previous window', () => {
    const ts = currentWindow() - 1;
    const guard = new CapiHmacGuard();
    const ctx = makeCtx({ _ts: ts, _sig: computeSig(ts) });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws 401 for expired signature (window - 2)', () => {
    const ts = currentWindow() - 2;
    const guard = new CapiHmacGuard();
    const ctx = makeCtx({ _ts: ts, _sig: computeSig(ts) });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 for wrong signature (tampered)', () => {
    const ts = currentWindow();
    const guard = new CapiHmacGuard();
    const ctx = makeCtx({ _ts: ts, _sig: 'a'.repeat(64) });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('passes when no _ts/_sig and no secret configured (backward-compat)', () => {
    delete process.env.RATIO_META_CAPI_HMAC_SECRET;
    const guard = new CapiHmacGuard();
    const ctx = makeCtx({ events: [] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws 401 when no _ts/_sig but secret IS configured', () => {
    const guard = new CapiHmacGuard();
    const ctx = makeCtx({ events: [] });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
