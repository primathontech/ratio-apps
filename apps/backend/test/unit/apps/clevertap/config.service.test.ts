import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ClevertapConfigInput } from '@ratio-app/shared/schemas/clevertap-config';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import { ClevertapConfigService } from '../../../../src/modules/clevertap/config/config.service';
import { type FakeClevertapDb, makeFakeClevertapHandle } from './helpers/fake-clevertap-db';
import {
  ACCOUNT_ID,
  MERCHANT_ID,
  makeConfig,
  makeCrypto,
  makeForwardedEvent,
  makeMerchant,
  PASSCODE,
} from './helpers/fakes';

describe('ClevertapConfigService', () => {
  let fake: FakeClevertapDb;
  let crypto: CryptoService;
  let service: ClevertapConfigService;

  const baseInput: ClevertapConfigInput = {
    accountId: ACCOUNT_ID,
    region: 'in1',
  } as ClevertapConfigInput;

  beforeEach(() => {
    const built = makeFakeClevertapHandle();
    fake = built.fake;
    crypto = makeCrypto();
    fake.seed('merchants', makeMerchant());
    service = new ClevertapConfigService(built.handle, crypto);
  });

  describe('getByMerchantId', () => {
    it('returns the redacted shape with passcodeSet=false when no passcode is stored', async () => {
      fake.seed('clevertap_configs', makeConfig({ passcodeEnc: null }));

      const out = await service.getByMerchantId(MERCHANT_ID);

      expect(out).toEqual({
        accountId: ACCOUNT_ID,
        region: 'in1',
        debug: false,
        serverEventsEnabled: false,
        catalogName: '',
        catalogEmail: '',
        catalogSyncEnabled: false,
        clevertapEnabled: true,
        disabledTopics: [],
        chargedSource: 'server',
        lastCatalogSyncAt: null,
        lastCatalogSyncStatus: null,
        lastCatalogSyncCount: null,
        lastCatalogSyncError: null,
        events: buildDefaultEventMap('clevertap'),
        passcodeSet: false,
      });
      expect(out).not.toHaveProperty('passcode');
      expect(out).not.toHaveProperty('passcodeEnc');
    });

    it('sets passcodeSet=true when a ciphertext is stored, and still omits the secret', async () => {
      const ciphertext = crypto.encrypt(PASSCODE);
      fake.seed('clevertap_configs', makeConfig({ passcodeEnc: ciphertext }));

      const out = await service.getByMerchantId(MERCHANT_ID);

      expect(out.passcodeSet).toBe(true);
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain(PASSCODE);
      expect(serialized).not.toContain(ciphertext);
    });

    it('coerces TINYINT(1) booleans that mysql2 returns as 0/1', async () => {
      fake.seed(
        'clevertap_configs',
        makeConfig({
          debug: 1 as unknown as boolean,
          serverEventsEnabled: 0 as unknown as boolean,
          passcodeEnc: crypto.encrypt(PASSCODE),
        }),
      );

      const out = await service.getByMerchantId(MERCHANT_ID);

      expect(out.debug).toBe(true);
      expect(out.serverEventsEnabled).toBe(false);
    });

    it('throws NotFoundException when no config row exists', async () => {
      await expect(service.getByMerchantId(MERCHANT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('upsert — passcode tri-state (TRD §5)', () => {
    it('leaves passcode_enc untouched when `passcode` is absent', async () => {
      const ciphertext = crypto.encrypt(PASSCODE);
      fake.seed('clevertap_configs', makeConfig({ passcodeEnc: ciphertext }));

      const out = await service.upsert(MERCHANT_ID, { ...baseInput, accountId: 'NEW-ID' });

      expect(fake.config(MERCHANT_ID)?.passcodeEnc).toBe(ciphertext);
      expect(out.passcodeSet).toBe(true);
      expect(out.accountId).toBe('NEW-ID');
      const insert = fake.inserts.at(-1);
      expect(insert?.values).not.toHaveProperty('passcodeEnc');
    });

    it('clears passcode_enc to NULL when `passcode` is the empty string', async () => {
      fake.seed('clevertap_configs', makeConfig({ passcodeEnc: crypto.encrypt(PASSCODE) }));

      const out = await service.upsert(MERCHANT_ID, { ...baseInput, passcode: '' });

      expect(fake.config(MERCHANT_ID)?.passcodeEnc).toBeNull();
      expect(out.passcodeSet).toBe(false);
    });

    it('encrypts a non-empty passcode before storing it', async () => {
      await service.upsert(MERCHANT_ID, { ...baseInput, passcode: PASSCODE });

      const stored = fake.config(MERCHANT_ID)?.passcodeEnc as string;
      expect(stored).toBeTruthy();
      expect(stored).not.toBe(PASSCODE);
      expect(stored).not.toContain(PASSCODE);
      expect(JSON.stringify(fake.config(MERCHANT_ID))).not.toContain(PASSCODE);
    });

    it('round-trips via decrypt', async () => {
      await service.upsert(MERCHANT_ID, { ...baseInput, passcode: PASSCODE });

      const stored = fake.config(MERCHANT_ID)?.passcodeEnc as string;
      expect(crypto.decrypt(stored)).toBe(PASSCODE);
    });

    it('never returns the passcode from upsert', async () => {
      const out = await service.upsert(MERCHANT_ID, { ...baseInput, passcode: PASSCODE });

      expect(out).not.toHaveProperty('passcode');
      expect(JSON.stringify(out)).not.toContain(PASSCODE);
      expect(out.passcodeSet).toBe(true);
    });
  });

  describe('upsert — events / debug preservation', () => {
    it('preserves the stored event map when the body omits `events`', async () => {
      const renamed = buildDefaultEventMap('clevertap');
      renamed.AddToCart = { enabled: false, name: 'Added to Cart' };
      fake.seed('clevertap_configs', makeConfig({ events: renamed, debug: true }));

      const out = await service.upsert(MERCHANT_ID, baseInput);

      expect(out.events.AddToCart).toEqual({ enabled: false, name: 'Added to Cart' });
      expect(fake.config(MERCHANT_ID)?.events.AddToCart.enabled).toBe(false);
      expect(out.debug).toBe(true);
    });

    it('writes the supplied event map when the body includes `events`', async () => {
      fake.seed('clevertap_configs', makeConfig());
      const events = buildDefaultEventMap('clevertap');
      events.Purchase = { enabled: true, name: 'Charged' };
      events.Search = { enabled: false, name: 'Search' };

      const out = await service.upsert(MERCHANT_ID, { ...baseInput, events });

      expect(out.events.Search.enabled).toBe(false);
      expect(fake.config(MERCHANT_ID)?.events.Search.enabled).toBe(false);
    });

    it('encodes events as a JSON string for the JSON column', async () => {
      await service.upsert(MERCHANT_ID, baseInput);

      const insert = fake.inserts.at(-1);
      expect(typeof insert?.values.events).toBe('string');
    });

    it('persists disabledTopics (per-topic mute) as a JSON string and returns the array', async () => {
      const out = await service.upsert(MERCHANT_ID, {
        ...baseInput,
        disabledTopics: ['orders/updated', 'reviews/create'],
      });

      expect(out.disabledTopics).toEqual(['orders/updated', 'reviews/create']);
      const insert = fake.inserts.at(-1);
      expect(typeof insert?.values.disabledTopics).toBe('string');
      expect(JSON.parse(insert?.values.disabledTopics as string)).toEqual([
        'orders/updated',
        'reviews/create',
      ]);
    });

    it('defaults disabledTopics to [] when the body omits it', async () => {
      const out = await service.upsert(MERCHANT_ID, baseInput);
      expect(out.disabledTopics).toEqual([]);
    });

    it('strips orders/paid from disabledTopics when chargedSource is server (Charged stays on)', async () => {
      const out = await service.upsert(MERCHANT_ID, {
        ...baseInput,
        chargedSource: 'server',
        disabledTopics: ['orders/paid', 'orders/updated'],
      });
      expect(out.disabledTopics).toEqual(['orders/updated']);
    });

    it('mutes orders/paid in disabledTopics when chargedSource is client (pixel owns Charged)', async () => {
      const out = await service.upsert(MERCHANT_ID, {
        ...baseInput,
        chargedSource: 'client',
        disabledTopics: [],
      });
      expect(out.disabledTopics).toContain('orders/paid');
    });

    it('falls back to the CleverTap default map for a brand-new row', async () => {
      const out = await service.upsert(MERCHANT_ID, baseInput);

      expect(out.events).toEqual(buildDefaultEventMap('clevertap'));
      expect(out.events.Purchase.name).toBe('Charged');
    });
  });

  describe('upsert — validation', () => {
    it('rejects an unknown region before touching the DB', async () => {
      await expect(
        service.upsert(MERCHANT_ID, { ...baseInput, region: 'moon1' } as ClevertapConfigInput),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(fake.inserts).toHaveLength(0);
      expect(fake.table('clevertap_configs')).toHaveLength(0);
    });

    it('rejects enabling serverEventsEnabled with no stored passcode', async () => {
      fake.seed('clevertap_configs', makeConfig({ passcodeEnc: null }));

      await expect(
        service.upsert(MERCHANT_ID, { ...baseInput, serverEventsEnabled: true }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(fake.config(MERCHANT_ID)?.serverEventsEnabled).toBe(false);
    });

    it('rejects enabling serverEventsEnabled while clearing the passcode', async () => {
      fake.seed('clevertap_configs', makeConfig({ passcodeEnc: crypto.encrypt(PASSCODE) }));

      await expect(
        service.upsert(MERCHANT_ID, { ...baseInput, serverEventsEnabled: true, passcode: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows enabling serverEventsEnabled in the same request that supplies the passcode', async () => {
      const out = await service.upsert(MERCHANT_ID, {
        ...baseInput,
        serverEventsEnabled: true,
        passcode: PASSCODE,
      });

      expect(out.serverEventsEnabled).toBe(true);
      expect(out.passcodeSet).toBe(true);
    });

    it('allows enabling serverEventsEnabled when a passcode is already stored', async () => {
      fake.seed('clevertap_configs', makeConfig({ passcodeEnc: crypto.encrypt(PASSCODE) }));

      const out = await service.upsert(MERCHANT_ID, { ...baseInput, serverEventsEnabled: true });

      expect(out.serverEventsEnabled).toBe(true);
      expect(fake.config(MERCHANT_ID)?.serverEventsEnabled).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('reports an empty state when nothing has been forwarded', async () => {
      fake.seed('clevertap_configs', makeConfig());

      const status = await service.getStatus(MERCHANT_ID);

      expect(status).toEqual({
        configComplete: true,
        serverEventsEnabled: false,
        lastEventAt: null,
        lastEventTopic: null,
        lastError: null,
        forwardedCount24h: 0,
      });
    });

    it('reports configComplete=false for an empty accountId or unknown region', async () => {
      fake.seed('clevertap_configs', makeConfig({ accountId: '' }));
      expect((await service.getStatus(MERCHANT_ID)).configComplete).toBe(false);

      fake.table('clevertap_configs').length = 0;
      fake.seed('clevertap_configs', makeConfig({ region: 'moon1' }));
      expect((await service.getStatus(MERCHANT_ID)).configComplete).toBe(false);
    });

    it('surfaces the most recent forward and counts the trailing 24h of sends', async () => {
      const now = Date.now();
      fake.seed(
        'clevertap_configs',
        makeConfig({ passcodeEnc: crypto.encrypt(PASSCODE), serverEventsEnabled: true }),
      );
      fake.seed(
        'clevertap_forwarded_events',
        makeForwardedEvent({
          id: 'a',
          idempotencyKey: 'orders/paid:1',
          sentAt: new Date(now - 60_000),
        }),
        makeForwardedEvent({
          id: 'b',
          idempotencyKey: 'orders/create:2',
          topic: 'orders/create',
          clevertapEvent: 'Order Created',
          sentAt: new Date(now - 30_000),
        }),
        makeForwardedEvent({
          id: 'c',
          idempotencyKey: 'orders/paid:3',
          sentAt: new Date(now - 48 * 60 * 60 * 1000),
        }),
        makeForwardedEvent({
          id: 'd',
          idempotencyKey: 'orders/paid:4',
          status: 'skipped',
          sentAt: new Date(now - 45_000),
        }),
      );

      const status = await service.getStatus(MERCHANT_ID);

      expect(status.serverEventsEnabled).toBe(true);
      expect(status.lastEventTopic).toBe('orders/create');
      expect(status.lastEventAt).toBe(new Date(now - 30_000).toISOString());
      expect(status.lastError).toBeNull();
      expect(status.forwardedCount24h).toBe(2);
    });

    it('surfaces lastError when the most recent forward failed', async () => {
      fake.seed('clevertap_configs', makeConfig());
      fake.seed(
        'clevertap_forwarded_events',
        makeForwardedEvent({
          id: 'e',
          status: 'failed',
          error: 'clevertap responded 503',
          sentAt: new Date(),
        }),
      );

      const status = await service.getStatus(MERCHANT_ID);

      expect(status.lastError).toBe('clevertap responded 503');
    });

    it('does not throw for a merchant with no config row', async () => {
      const status = await service.getStatus(MERCHANT_ID);

      expect(status.configComplete).toBe(false);
      expect(status.serverEventsEnabled).toBe(false);
    });
  });
});
