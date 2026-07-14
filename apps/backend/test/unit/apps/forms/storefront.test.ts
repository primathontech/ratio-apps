import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger, NotFoundException } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantsService } from '../../../../src/core/merchants/merchants.service';
import type { FormsDatabase } from '../../../../src/modules/forms/db/types';
import { FormsSdkService } from '../../../../src/modules/forms/sdk/sdk.service';

const WIDGET_JS = 'customElements.define("ratio-form", class extends HTMLElement {});';

function makeReply() {
  const headers: Record<string, string> = {};
  const reply = {
    header: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
      return reply;
    }),
  };
  return { reply, headers };
}

function makeService(merchant: Partial<Merchant> | null) {
  const merchants = {
    findById: vi.fn(async () => merchant),
  } as unknown as MerchantsService<FormsDatabase>;
  return new FormsSdkService(merchants);
}

describe('FormsSdkService — /forms/sdk/:merchantId.js (wizzy storefront pattern)', () => {
  const savedDist = process.env.FORMS_SDK_DIST;

  afterEach(() => {
    if (savedDist === undefined) delete process.env.FORMS_SDK_DIST;
    else process.env.FORMS_SDK_DIST = savedDist;
    vi.restoreAllMocks();
  });

  describe('with a built bundle', () => {
    beforeEach(() => {
      const distDir = mkdtempSync(join(tmpdir(), 'forms-sdk-dist-'));
      writeFileSync(join(distDir, 'forms-widget.js'), WIDGET_JS);
      process.env.FORMS_SDK_DIST = distDir;
    });

    it('serves prelude (merchantId + apiBase) + the widget bundle with Cache-Control on success', async () => {
      const service = makeService({ id: 'mer_1', isActive: true });
      const { reply, headers } = makeReply();

      const js = await service.render('mer_1', reply as never, 'http://localhost:3000');

      expect(js.startsWith('window.__FORMS_SDK_CONFIG__ = {')).toBe(true);
      expect(js).toContain('"merchantId":"mer_1"');
      expect(js).toContain('"apiBase":"http://localhost:3000/forms"');
      expect(js).toContain(WIDGET_JS);
      expect(headers['cache-control']).toBe('public, max-age=300');
    });

    it('404 MERCHANT_INACTIVE for missing/uninstalled merchants — no cache header on the error path', async () => {
      for (const merchant of [null, { id: 'mer_1', isActive: false }]) {
        const service = makeService(merchant);
        const { reply, headers } = makeReply();
        await expect(service.render('mer_1', reply as never, 'http://localhost:3000')).rejects.toThrow(NotFoundException);
        expect(headers['cache-control']).toBeUndefined();
      }
    });
  });

  describe('without a built bundle (fresh checkout)', () => {
    beforeEach(() => {
      process.env.FORMS_SDK_DIST = mkdtempSync(join(tmpdir(), 'forms-sdk-empty-'));
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    it('still answers 200 with the prelude + a console.warn stub', async () => {
      const service = makeService({ id: 'mer_1', isActive: true });
      const { reply, headers } = makeReply();

      const js = await service.render('mer_1', reply as never, 'http://localhost:3000');

      expect(js).toContain('window.__FORMS_SDK_CONFIG__');
      expect(js).toContain('console.warn');
      expect(js).toContain('[ratio-forms]');
      expect(headers['cache-control']).toBe('public, max-age=300');
    });
  });
});
