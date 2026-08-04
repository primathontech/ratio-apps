import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../../src/core/crypto/crypto.service';
import {
  CredentialsAlreadyExistError,
  UcCredentialsService,
} from '../../../../src/modules/unicommerce/services/credentials.service';

function fakeDb(existing?: Record<string, unknown> | undefined) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  let row = existing;

  const createWhereChain = () => ({
    where: (_key: string, _op: string, _value: unknown) => createWhereChain(),
    select: (_col: string) => createWhereChain(),
    selectAll: () => createWhereChain(),
    executeTakeFirst: async () => row,
  });

  return {
    db: {
      insertInto: () => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v);
          row = v;
          return { execute: async () => undefined };
        },
      }),
      selectFrom: () => createWhereChain(),
      updateTable: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: (_key: string, _op: string, _value: unknown) => ({
            execute: async () => {
              updated.push(patch);
              row = { ...row, ...patch };
              return undefined;
            },
          }),
        }),
      }),
    },
    inserted,
    updated,
    getRow: () => row,
  };
}

function realCrypto(): CryptoService {
  return new CryptoService(randomBytes(32));
}

describe('UcCredentialsService.generate', () => {
  it('returns a plaintext password and stores only reversible ciphertext (not the plaintext itself)', async () => {
    const { db, inserted } = fakeDb();
    const svc = new UcCredentialsService(db as never, realCrypto());

    const result = await svc.generate('m1', 'merchant-uc-login@example.com');

    expect(result.username).toMatch(/^ratio-/);
    expect(result.password.length).toBeGreaterThanOrEqual(24);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].passwordEnc).not.toEqual(result.password);
    expect(inserted[0].ucUsername).toBe('merchant-uc-login@example.com');
  });

  it('translates a duplicate-key insert failure into CredentialsAlreadyExistError, not a raw DB error', async () => {
    const db = {
      insertInto: () => ({
        values: () => ({
          execute: async () => {
            const err = new Error("Duplicate entry 'm1' for key 'uc_credentials.PRIMARY'") as Error & {
              code: string;
              errno: number;
            };
            err.code = 'ER_DUP_ENTRY';
            err.errno = 1062;
            throw err;
          },
        }),
      }),
    };
    const svc = new UcCredentialsService(db as never, realCrypto());

    await expect(svc.generate('m1', 'uc-user@example.com')).rejects.toBeInstanceOf(
      CredentialsAlreadyExistError,
    );
  });

  it('derives different ciphertext on each call, even for the same password (fresh IV per encrypt)', async () => {
    const { db, inserted } = fakeDb();
    const crypto = realCrypto();
    const svc = new UcCredentialsService(db as never, crypto);

    // Force both calls to encrypt the identical plaintext by pre-encrypting
    // it directly rather than relying on generate()'s own random password —
    // simpler: just encrypt the same string twice and confirm distinct output.
    const a = crypto.encrypt('same-password');
    const b = crypto.encrypt('same-password');
    expect(a).not.toEqual(b);

    await svc.generate('m1', 'uc-user@example.com');
    expect(inserted).toHaveLength(1);
  });
});

describe('UcCredentialsService.getCredentials', () => {
  it('decrypts the stored password back to the original plaintext', async () => {
    const genDb = fakeDb();
    const crypto = realCrypto();
    const svc = new UcCredentialsService(genDb.db as never, crypto);

    const { username, password } = await svc.generate('m1', 'uc-user@example.com');
    const readSvc = new UcCredentialsService(genDb.db as never, crypto);

    const result = await readSvc.getCredentials('m1');
    expect(result).toEqual({ username, password, ucUsername: 'uc-user@example.com' });
  });

  it('surfaces lastInboundCallAt — the Admin UI connection-status proof-of-life timestamp', async () => {
    const genDb = fakeDb();
    const crypto = realCrypto();
    const svc = new UcCredentialsService(genDb.db as never, crypto);
    await svc.generate('m1', 'uc-user@example.com');
    await svc.touchInboundCall('m1');

    const result = await svc.getCredentials('m1');

    expect(result?.lastInboundCallAt).toBeInstanceOf(Date);
  });

  it('returns null when the merchant has no credentials on file', async () => {
    const { db } = fakeDb(undefined);
    const svc = new UcCredentialsService(db as never, realCrypto());

    expect(await svc.getCredentials('unknown-merchant')).toBeNull();
  });
});

describe('UcCredentialsService.regenerate', () => {
  it('mints a new username/password, keeps the existing ucUsername, and the OLD password no longer verifies', async () => {
    const genDb = fakeDb();
    const crypto = realCrypto();
    const svc = new UcCredentialsService(genDb.db as never, crypto);

    const first = await svc.generate('m1', 'uc-user@example.com');
    const second = await svc.regenerate('m1');

    expect(second).not.toBeNull();
    expect(second?.username).not.toEqual(first.username);
    expect(second?.password).not.toEqual(first.password);

    // The row now reflects the regenerated credentials.
    const row = genDb.getRow() as Record<string, unknown>;
    expect(row.ratioUsername).toBe(second?.username);
    expect(row.ucUsername).toBe('uc-user@example.com'); // unchanged

    // Old password no longer verifies against the (now-updated) row.
    const verifySvc = new UcCredentialsService(genDb.db as never, crypto);
    expect(await verifySvc.verify(first.username, first.password)).toBeNull();
    expect(await verifySvc.verify(second!.username, second!.password)).toBe('m1');
  });

  it('returns null when there is nothing to regenerate', async () => {
    const { db } = fakeDb(undefined);
    const svc = new UcCredentialsService(db as never, realCrypto());

    expect(await svc.regenerate('unknown-merchant')).toBeNull();
  });
});

describe('UcCredentialsService.verify', () => {
  it('returns merchantId when username exists and password matches', async () => {
    const genDb = fakeDb();
    const crypto = realCrypto();
    const svc = new UcCredentialsService(genDb.db as never, crypto);

    const { username, password } = await svc.generate('m1', 'uc-user@example.com');
    const verifySvc = new UcCredentialsService(genDb.db as never, crypto);

    expect(await verifySvc.verify(username, password)).toBe('m1');
  });

  it('returns null when username exists but password does not match', async () => {
    const genDb = fakeDb();
    const crypto = realCrypto();
    const svc = new UcCredentialsService(genDb.db as never, crypto);

    const { username } = await svc.generate('m1', 'uc-user@example.com');
    const verifySvc = new UcCredentialsService(genDb.db as never, crypto);

    expect(await verifySvc.verify(username, 'wrong-password')).toBeNull();
  });

  it('returns null when username is not found', async () => {
    const { db } = fakeDb(undefined);
    const svc = new UcCredentialsService(db as never, realCrypto());

    expect(await svc.verify('nonexistent-username', 'any-password')).toBeNull();
  });

  it('returns false safely (not a throw) when the stored ciphertext is malformed', async () => {
    const { db } = fakeDb({
      merchantId: 'm1',
      ratioUsername: 'ratio-abc',
      passwordEnc: 'not-valid-ciphertext',
      ucUsername: 'uc-user@example.com',
      status: 'active',
    });
    const svc = new UcCredentialsService(db as never, realCrypto());

    expect(await svc.verify('ratio-abc', 'any-password')).toBeNull();
  });
});
