import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MerchantsService } from '../../../../src/core/merchants/merchants.service';
import type { DelhiveryDatabase } from '../../../../src/modules/delhivery/db/types';
import { DelhiveryStorefrontController } from '../../../../src/modules/delhivery/storefront/storefront.controller';

const LOADER_JS = '(function(){/* delhivery loader bundle */})();';
const WIDGET_JS = 'export const widget = true; /* delhivery widget bundle */';

/** Minimal chainable FastifyReply stub capturing headers + payload. */
function makeReply() {
  const headers: Record<string, string> = {};
  const reply = {
    header: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
      return reply;
    }),
    send: vi.fn(),
  };
  return { reply, headers };
}

function makeController(merchant: Partial<Merchant> | null) {
  const merchants = {
    findById: vi.fn(async () => merchant),
  } as unknown as MerchantsService<DelhiveryDatabase>;
  return { controller: new DelhiveryStorefrontController(merchants), merchants };
}

let distDir: string;

beforeAll(() => {
  // The controller reads the built SDK bundles from `packages/delhivery-sdk/dist`;
  // unit tests must not depend on a prior `pnpm build`, so point the
  // DELHIVERY_SDK_DIST override at a fixture directory.
  distDir = mkdtempSync(join(tmpdir(), 'delhivery-sdk-dist-'));
  writeFileSync(join(distDir, 'delhivery-loader.js'), LOADER_JS);
  writeFileSync(join(distDir, 'delhivery-widget.js'), WIDGET_JS);
  process.env.DELHIVERY_SDK_DIST = distDir;
});

afterAll(() => {
  delete process.env.DELHIVERY_SDK_DIST;
});

describe('DelhiveryStorefrontController', () => {
  it('storefront.servesLoaderWithPrelude — active merchant gets prelude + loader bundle with CORS + cache headers', async () => {
    const { controller } = makeController({ id: 'mer_1', isActive: true });
    const { reply, headers } = makeReply();

    await controller.loader('mer_1', reply as never);

    expect(reply.send).toHaveBeenCalledTimes(1);
    const body = reply.send.mock.calls[0]?.[0] as string;
    expect(body.startsWith('window.__DELHIVERY__ = {')).toBe(true);
    expect(body).toContain('"merchantId":"mer_1"');
    expect(body).toContain('"version":"');
    expect(body).toContain(LOADER_JS);
    expect(headers['content-type']).toContain('javascript');
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['cache-control']).toBe('public, max-age=300');
  });

  it('storefront.inactiveMerchant404 — uninstalled/unknown merchants get MERCHANT_INACTIVE, nothing served', async () => {
    for (const merchant of [null, { id: 'mer_1', isActive: false }]) {
      const { controller } = makeController(merchant);
      const { reply } = makeReply();
      await expect(controller.loader('mer_1', reply as never)).rejects.toMatchObject({
        response: { error_code: 'MERCHANT_INACTIVE' },
      });
      expect(reply.send).not.toHaveBeenCalled();
    }
  });

  it('storefront.servesWidgetBundle — the shared widget ESM is served publicly with a longer cache', () => {
    const { controller } = makeController(null); // no merchant lookup on this route
    const { reply, headers } = makeReply();

    controller.widget(reply as never);

    expect(reply.send).toHaveBeenCalledWith(WIDGET_JS);
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['cache-control']).toBe('public, max-age=3600');
  });

  it('storefront.missingBundle404 — an unbuilt SDK yields a clear NotFound, not a crash', async () => {
    process.env.DELHIVERY_SDK_DIST = join(distDir, 'does-not-exist');
    try {
      const { controller } = makeController({ id: 'mer_1', isActive: true });
      const { reply } = makeReply();
      await expect(controller.loader('mer_1', reply as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    } finally {
      process.env.DELHIVERY_SDK_DIST = distDir;
    }
  });

  it('storefront.preludeIsXssSafe — merchant ids cannot break out of the inline script', async () => {
    // MerchantIdPipe already blocks these at the route edge; the prelude must
    // STILL be safe by construction (defense in depth via safeInlineJson).
    const { controller } = makeController({ id: 'mer_1', isActive: true });
    const { reply } = makeReply();
    await controller.loader('</script><script>alert(1)</script>', reply as never);
    const body = reply.send.mock.calls[0]?.[0] as string;
    expect(body).not.toContain('</script>');
  });
});
