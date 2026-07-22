import { randomBytes } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { FormsConfigInput } from '@ratio-app/shared/schemas/forms-config';
import { describe, expect, it, vi } from 'vitest';
import { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import { FormsConfigService } from '../../../../src/modules/forms/config/config.service';
import type { FormsConfigRow, FormsDatabase } from '../../../../src/modules/forms/db/types';

/** Fake `handle.db` implementing exactly the chains the config service touches. */
function makeFakeHandle(init: { configRow?: Partial<FormsConfigRow> } = {}): {
  handle: KyselyClient<FormsDatabase>;
  recorder: { insertedValues?: Record<string, unknown>; onDup?: Record<string, unknown> };
} {
  const recorder: { insertedValues?: Record<string, unknown>; onDup?: Record<string, unknown> } =
    {};
  const selectChain = {
    selectAll: () => selectChain,
    select: () => selectChain,
    where: () => selectChain,
    limit: () => selectChain,
    executeTakeFirst: async () => init.configRow,
  };
  const insertChain = {
    values: (v: Record<string, unknown>) => {
      recorder.insertedValues = v;
      return insertChain;
    },
    onDuplicateKeyUpdate: (u: Record<string, unknown>) => {
      recorder.onDup = u;
      return insertChain;
    },
    execute: async () => [],
  };
  const db = {
    selectFrom: () => selectChain,
    insertInto: () => insertChain,
  };
  return { handle: { db } as unknown as KyselyClient<FormsDatabase>, recorder };
}

const crypto = new CryptoService(randomBytes(32));

const fullInput: FormsConfigInput = {
  recaptchaSiteKey: '6LcSiteKeyExample',
  recaptchaSecret: 'recaptcha-secret-xyz',
  recaptchaThreshold: 0.45,
  defaultNotificationEmail: 'owner@merchant.example',
  formsEnabled: true,
};

describe('FormsConfigService (AC12)', () => {
  it('upsert encrypts recaptcha_secret — CryptoService spied, stored ≠ plaintext, round-trips', async () => {
    const { handle, recorder } = makeFakeHandle();
    const encryptSpy = vi.spyOn(crypto, 'encrypt');
    const service = new FormsConfigService(handle, crypto);

    const saved = await service.upsert('mer_1', fullInput);

    expect(encryptSpy).toHaveBeenCalledWith('recaptcha-secret-xyz');
    const stored = recorder.insertedValues?.recaptchaSecretEnc as string;
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('recaptcha-secret-xyz');
    expect(JSON.stringify(recorder.insertedValues)).not.toContain('recaptcha-secret-xyz');
    expect(JSON.stringify(recorder.onDup)).not.toContain('recaptcha-secret-xyz');
    expect(crypto.decrypt(stored)).toBe('recaptcha-secret-xyz');
    // The response is the GET shape — flag only, never the secret.
    expect(saved.hasRecaptchaSecret).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('recaptcha-secret-xyz');
    expect(JSON.stringify(saved)).not.toContain(stored);
    encryptSpy.mockRestore();
  });

  it('get returns hasRecaptchaSecret and never the secret (plaintext or ciphertext)', async () => {
    const secretEnc = crypto.encrypt('recaptcha-secret-xyz');
    const { handle } = makeFakeHandle({
      configRow: {
        merchantId: 'mer_1',
        recaptchaSiteKey: '6LcSiteKeyExample',
        recaptchaSecretEnc: secretEnc,
        recaptchaThreshold: '0.30' as unknown as number, // mysql2 DECIMAL → string
        defaultNotificationEmail: 'owner@merchant.example',
        emailBounced: 0 as unknown as boolean,
        formsEnabled: 1 as unknown as boolean,
      },
    });
    const service = new FormsConfigService(handle, crypto);

    const config = await service.getByMerchantId('mer_1');

    expect(config.hasRecaptchaSecret).toBe(true);
    expect('recaptchaSecret' in config).toBe(false);
    expect(JSON.stringify(config)).not.toContain('recaptcha-secret-xyz');
    expect(JSON.stringify(config)).not.toContain(secretEnc);
  });

  it('blank secret in payload leaves the stored ciphertext untouched (no re-encrypt)', async () => {
    const storedEnc = crypto.encrypt('previously-stored-secret');
    const { handle, recorder } = makeFakeHandle({
      configRow: { merchantId: 'mer_1', recaptchaSecretEnc: storedEnc },
    });
    const encryptSpy = vi.spyOn(crypto, 'encrypt');
    const service = new FormsConfigService(handle, crypto);

    const saved = await service.upsert('mer_1', { ...fullInput, recaptchaSecret: '' });

    expect(encryptSpy).not.toHaveBeenCalled();
    expect(recorder.insertedValues?.recaptchaSecretEnc).toBe(storedEnc);
    expect(recorder.onDup?.recaptchaSecretEnc).toBe(storedEnc);
    expect(saved.hasRecaptchaSecret).toBe(true);
    encryptSpy.mockRestore();
  });

  it('absent secret with nothing stored stays unset (shared Ratio key mode)', async () => {
    const { handle, recorder } = makeFakeHandle();
    const service = new FormsConfigService(handle, crypto);

    const { recaptchaSecret: _s, ...noSecret } = fullInput;
    const saved = await service.upsert('mer_1', noSecret);

    expect(recorder.insertedValues?.recaptchaSecretEnc).toBeNull();
    expect(saved.hasRecaptchaSecret).toBe(false);
  });

  it('get coerces TINYINT booleans and the DECIMAL threshold string', async () => {
    const { handle } = makeFakeHandle({
      configRow: {
        merchantId: 'mer_1',
        recaptchaSiteKey: null,
        recaptchaSecretEnc: null,
        recaptchaThreshold: '0.30' as unknown as number,
        defaultNotificationEmail: null,
        emailBounced: 1 as unknown as boolean,
        formsEnabled: 0 as unknown as boolean,
      },
    });
    const service = new FormsConfigService(handle, crypto);

    const config = await service.getByMerchantId('mer_1');

    expect(config.formsEnabled).toBe(false);
    expect(config.emailBounced).toBe(true);
    expect(config.recaptchaThreshold).toBe(0.3);
    expect(config.hasRecaptchaSecret).toBe(false);
  });

  it('upsert fills defaults (threshold 0.30, formsEnabled true) and echoes the saved shape', async () => {
    const { handle, recorder } = makeFakeHandle();
    const service = new FormsConfigService(handle, crypto);

    const saved = await service.upsert('mer_1', {} as FormsConfigInput);

    expect(recorder.insertedValues).toMatchObject({
      merchantId: 'mer_1',
      recaptchaThreshold: 0.3,
      formsEnabled: true,
    });
    expect(saved.recaptchaThreshold).toBe(0.3);
    expect(saved.formsEnabled).toBe(true);
    expect(saved.hasRecaptchaSecret).toBe(false);
    expect(saved.emailBounced).toBe(false);
  });

  it('upsert never writes emailBounced (worker-owned flag)', async () => {
    const { handle, recorder } = makeFakeHandle();
    const service = new FormsConfigService(handle, crypto);

    await service.upsert('mer_1', fullInput);

    expect(recorder.insertedValues).not.toHaveProperty('emailBounced');
    expect(recorder.onDup).not.toHaveProperty('emailBounced');
  });

  it('getByMerchantId throws CONFIG_NOT_FOUND for an unknown merchant', async () => {
    const { handle } = makeFakeHandle();
    const service = new FormsConfigService(handle, crypto);
    await expect(service.getByMerchantId('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
