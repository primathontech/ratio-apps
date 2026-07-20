import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { RpPortalController } from './portal.controller';
import type { RpMerchantsService } from '../merchants/merchants.service';
import type { RpOrdersService } from '../orders/orders.service';
import type { RpPortalHealthService } from './portal-health.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';

/**
 * RpPortalController.portal() always used to unconditionally 302-redirect into RP's portal
 * (dev RP_PORTAL_URL or prod RP_BASE_URL hosted shell). It now gates the redirect on
 * RpPortalHealthService.checkHealthy(): healthy → redirect exactly as before; unhealthy →
 * render an inline "temporarily unavailable" HTML page (status 200) instead, since RP's
 * hosted portal has been observed both fully unreachable (503) and reachable-but-broken
 * (200 shell, 403 on its own externally-hosted JS/CSS bundle) in production.
 */
function makeReply(): FastifyReply {
  return {
    redirect: vi.fn(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn(),
  } as unknown as FastifyReply;
}

function makeController(opts: {
  healthy: boolean;
  baseUrl?: string;
  findByDomain?: ReturnType<typeof vi.fn>;
  getOrder?: ReturnType<typeof vi.fn>;
}) {
  const config = {
    get: vi.fn().mockReturnValue(opts.baseUrl ?? 'https://api.returnprime.co'),
  } as unknown as ConfigService<Env, true>;
  const merchants = { findByDomain: opts.findByDomain ?? vi.fn() } as unknown as RpMerchantsService;
  const orders = { getOrder: opts.getOrder ?? vi.fn() } as unknown as RpOrdersService;
  const portalHealth = {
    checkHealthy: vi.fn().mockResolvedValue(opts.healthy),
  } as unknown as RpPortalHealthService;
  const controller = new RpPortalController(config, merchants, orders, portalHealth);
  return { controller, portalHealth };
}

describe('RpPortalController.portal', () => {
  const originalRpPortalUrl = process.env.RP_PORTAL_URL;

  beforeEach(() => {
    delete process.env.RP_PORTAL_URL;
  });
  afterEach(() => {
    if (originalRpPortalUrl === undefined) delete process.env.RP_PORTAL_URL;
    else process.env.RP_PORTAL_URL = originalRpPortalUrl;
  });

  describe('healthy portal', () => {
    it('redirects to the RP_PORTAL_URL dev/self-hosted target when set', async () => {
      process.env.RP_PORTAL_URL = 'https://dev-rp.example/';
      const { controller, portalHealth } = makeController({ healthy: true });
      const reply = makeReply();

      await controller.portal(reply, 'sandbox.dev.gokwik.io');

      expect(portalHealth.checkHealthy).toHaveBeenCalledWith('https://dev-rp.example/sandbox.dev.gokwik.io');
      expect(reply.redirect).toHaveBeenCalledWith('https://dev-rp.example/sandbox.dev.gokwik.io', 302);
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('redirects to the RP_BASE_URL hosted-portal target when RP_PORTAL_URL is unset', async () => {
      const { controller, portalHealth } = makeController({ healthy: true, baseUrl: 'https://api.returnprime.co' });
      const reply = makeReply();

      await controller.portal(reply, 'sandbox.dev.gokwik.io');

      expect(portalHealth.checkHealthy).toHaveBeenCalledWith(
        'https://api.returnprime.co/os/v1/customer-portal?shop=sandbox.dev.gokwik.io',
      );
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://api.returnprime.co/os/v1/customer-portal?shop=sandbox.dev.gokwik.io',
        302,
      );
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('still appends the resolved order name (from orderId lookup) as prefillQs on redirect', async () => {
      const findByDomain = vi.fn().mockResolvedValue({ merchantId: 'm1' });
      const getOrder = vi.fn().mockResolvedValue({ order: { name: '#1234' } });
      const { controller } = makeController({
        healthy: true,
        baseUrl: 'https://api.returnprime.co',
        findByDomain,
        getOrder,
      });
      const reply = makeReply();

      await controller.portal(reply, 'sandbox.dev.gokwik.io', undefined, undefined, 'ordr_XXXX');

      expect(findByDomain).toHaveBeenCalledWith('sandbox.dev.gokwik.io');
      expect(getOrder).toHaveBeenCalledWith('m1', 'ordr_XXXX');
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://api.returnprime.co/os/v1/customer-portal?shop=sandbox.dev.gokwik.io&order=%231234',
        302,
      );
    });
  });

  describe('unhealthy portal', () => {
    it('sends inline fallback HTML instead of redirecting (RP_PORTAL_URL branch)', async () => {
      process.env.RP_PORTAL_URL = 'https://dev-rp.example/';
      const { controller } = makeController({ healthy: false });
      const reply = makeReply();

      await controller.portal(reply, 'sandbox.dev.gokwik.io');

      expect(reply.redirect).not.toHaveBeenCalled();
      expect(reply.type).toHaveBeenCalledWith('text/html');
      expect(reply.send).toHaveBeenCalledWith(expect.stringContaining('temporarily unavailable'));
    });

    it('sends inline fallback HTML instead of redirecting (RP_BASE_URL branch)', async () => {
      const { controller } = makeController({ healthy: false, baseUrl: 'https://api.returnprime.co' });
      const reply = makeReply();

      await controller.portal(reply, 'sandbox.dev.gokwik.io');

      expect(reply.redirect).not.toHaveBeenCalled();
      expect(reply.type).toHaveBeenCalledWith('text/html');
      expect(reply.send).toHaveBeenCalledWith(expect.stringContaining('temporarily unavailable'));
    });
  });
});
