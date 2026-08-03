import { readFileSync } from 'node:fs';
import { NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontController } from '../../../../src/modules/loyalty/storefront/storefront.controller';
import type { StorefrontConfigService } from '../../../../src/modules/loyalty/storefront/storefront-config.service';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn() };
});

const readFileSyncMock = vi.mocked(readFileSync);

/** Capturing FastifyReply stub: chainable `header()`, recording `send()`. */
function makeReply() {
  const headers: Record<string, string> = {};
  const send = vi.fn();
  const reply = {
    header(key: string, value: string) {
      headers[key] = value;
      return reply;
    },
    send,
  };
  return { reply: reply as unknown as FastifyReply, headers, send };
}

const PUBLIC_CONFIG = { programName: 'Wellversed Coins', enabled: true, version: '0.1.0' };

function makeController() {
  const publicConfig = vi.fn(async () => ({ ...PUBLIC_CONFIG }));
  const cfg = { publicConfig } as unknown as StorefrontConfigService;
  return { controller: new StorefrontController(cfg), publicConfig };
}

describe('loyalty StorefrontController', () => {
  beforeEach(() => {
    readFileSyncMock.mockReset();
  });

  describe('bundle routes', () => {
    it('serves loyalty-loader.js with JS content-type, CORS * and no-cache (unversioned URL must revalidate)', () => {
      readFileSyncMock.mockReturnValue('loader-js-bytes');
      const { controller } = makeController();
      const { reply, headers, send } = makeReply();

      controller.loader(reply);

      expect(send).toHaveBeenCalledWith('loader-js-bytes');
      expect(headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect(headers['access-control-allow-origin']).toBe('*');
      expect(headers['cache-control']).toBe('no-cache');
      expect(String(readFileSyncMock.mock.calls[0]?.[0])).toContain('loyalty-loader.js');
    });

    it('serves loyalty-claim.js with JS content-type, CORS * and immutable long-cache (content-versioned URL)', () => {
      readFileSyncMock.mockReturnValue('claim-js-bytes');
      const { controller } = makeController();
      const { reply, headers, send } = makeReply();

      controller.claim(reply);

      expect(send).toHaveBeenCalledWith('claim-js-bytes');
      expect(headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect(headers['access-control-allow-origin']).toBe('*');
      expect(headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(String(readFileSyncMock.mock.calls[0]?.[0])).toContain('loyalty-claim.js');
    });

    it('memoizes each bundle: the fs read happens once per file', () => {
      readFileSyncMock.mockReturnValueOnce('loader-js-bytes').mockReturnValueOnce('claim-js-bytes');
      const { controller } = makeController();

      controller.loader(makeReply().reply);
      controller.loader(makeReply().reply);
      const second = makeReply();
      controller.loader(second.reply);
      expect(second.send).toHaveBeenCalledWith('loader-js-bytes');
      expect(readFileSyncMock).toHaveBeenCalledTimes(1);

      controller.claim(makeReply().reply);
      controller.claim(makeReply().reply);
      expect(readFileSyncMock).toHaveBeenCalledTimes(2);
    });

    it('404s when the dist bundle is missing (not built)', () => {
      readFileSyncMock.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const { controller } = makeController();

      expect(() => controller.loader(makeReply().reply)).toThrow(NotFoundException);
      expect(() => controller.claim(makeReply().reply)).toThrow(NotFoundException);
    });
  });

  describe('GET config/:merchantId', () => {
    it('returns ONLY {programName, enabled, version} with CORS * and no-store', async () => {
      const { controller, publicConfig } = makeController();
      const { reply, headers, send } = makeReply();

      await controller.config('m1', reply);

      expect(publicConfig).toHaveBeenCalledWith('m1');
      expect(send).toHaveBeenCalledTimes(1);
      const payload = send.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).toEqual(PUBLIC_CONFIG); // exact shape — strict redaction
      expect(Object.keys(payload).sort()).toEqual(['enabled', 'programName', 'version']);
      expect(headers['access-control-allow-origin']).toBe('*');
      expect(headers['cache-control']).toBe('no-store');
    });
  });
});
