import { randomBytes } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DelhiveryConfigInput } from '@ratio-app/shared/schemas/delhivery-config';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import { DelhiveryConfigService } from '../../../../src/modules/delhivery/config/config.service';
import type { DelhiveryConfigRow, DelhiveryDatabase } from '../../../../src/modules/delhivery/db/types';

/** Fake `handle.db` implementing exactly the chains the config service touches. */
function makeFakeHandle(init: { configRow?: DelhiveryConfigRow } = {}): {
  handle: KyselyClient<DelhiveryDatabase>;
  holder: { row?: DelhiveryConfigRow };
  recorder: { insertedValues?: Record<string, unknown>; onDup?: Record<string, unknown> };
} {
  const holder: { row?: DelhiveryConfigRow } = { row: init.configRow };
  const recorder: { insertedValues?: Record<string, unknown>; onDup?: Record<string, unknown> } = {};

  const selectChain = {
    selectAll: () => selectChain,
    select: () => selectChain,
    where: () => selectChain,
    limit: () => selectChain,
    executeTakeFirst: async () => holder.row,
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
  return { handle: { db } as unknown as KyselyClient<DelhiveryDatabase>, holder, recorder };
}

const crypto = new CryptoService(randomBytes(32));

const input: DelhiveryConfigInput = {
  apiToken: 'dlv-secret-token-xyz',
  pickupLocationName: 'Main Warehouse',
  pickupPincode: '122001',
  pickupPhone: '9876543210',
  pickupAddress: 'Plot 5, Industrial Area',
  pickupCity: 'Gurgaon',
  gstin: '29ABCDE1234F1Z5',
  defaultBox: { l: 10, b: 12, h: 8 },
};

describe('DelhiveryConfigService', () => {
  it('config.save.encryptsToken — token stored encrypted, never plaintext', async () => {
    const { handle, recorder } = makeFakeHandle();
    const service = new DelhiveryConfigService(handle, crypto);

    await service.upsert('mer_1', input);

    const stored = recorder.insertedValues?.apiTokenEnc as string;
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(input.apiToken);
    expect(JSON.stringify(recorder.insertedValues)).not.toContain(input.apiToken);
    expect(JSON.stringify(recorder.onDup)).not.toContain(input.apiToken);
    // Round-trips through the module crypto.
    expect(crypto.decrypt(stored)).toBe(input.apiToken);
  });

  it('upsert fills defaults (cutoff 10:00, auto trigger, enabled) and echoes the saved shape', async () => {
    const { handle } = makeFakeHandle();
    const service = new DelhiveryConfigService(handle, crypto);

    const saved = await service.upsert('mer_1', input);

    expect(saved).toMatchObject({
      apiToken: input.apiToken,
      pickupCutoff: '10:00',
      awbTrigger: 'auto',
      enabled: true,
      defaultBox: { l: 10, b: 12, h: 8 },
    });
  });

  it('getByMerchantId decrypts the stored token', async () => {
    const row: DelhiveryConfigRow = {
      merchantId: 'mer_1',
      apiTokenEnc: crypto.encrypt('dlv-secret-token-xyz'),
      pickupLocationName: 'Main Warehouse',
      pickupPincode: '122001',
      pickupPhone: '9876543210',
      pickupAddress: 'Plot 5, Industrial Area',
      pickupCity: 'Gurgaon',
      gstin: '29ABCDE1234F1Z5',
      pickupCutoff: '10:00',
      awbTrigger: 'auto',
      defaultBoxLCm: 10,
      defaultBoxBCm: 12,
      defaultBoxHCm: 8,
      enabled: 1 as unknown as boolean, // mysql2 TINYINT(1)
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { handle } = makeFakeHandle({ configRow: row });
    const service = new DelhiveryConfigService(handle, crypto);

    const config = await service.getByMerchantId('mer_1');

    expect(config.apiToken).toBe('dlv-secret-token-xyz');
    expect(config.enabled).toBe(true);
    expect(config.defaultBox).toEqual({ l: 10, b: 12, h: 8 });
    expect(config.pickupPincode).toBe('122001');
    expect(config.pickupPhone).toBe('9876543210');
  });

  it('config.save persists the pickup warehouse address (pincode/phone/address)', async () => {
    const { handle, recorder } = makeFakeHandle();
    const service = new DelhiveryConfigService(handle, crypto);

    await service.upsert('mer_1', input);

    expect(recorder.insertedValues).toMatchObject({
      pickupPincode: '122001',
      pickupPhone: '9876543210',
      pickupAddress: 'Plot 5, Industrial Area',
      pickupCity: 'Gurgaon',
    });
    expect(recorder.onDup).toMatchObject({ pickupPincode: '122001' });
  });

  it('config.save.keepsStoredToken — blank apiToken on edit keeps the stored ciphertext', async () => {
    const storedEnc = crypto.encrypt('dlv-stored-token');
    const row = {
      merchantId: 'mer_1',
      apiTokenEnc: storedEnc,
    } as unknown as DelhiveryConfigRow;
    const { handle, recorder } = makeFakeHandle({ configRow: row });
    const service = new DelhiveryConfigService(handle, crypto);

    const saved = await service.upsert('mer_1', { ...input, apiToken: '' });

    // Ciphertext is reused verbatim — the token is never re-encrypted or wiped.
    expect(recorder.insertedValues?.apiTokenEnc).toBe(storedEnc);
    expect(recorder.onDup?.apiTokenEnc).toBe(storedEnc);
    expect(saved.apiToken).toBe('dlv-stored-token');
    // Other fields still update.
    expect(recorder.onDup?.pickupAddress).toBe('Plot 5, Industrial Area');
  });

  it('config.save.requiresTokenFirstTime — blank apiToken with nothing stored is rejected', async () => {
    const { handle } = makeFakeHandle();
    const service = new DelhiveryConfigService(handle, crypto);
    await expect(service.upsert('mer_1', { ...input, apiToken: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getByMerchantId throws CONFIG_NOT_FOUND for an unknown merchant', async () => {
    const { handle } = makeFakeHandle();
    const service = new DelhiveryConfigService(handle, crypto);
    await expect(service.getByMerchantId('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
