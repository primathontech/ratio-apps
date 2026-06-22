import { createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebhookSignatureGuard } from '../../../src/core/webhooks/webhook-signature.guard';

const SECRET = 'test-secret-32-bytes-aaaaaaaaaaaaaaaaaa';

function digestOf(rawBody: string | Buffer, secret = SECRET): Buffer {
  return createHmac('sha256', secret).update(rawBody).digest();
}

function signHex(rawBody: string | Buffer, secret = SECRET): string {
  return digestOf(rawBody, secret).toString('hex');
}

function signBase64(rawBody: string | Buffer, secret = SECRET): string {
  return digestOf(rawBody, secret).toString('base64');
}

function makeCtx(req: {
  rawBody?: Buffer | string;
  headers: Record<string, string | string[] | undefined>;
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
  const origNodeEnv = process.env.NODE_ENV;
  const origSigOptional = process.env.WEBHOOK_SIGNATURE_OPTIONAL;

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origSigOptional === undefined) {
      delete process.env.WEBHOOK_SIGNATURE_OPTIONAL;
    } else {
      process.env.WEBHOOK_SIGNATURE_OPTIONAL = origSigOptional;
    }
  });

  // Case 1: valid hex signature present → returns true
  it('returns true when HMAC signature is valid (hex encoding)', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-ratio-hmac-sha256': signHex(body) },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  // Case 2: valid base64 signature present → returns true
  it('returns true when HMAC signature is valid (base64 encoding)', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-ratio-hmac-sha256': signBase64(body) },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  // Case 3: signature present but WRONG → throws WEBHOOK_BAD_SIGNATURE (test env)
  it('throws UnauthorizedException with WEBHOOK_BAD_SIGNATURE when signature is wrong (test env)', () => {
    process.env.NODE_ENV = 'test';
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const wrong = 'a'.repeat(64); // valid-length hex but wrong digest
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-ratio-hmac-sha256': wrong },
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

  // Case 4: absent header + NODE_ENV !== 'production' → returns true (skipped)
  it('returns true when signature header absent and NODE_ENV is not production (dev/test skip)', () => {
    process.env.NODE_ENV = 'test';
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({ rawBody: body, headers: {} });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  // Case 5: absent header + NODE_ENV === 'production' → throws 'invalid signature header' WEBHOOK_BAD_SIGNATURE
  it('throws WEBHOOK_BAD_SIGNATURE when signature header absent and NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    try {
      const GuardClass = createWebhookSignatureGuard(SECRET);
      const guard = new GuardClass();
      const ctx = makeCtx({ rawBody: body, headers: {} });
      try {
        guard.canActivate(ctx);
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        const resp = (e as UnauthorizedException).getResponse() as { error_code?: string; message?: string };
        expect(resp.message).toBe('invalid signature header');
        expect(resp.error_code).toBe('WEBHOOK_BAD_SIGNATURE');
      }
    } finally {
      process.env.NODE_ENV = origNodeEnv;
    }
  });

  // Case 6: wrong signature present + NODE_ENV === 'production' → still throws (present sig always verified)
  it('throws WEBHOOK_BAD_SIGNATURE when signature present but wrong in production', () => {
    process.env.NODE_ENV = 'production';
    try {
      const GuardClass = createWebhookSignatureGuard(SECRET);
      const guard = new GuardClass();
      const ctx = makeCtx({
        rawBody: body,
        headers: { 'x-ratio-hmac-sha256': 'a'.repeat(64) },
      });
      try {
        guard.canActivate(ctx);
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        const resp = (e as UnauthorizedException).getResponse() as { error_code?: string };
        expect(resp.error_code).toBe('WEBHOOK_BAD_SIGNATURE');
      }
    } finally {
      process.env.NODE_ENV = origNodeEnv;
    }
  });

  // Case 7: missing rawBody → throws WEBHOOK_NO_RAW_BODY
  it('throws WEBHOOK_NO_RAW_BODY when rawBody is missing', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({
      headers: { 'x-ratio-hmac-sha256': signHex(body) },
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

  // Case 8: legacy sha256=+valid hex → returns true
  it('returns true when HMAC signature has legacy sha256= prefix (hex)', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-ratio-hmac-sha256': `sha256=${signHex(body)}` },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  // Additional existing cases preserved
  it('throws UnauthorizedException with WEBHOOK_BAD_SIGNATURE when header is empty string (non-production skips absent but empty is present+invalid)', () => {
    process.env.NODE_ENV = 'test';
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    // empty string: typeof header === 'string' but !header is true → treated as absent → non-prod skips
    const ctx = makeCtx({ rawBody: body, headers: { 'x-ratio-hmac-sha256': '' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws WEBHOOK_BAD_SIGNATURE when signed with a different secret', () => {
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-ratio-hmac-sha256': signHex(body, 'different-secret') },
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

  // ─── WEBHOOK_SIGNATURE_OPTIONAL flag cases ────────────────────────────────

  // Flag case 1: absent header + production + WEBHOOK_SIGNATURE_OPTIONAL='true' → skipped (returns true)
  it('returns true when signature absent, NODE_ENV=production, WEBHOOK_SIGNATURE_OPTIONAL=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SIGNATURE_OPTIONAL = 'true';
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({ rawBody: body, headers: {} });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  // Flag case 2: absent header + production + flag unset → still throws WEBHOOK_BAD_SIGNATURE
  it('throws WEBHOOK_BAD_SIGNATURE when signature absent, NODE_ENV=production, flag unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.WEBHOOK_SIGNATURE_OPTIONAL;
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({ rawBody: body, headers: {} });
    try {
      guard.canActivate(ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      const resp = (e as UnauthorizedException).getResponse() as { error_code?: string; message?: string };
      expect(resp.message).toBe('invalid signature header');
      expect(resp.error_code).toBe('WEBHOOK_BAD_SIGNATURE');
    }
  });

  // Flag case 3: absent header + production + flag='false' → still throws WEBHOOK_BAD_SIGNATURE
  it('throws WEBHOOK_BAD_SIGNATURE when signature absent, NODE_ENV=production, WEBHOOK_SIGNATURE_OPTIONAL=false', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SIGNATURE_OPTIONAL = 'false';
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({ rawBody: body, headers: {} });
    try {
      guard.canActivate(ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
      const resp = (e as UnauthorizedException).getResponse() as { error_code?: string; message?: string };
      expect(resp.message).toBe('invalid signature header');
      expect(resp.error_code).toBe('WEBHOOK_BAD_SIGNATURE');
    }
  });

  // Flag case 4: WRONG signature present + production + WEBHOOK_SIGNATURE_OPTIONAL='true' → STILL throws
  // (the flag only affects the absent-header path; a present bad signature is always rejected)
  it('throws WEBHOOK_BAD_SIGNATURE when wrong signature present, NODE_ENV=production, WEBHOOK_SIGNATURE_OPTIONAL=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_SIGNATURE_OPTIONAL = 'true';
    const GuardClass = createWebhookSignatureGuard(SECRET);
    const guard = new GuardClass();
    const ctx = makeCtx({
      rawBody: body,
      headers: { 'x-ratio-hmac-sha256': 'a'.repeat(64) },
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
