import { DEFAULT_CLEVERTAP_EVENT_MAP } from '@ratio-app/shared/constants/clevertap-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import type { Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';
import { ClevertapBootstrap } from '../../../../src/modules/clevertap/clevertap.bootstrap';
import type { ClevertapDatabase } from '../../../../src/modules/clevertap/db/types';
import { makeFakeClevertapHandle } from './helpers/fake-clevertap-db';
import { ACCOUNT_ID, MERCHANT_ID, makeConfig, makeMerchant } from './helpers/fakes';

describe('ClevertapBootstrap', () => {
  function setup() {
    const { fake, handle } = makeFakeClevertapHandle();
    fake.seed('merchants', makeMerchant());
    const trx = handle.db as unknown as Transaction<ClevertapDatabase>;
    return { fake, trx };
  }

  it('seeds a default config row on first install', async () => {
    const { fake, trx } = setup();

    await new ClevertapBootstrap().run(trx, MERCHANT_ID);

    const row = fake.config(MERCHANT_ID);
    expect(row).toBeDefined();
    expect(row?.accountId).toBe('');
    expect(row?.region).toBe('in1');
    expect(row?.debug).toBe(false);
    expect(row?.serverEventsEnabled).toBe(false);
    expect(row?.passcodeEnc).toBeNull();
    expect(row?.events).toEqual(buildDefaultEventMap('clevertap'));
    expect(row?.events.Purchase.name).toBe(DEFAULT_CLEVERTAP_EVENT_MAP.Purchase);
    expect(row?.events.Purchase.name).toBe('Charged');
  });

  it('encodes events as a JSON string (mysql2 does not auto-encode)', async () => {
    const { fake, trx } = setup();

    await new ClevertapBootstrap().run(trx, MERCHANT_ID);

    const insert = fake.inserts.find((i) => i.table === 'clevertap_configs');
    expect(insert).toBeDefined();
    expect(typeof insert?.values.events).toBe('string');
    expect(JSON.parse(insert?.values.events as string)).toEqual(buildDefaultEventMap('clevertap'));
  });

  it('second install is a no-op and preserves accountId + passcode_enc', async () => {
    const { fake, trx } = setup();
    const renamed = buildDefaultEventMap('clevertap');
    renamed.Purchase = { enabled: true, name: 'Merchant Renamed Purchase' };
    fake.seed(
      'clevertap_configs',
      makeConfig({
        accountId: ACCOUNT_ID,
        passcodeEnc: 'ciphertext-from-first-install',
        region: 'sg1',
        serverEventsEnabled: true,
        debug: true,
        events: renamed,
      }),
    );

    await new ClevertapBootstrap().run(trx, MERCHANT_ID);

    const row = fake.config(MERCHANT_ID);
    expect(row?.accountId).toBe(ACCOUNT_ID);
    expect(row?.passcodeEnc).toBe('ciphertext-from-first-install');
    expect(row?.region).toBe('sg1');
    expect(row?.serverEventsEnabled).toBe(true);
    expect(row?.debug).toBe(true);
    expect(row?.events.Purchase.name).toBe('Merchant Renamed Purchase');
    expect(fake.table('clevertap_configs')).toHaveLength(1);
  });

  it('writes through the caller transaction, never a fresh connection', async () => {
    const { fake, handle } = makeFakeClevertapHandle();
    const seen: string[] = [];
    const trx = {
      insertInto(table: string) {
        seen.push(table);
        return (handle.db as { insertInto: (t: string) => unknown }).insertInto(table);
      },
    } as unknown as Transaction<ClevertapDatabase>;

    const bootstrap = new ClevertapBootstrap();
    expect(ClevertapBootstrap.length).toBe(0);

    await bootstrap.run(trx, MERCHANT_ID);

    expect(seen).toEqual(['clevertap_configs']);
    expect(fake.config(MERCHANT_ID)).toBeDefined();
  });
});
