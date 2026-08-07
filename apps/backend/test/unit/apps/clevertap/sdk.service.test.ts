import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CLEVERTAP_REGIONS } from '@ratio-app/shared/constants/clevertap-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import type { FastifyReply } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: readFileMock }));

import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { MerchantsService } from '../../../../src/core/merchants/merchants.service';
import { ClevertapConfigService } from '../../../../src/modules/clevertap/config/config.service';
import type { ClevertapDatabase } from '../../../../src/modules/clevertap/db/types';
import { ClevertapSdkService } from '../../../../src/modules/clevertap/sdk/sdk.service';
import { type FakeClevertapDb, makeFakeClevertapHandle } from './helpers/fake-clevertap-db';
import { ACCOUNT_ID, MERCHANT_ID, makeConfig, makeCrypto, PASSCODE } from './helpers/fakes';

const PIXEL_BODY = '/* clevertap pixel body */\n(function(){})();';

function makeReply() {
  const headers: Record<string, string> = {};
  const header = vi.fn((name: string, value: string) => {
    headers[name] = value;
    return reply;
  });
  const reply = { header } as unknown as FastifyReply;
  return { reply, headers, header };
}

describe('ClevertapSdkService', () => {
  let fake: FakeClevertapDb;
  let crypto: CryptoService;
  let configs: ClevertapConfigService;
  let service: ClevertapSdkService;
  let merchantRow: { id: string; isActive: boolean } | null;

  beforeEach(() => {
    readFileMock.mockReset();
    readFileMock.mockResolvedValue(PIXEL_BODY);

    const built = makeFakeClevertapHandle();
    fake = built.fake;
    crypto = makeCrypto();
    configs = new ClevertapConfigService(built.handle, crypto);
    merchantRow = { id: MERCHANT_ID, isActive: true };
    const merchants = {
      findById: vi.fn(async () => merchantRow),
    } as unknown as MerchantsService<ClevertapDatabase>;
    service = new ClevertapSdkService(configs, merchants);
  });

  function parsePrelude(js: string): Record<string, unknown> {
    const match = /^window\.__CLEVERTAP_RATIO_CONFIG__ = (.*);$/m.exec(js);
    expect(match).not.toBeNull();
    return JSON.parse(match?.[1] as string);
  }

  describe('success path', () => {
    beforeEach(() => {
      fake.seed('clevertap_configs', makeConfig({ passcodeEnc: crypto.encrypt(PASSCODE) }));
    });

    it('renders prelude + pixel body for a configured merchant', async () => {
      const { reply } = makeReply();

      const js = await service.render(MERCHANT_ID, reply);

      expect(js).toContain('window.__CLEVERTAP_RATIO_CONFIG__ = ');
      expect(js).toContain(PIXEL_BODY);
      expect(js.indexOf('__CLEVERTAP_RATIO_CONFIG__')).toBeLessThan(js.indexOf(PIXEL_BODY));
    });

    it('emits exactly the agreed prelude key set', async () => {
      const { reply } = makeReply();

      const payload = parsePrelude(await service.render(MERCHANT_ID, reply));

      expect(Object.keys(payload).sort()).toEqual([
        'accountId',
        'apiHost',
        'debug',
        'eventNameMap',
        'merchantId',
        'region',
      ]);
      expect(payload.accountId).toBe(ACCOUNT_ID);
      expect(payload.region).toBe('in1');
      expect(payload.apiHost).toBe(CLEVERTAP_REGIONS.in1.apiHost);
      expect(payload.debug).toBe(false);
      expect(payload.merchantId).toBe(MERCHANT_ID);
    });

    it('resolves apiHost from the merchant region', async () => {
      fake.table('clevertap_configs').length = 0;
      fake.seed('clevertap_configs', makeConfig({ region: 'aps3' }));
      const { reply } = makeReply();

      const payload = parsePrelude(await service.render(MERCHANT_ID, reply));

      expect(payload.region).toBe('aps3');
      expect(payload.apiHost).toBe('https://aps3.api.clevertap.com');
    });

    it('carries only enabled events, under their mapped CleverTap names', async () => {
      const events = buildDefaultEventMap('clevertap');
      events.Search = { enabled: false, name: 'Search' };
      events.AddToCart = { enabled: true, name: 'Cart Add Renamed' };
      fake.table('clevertap_configs').length = 0;
      fake.seed('clevertap_configs', makeConfig({ events, chargedSource: 'client' }));
      const { reply } = makeReply();

      const payload = parsePrelude(await service.render(MERCHANT_ID, reply));
      const map = payload.eventNameMap as Record<string, string>;

      expect(map.Purchase).toBe('Charged');
      expect(map.AddToCart).toBe('Cart Add Renamed');
      expect(map).not.toHaveProperty('Search');
    });

    it('drops client Purchase→Charged when server owns Charged (serverEvents + chargedSource=server)', async () => {
      fake.table('clevertap_configs').length = 0;
      fake.seed(
        'clevertap_configs',
        makeConfig({
          serverEventsEnabled: true,
          chargedSource: 'server',
          passcodeEnc: crypto.encrypt(PASSCODE),
        }),
      );
      const { reply } = makeReply();

      const map = (parsePrelude(await service.render(MERCHANT_ID, reply)).eventNameMap ??
        {}) as Record<string, string>;

      expect(map).not.toHaveProperty('Purchase');
      expect(map.PageView).toBe('Page Browse');
    });

    it('still drops client Purchase→Charged when source=server even with server events OFF (no silent fallback)', async () => {
      fake.table('clevertap_configs').length = 0;
      fake.seed(
        'clevertap_configs',
        makeConfig({
          serverEventsEnabled: false,
          chargedSource: 'server',
          passcodeEnc: crypto.encrypt(PASSCODE),
        }),
      );
      const { reply } = makeReply();

      const map = (parsePrelude(await service.render(MERCHANT_ID, reply)).eventNameMap ??
        {}) as Record<string, string>;

      expect(map).not.toHaveProperty('Purchase');
    });

    it('keeps client Purchase→Charged when chargedSource is client, even with server events on', async () => {
      fake.table('clevertap_configs').length = 0;
      fake.seed(
        'clevertap_configs',
        makeConfig({
          serverEventsEnabled: true,
          chargedSource: 'client',
          passcodeEnc: crypto.encrypt(PASSCODE),
        }),
      );
      const { reply } = makeReply();

      const map = (parsePrelude(await service.render(MERCHANT_ID, reply)).eventNameMap ??
        {}) as Record<string, string>;

      expect(map.Purchase).toBe('Charged');
    });

    it('never contains the passcode plaintext or its ciphertext', async () => {
      const ciphertext = fake.config(MERCHANT_ID)?.passcodeEnc as string;
      const { reply } = makeReply();

      const js = await service.render(MERCHANT_ID, reply);

      expect(ciphertext).toBeTruthy();
      expect(js).not.toContain(PASSCODE);
      expect(js).not.toContain(ciphertext);
      expect(js).not.toMatch(/passcode/i);
    });

    it('emits the prelude through safe-inline-json', async () => {
      fake.table('clevertap_configs').length = 0;
      fake.seed('clevertap_configs', makeConfig({ accountId: '</script><img src=x onerror=1>' }));
      const { reply } = makeReply();

      const js = await service.render(MERCHANT_ID, reply);

      expect(js).not.toContain('</script>');
      expect(js).not.toMatch(/<img/);
      expect(js).toContain('\\u003c');
      expect(parsePrelude(js).accountId).toBe('</script><img src=x onerror=1>');
    });

    it('sets Cache-Control on the success path', async () => {
      const { reply, headers } = makeReply();

      await service.render(MERCHANT_ID, reply);

      expect(headers['Cache-Control']).toBe('public, max-age=300');
    });

    it('caches the pixel body after the first read', async () => {
      const { reply } = makeReply();

      await service.render(MERCHANT_ID, reply);
      await service.render(MERCHANT_ID, reply);

      expect(readFileMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('kill switch', () => {
    it('serves an inert no-op body (not the real pixel) when clevertapEnabled is false', async () => {
      fake.seed('clevertap_configs', makeConfig({ clevertapEnabled: false }));
      const { reply, headers } = makeReply();

      const js = await service.render(MERCHANT_ID, reply);

      expect(js).toBe('/* CleverTap disabled for this merchant */');
      expect(js).not.toContain(PIXEL_BODY);
      expect(js).not.toContain('__CLEVERTAP_RATIO_CONFIG__');
      expect(readFileMock).not.toHaveBeenCalled();
      expect(headers['Cache-Control']).toBe('no-store');
    });

    it('serves the inert body when the platform switch is off, even with clevertapEnabled true', async () => {
      fake.seed('clevertap_configs', makeConfig({ clevertapEnabled: true }));
      const merchants = {
        findById: vi.fn(async () => merchantRow),
      } as unknown as MerchantsService<ClevertapDatabase>;
      const disabled = new ClevertapSdkService(configs, merchants, false);
      const { reply, headers } = makeReply();

      const js = await disabled.render(MERCHANT_ID, reply);

      expect(js).toBe('/* CleverTap disabled for this merchant */');
      expect(readFileMock).not.toHaveBeenCalled();
      expect(headers['Cache-Control']).toBe('no-store');
    });
  });

  describe('error paths', () => {
    async function expectErrorCode(promise: Promise<unknown>, code: string) {
      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await promise.catch((err: NotFoundException) => {
        expect((err.getResponse() as { error_code: string }).error_code).toBe(code);
      });
    }

    it('404s MERCHANT_INACTIVE when the merchant does not exist', async () => {
      merchantRow = null;
      fake.seed('clevertap_configs', makeConfig());
      const { reply } = makeReply();

      await expectErrorCode(service.render(MERCHANT_ID, reply), 'MERCHANT_INACTIVE');
    });

    it('404s MERCHANT_INACTIVE for an uninstalled merchant, and the config row survives', async () => {
      merchantRow = { id: MERCHANT_ID, isActive: false };
      fake.seed('clevertap_configs', makeConfig());
      const { reply } = makeReply();

      await expectErrorCode(service.render(MERCHANT_ID, reply), 'MERCHANT_INACTIVE');
      expect(fake.config(MERCHANT_ID)).toBeDefined();
    });

    it('404s after uninstall even though it served before', async () => {
      fake.seed('clevertap_configs', makeConfig());
      const { reply } = makeReply();

      await expect(service.render(MERCHANT_ID, reply)).resolves.toContain(PIXEL_BODY);

      merchantRow = { id: MERCHANT_ID, isActive: false };
      await expectErrorCode(service.render(MERCHANT_ID, reply), 'MERCHANT_INACTIVE');
    });

    it('404s CONFIG_INCOMPLETE when there is no config row', async () => {
      const { reply } = makeReply();

      await expectErrorCode(service.render(MERCHANT_ID, reply), 'CONFIG_INCOMPLETE');
    });

    it('404s CONFIG_INCOMPLETE when accountId is empty', async () => {
      fake.seed('clevertap_configs', makeConfig({ accountId: '' }));
      const { reply } = makeReply();

      await expectErrorCode(service.render(MERCHANT_ID, reply), 'CONFIG_INCOMPLETE');
    });

    it('404s CONFIG_INVALID_REGION for an unknown stored region', async () => {
      fake.seed('clevertap_configs', makeConfig({ region: 'moon1' }));
      const { reply } = makeReply();

      await expectErrorCode(service.render(MERCHANT_ID, reply), 'CONFIG_INVALID_REGION');
    });

    it('503s PIXEL_MISSING when the asset is absent', async () => {
      readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      fake.seed('clevertap_configs', makeConfig());
      const { reply } = makeReply();

      const promise = service.render(MERCHANT_ID, reply);
      await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableException);
      await promise.catch((err: ServiceUnavailableException) => {
        expect((err.getResponse() as { error_code: string }).error_code).toBe('PIXEL_MISSING');
      });
    });

    it('checks the merchant BEFORE the config, so inactive always wins', async () => {
      merchantRow = { id: MERCHANT_ID, isActive: false };
      const spy = vi.spyOn(configs, 'getByMerchantId');
      const { reply } = makeReply();

      await expectErrorCode(service.render(MERCHANT_ID, reply), 'MERCHANT_INACTIVE');
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      [
        'merchant missing',
        () => {
          merchantRow = null;
        },
      ],
      [
        'merchant inactive',
        () => {
          merchantRow = { id: MERCHANT_ID, isActive: false };
        },
      ],
      ['no config row', () => {}],
      ['empty accountId', () => fake.seed('clevertap_configs', makeConfig({ accountId: '' }))],
      ['unknown region', () => fake.seed('clevertap_configs', makeConfig({ region: 'moon1' }))],
      [
        'pixel missing',
        () => {
          readFileMock.mockRejectedValue(new Error('ENOENT'));
          fake.seed('clevertap_configs', makeConfig());
        },
      ],
    ])('does NOT set Cache-Control on the %s error path', async (_label, arrange) => {
      arrange();
      const { reply, header } = makeReply();

      await expect(service.render(MERCHANT_ID, reply)).rejects.toBeTruthy();

      expect(header).not.toHaveBeenCalled();
    });
  });
});
