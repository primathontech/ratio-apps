import { createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createWebhookSignatureGuard } from '../../../src/core/webhooks/webhook-signature.guard';

const SECRET = 'test-secret-32-bytes-aaaaaaaaaaaaaaaaaa';

function sign(rawBody: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

function makeCtx(req: {
  rawBody?: Buffer | string;
  headers: Record<string, string | undefined>;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T = unknown>() => req as unknown as T,
      getResponse: <T = unknown>() => ({}) as T,
      getNext: <T = unknown>() => ({}) as T,
    }),
  } as unknown as ExecutionContext;
}

describe('createWebhookSignatureGuard', () => {
  const body = '{"hello":"world"}';

  it('returns true when HMAC signature is valid', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-openstore-signature': sign(body) },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException with WEBHOOK_BAD_SIGNATURE when header is missing', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({ rawBody: body, headers: {} });
    try {
      guard.canActivate(ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      const resp = (e as UnauthorizedException).getResponse() as { error_code?: string };
      expect(resp.error_code).toBe('WEBHOOK_BAD_SIGNATURE');
    }
  });

  it('throws UnauthorizedException when signature is wrong (right shape, wrong digest)', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const wrong = `sha256=${'a'.repeat(64)}`;
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-openstore-signature': wrong },
    });
    try {
      guard.canActivate(ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      const resp = (e as UnauthorizedException).getResponse() as { error_code?: string };
      expect(resp.error_code).toBe('WEBHOOK_BAD_SIGNATURE');
    }
  });

  it('throws when header is missing the sha256= prefix', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const stripped = sign(body).slice('sha256='.length);
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-openstore-signature': stripped },
    });
    try {
      guard.canActivate(ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      const resp = (e as UnauthorizedException).getResponse() as { error_code?: string };
      expect(resp.error_code).toBe('WEBHOOK_BAD_SIGNATURE');
    }
  });

  it('throws WEBHOOK_NO_RAW_BODY when rawBody is missing', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({
      headers: { 'x-openstore-signature': sign(body) },
    });
    try {
      guard.canActivate(ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      const resp = (e as UnauthorizedException).getResponse() as { error_code?: string };
      expect(resp.error_code).toBe('WEBHOOK_NO_RAW_BODY');
    }
  });

  it('throws WEBHOOK_BAD_SIGNATURE (NOT 500) when header contains non-hex chars (finding #5)', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    // 64 chars, correct length, but full of non-hex garbage. The naive
    // Buffer.from('zzzz...', 'hex') silently truncates to a zero-length
    // buffer; timingSafeEqual on mismatched sizes would otherwise RangeError
    // and produce a 500. The guard MUST translate this to 401.
    const badHex = `sha256=${'z'.repeat(64)}`;
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-openstore-signature': badHex },
    });
    try {
      guard.canActivate(ctx);
      throw new Error('expected throw');
    } catch (e) {
      // Critically, NOT a RangeError. Must be the typed 401.
      expect(e).toBeInstanceOf(UnauthorizedException);
      const resp = (e as UnauthorizedException).getResponse() as { error_code?: string };
      expect(resp.error_code).toBe('WEBHOOK_BAD_SIGNATURE');
    }
  });

  it('throws WEBHOOK_BAD_SIGNATURE when header has partial non-hex (mid-string garbage)', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    // First 60 chars valid hex, last 4 garbage. Buffer.from truncates at the
    // first non-hex char, giving a 30-byte buffer instead of 32. Without the
    // length re-check this would crash inside timingSafeEqual.
    const tampered = `sha256=${`${'a'.repeat(60)}zzzz`}`;
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-openstore-signature': tampered },
    });
    try {
      guard.canActivate(ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      const resp = (e as UnauthorizedException).getResponse() as { error_code?: string };
      expect(resp.error_code).toBe('WEBHOOK_BAD_SIGNATURE');
    }
  });
});
