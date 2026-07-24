import type { Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { FormsDatabase } from '../../../../src/modules/forms/db/types';
import { FormsBootstrap } from '../../../../src/modules/forms/forms.bootstrap';

/** Recorder fake for the single INSERT…ODKU the bootstrap issues on the trx. */
function makeFakeTrx() {
  const recorder: Array<{
    table: string;
    values: Record<string, unknown>;
    onDup?: Record<string, unknown>;
  }> = [];
  const trx = {
    insertInto(table: string) {
      const entry: (typeof recorder)[number] = { table, values: {} };
      recorder.push(entry);
      const chain = {
        values: (v: Record<string, unknown>) => {
          entry.values = v;
          return chain;
        },
        onDuplicateKeyUpdate: (u: Record<string, unknown>) => {
          entry.onDup = u;
          return chain;
        },
        execute: async () => [],
      };
      return chain;
    },
  } as unknown as Transaction<FormsDatabase>;
  return { trx, recorder };
}

describe('FormsBootstrap (AC1 / TDD §3.9)', () => {
  it('seeds forms_configs defaults (threshold 0.30, forms_enabled true) through the passed trx', async () => {
    const { trx, recorder } = makeFakeTrx();
    const bootstrap = new FormsBootstrap();

    await bootstrap.run(trx, 'mer_1');

    expect(recorder).toHaveLength(1);
    expect(recorder[0].table).toBe('forms_configs');
    expect(recorder[0].values).toMatchObject({
      merchantId: 'mer_1',
      recaptchaThreshold: 0.3,
      formsEnabled: true,
    });
  });

  it('is idempotent: uses INSERT…ON DUPLICATE KEY UPDATE with a self-update no-op', async () => {
    const { trx, recorder } = makeFakeTrx();
    const bootstrap = new FormsBootstrap();

    await bootstrap.run(trx, 'mer_1');
    await bootstrap.run(trx, 'mer_1'); // reinstall — must not throw or clobber

    expect(recorder).toHaveLength(2);
    for (const entry of recorder) {
      // ODKU present and touching only the PK (no-op) — reinstalls preserve settings.
      expect(entry.onDup).toBeTruthy();
      expect(Object.keys(entry.onDup ?? {})).toEqual(['merchantId']);
    }
  });

  it('does not seed a reCAPTCHA secret or site key (shared Ratio key mode at launch)', async () => {
    const { trx, recorder } = makeFakeTrx();
    await new FormsBootstrap().run(trx, 'mer_1');

    expect(recorder[0].values).not.toHaveProperty('recaptchaSecretEnc');
    expect(recorder[0].values).not.toHaveProperty('recaptchaSiteKey');
  });
});
