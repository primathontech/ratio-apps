import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import { FormsRecaptchaService } from '../../../../src/modules/forms/spam/recaptcha.service';
import { fakeRecaptchaFetch } from './fixtures/fakes';

const MERCHANT_SECRET = 'merchant-secret-6Lxyz';
const SHARED_SECRET = 'shared-env-secret-6Labc';

const crypto = {
  decrypt: (ciphertext: string) => {
    if (ciphertext !== 'enc:merchant') throw new Error('bad ciphertext');
    return MERCHANT_SECRET;
  },
} as unknown as CryptoService;

function makeService(script: Parameters<typeof fakeRecaptchaFetch>[0]) {
  const { fetch, calls } = fakeRecaptchaFetch(script);
  return { service: new FormsRecaptchaService(crypto, fetch), calls };
}

const merchantConfig = { recaptchaSecretEnc: 'enc:merchant', recaptchaThreshold: '0.30' };

describe('FormsRecaptchaService (AC6, PRD F7/F8)', () => {
  const savedShared = process.env.FORMS_RECAPTCHA_SHARED_SECRET;

  beforeEach(() => {
    delete process.env.FORMS_RECAPTCHA_SHARED_SECRET;
  });

  afterEach(() => {
    if (savedShared === undefined) delete process.env.FORMS_RECAPTCHA_SHARED_SECRET;
    else process.env.FORMS_RECAPTCHA_SHARED_SECRET = savedShared;
    vi.restoreAllMocks();
  });

  it('passes when the score meets the threshold', async () => {
    const { service } = makeService(() => ({
      ok: true,
      status: 200,
      body: { success: true, score: 0.9 },
    }));
    const result = await service.verify('tok', merchantConfig);
    expect(result).toEqual({ verdict: 'pass', score: 0.9 });
  });

  it('rejects when the score is below the threshold (silent reject upstream)', async () => {
    const { service } = makeService(() => ({
      ok: true,
      status: 200,
      body: { success: true, score: 0.1 },
    }));
    const result = await service.verify('tok', merchantConfig);
    expect(result).toEqual({ verdict: 'reject', score: 0.1 });
  });

  it('reads the threshold from config and defaults to 0.30 when unset', async () => {
    const { service: strict } = makeService(() => ({
      ok: true,
      status: 200,
      body: { success: true, score: 0.5 },
    }));
    expect(
      (await strict.verify('tok', { ...merchantConfig, recaptchaThreshold: '0.70' })).verdict,
    ).toBe('reject');

    const { service: defaulted } = makeService(() => ({
      ok: true,
      status: 200,
      body: { success: true, score: 0.31 },
    }));
    expect(
      (await defaulted.verify('tok', { ...merchantConfig, recaptchaThreshold: null })).verdict,
    ).toBe('pass');
  });

  it('rejects a missing token (bot-shaped, not an outage)', async () => {
    const { service, calls } = makeService(() => ({ ok: true, status: 200 }));
    expect((await service.verify(undefined, merchantConfig)).verdict).toBe('reject');
    expect(calls).toHaveLength(0);
  });

  it('rejects an invalid/expired token (success:false)', async () => {
    const { service } = makeService(() => ({
      ok: true,
      status: 200,
      body: { success: false },
    }));
    expect((await service.verify('tok', merchantConfig)).verdict).toBe('reject');
  });

  it('uses the merchant secret when set', async () => {
    const { service, calls } = makeService(() => ({
      ok: true,
      status: 200,
      body: { success: true, score: 0.9 },
    }));
    await service.verify('tok', merchantConfig);
    expect(calls[0]?.body).toContain(encodeURIComponent(MERCHANT_SECRET));
  });

  it('falls back to the shared env secret when the merchant has none', async () => {
    process.env.FORMS_RECAPTCHA_SHARED_SECRET = SHARED_SECRET;
    const { service, calls } = makeService(() => ({
      ok: true,
      status: 200,
      body: { success: true, score: 0.9 },
    }));
    await service.verify('tok', { recaptchaSecretEnc: null, recaptchaThreshold: '0.30' });
    expect(calls[0]?.body).toContain(encodeURIComponent(SHARED_SECRET));
  });

  it('is unavailable when no merchant secret and no shared secret exist', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { service, calls } = makeService(() => ({ ok: true, status: 200 }));
    const result = await service.verify('tok', {
      recaptchaSecretEnc: null,
      recaptchaThreshold: '0.30',
    });
    expect(result.verdict).toBe('unavailable');
    expect(calls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it('siteverify unreachable → unavailable + warning log (honeypot fallback, F8)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { service } = makeService(() => 'network-error');
    const result = await service.verify('tok', merchantConfig);
    expect(result.verdict).toBe('unavailable');
    expect(warn).toHaveBeenCalled();
  });

  it('siteverify non-OK HTTP response → unavailable', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { service } = makeService(() => ({ ok: false, status: 503 }));
    expect((await service.verify('tok', merchantConfig)).verdict).toBe('unavailable');
  });

  it('never logs the secret or the token (redaction spy)', async () => {
    const logged: unknown[] = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    // Exercise every code path that logs: no-secret, outage, non-OK.
    const { service: noSecret } = makeService(() => ({ ok: true, status: 200 }));
    await noSecret.verify('tok-SENSITIVE', { recaptchaSecretEnc: null, recaptchaThreshold: null });
    const { service: outage } = makeService(() => 'network-error');
    await outage.verify('tok-SENSITIVE', merchantConfig);
    const { service: nonOk } = makeService(() => ({ ok: false, status: 500 }));
    await nonOk.verify('tok-SENSITIVE', merchantConfig);

    const allLogs = JSON.stringify(logged);
    expect(allLogs).not.toContain(MERCHANT_SECRET);
    expect(allLogs).not.toContain('tok-SENSITIVE');
  });
});
