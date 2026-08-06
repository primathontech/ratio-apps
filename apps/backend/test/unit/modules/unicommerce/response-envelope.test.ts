import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ResponseInterceptor } from '../../../../src/core/common/interceptors/response.interceptor';
import { UcAuthController } from '../../../../src/modules/unicommerce/controllers/auth.controller';
import { UcCatalogController } from '../../../../src/modules/unicommerce/controllers/catalog.controller';
import { UcDispatchController } from '../../../../src/modules/unicommerce/controllers/dispatch.controller';
import { UcInventoryController } from '../../../../src/modules/unicommerce/controllers/inventory.controller';
import { UcOrderCancelController } from '../../../../src/modules/unicommerce/controllers/order-cancel.controller';
import { UcOrdersReadController } from '../../../../src/modules/unicommerce/controllers/orders-read.controller';
import { UcStatusController } from '../../../../src/modules/unicommerce/controllers/status.controller';

/**
 * Bug: the global ResponseInterceptor (registered app-wide in configure-app.ts
 * with zero per-route exemption) wraps every controller return value in
 * `{status_code, message, data, request_id}`. Unicommerce's real, documented
 * contract for all 9 inbound endpoints is a FLAT response — so every reply
 * this connector sends back to a real Unicommerce call is contract-broken.
 *
 * These tests drive the REAL interceptor against the REAL controller
 * classes' real route handlers (via reflection, no HTTP/DB needed) so they
 * fail against today's code and only pass once Unicommerce-facing routes are
 * exempted from the envelope.
 */

function fakeContext(controllerClass: Function, handlerName: string): ExecutionContext {
  const handler = (controllerClass.prototype as Record<string, unknown>)[handlerName];
  return {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-1' }),
      getResponse: () => ({ header: () => undefined }),
    }),
    getHandler: () => handler,
    getClass: () => controllerClass,
  } as unknown as ExecutionContext;
}

const UC_FACING_ROUTES: Array<{ label: string; controllerClass: Function; handlerName: string }> = [
  { label: 'UcAuthController.getAuthToken', controllerClass: UcAuthController, handlerName: 'getAuthToken' },
  { label: 'UcAuthController.postAuthToken', controllerClass: UcAuthController, handlerName: 'postAuthToken' },
  { label: 'UcCatalogController.count', controllerClass: UcCatalogController, handlerName: 'count' },
  { label: 'UcCatalogController.list', controllerClass: UcCatalogController, handlerName: 'list' },
  { label: 'UcInventoryController.update', controllerClass: UcInventoryController, handlerName: 'update' },
  { label: 'UcDispatchController.dispatch', controllerClass: UcDispatchController, handlerName: 'dispatch' },
  { label: 'UcOrderCancelController.cancel', controllerClass: UcOrderCancelController, handlerName: 'cancel' },
  { label: 'UcOrdersReadController.list', controllerClass: UcOrdersReadController, handlerName: 'list' },
  { label: 'UcStatusController.notify', controllerClass: UcStatusController, handlerName: 'notify' },
];

describe('ResponseInterceptor — Unicommerce-facing routes must bypass the envelope', () => {
  for (const { label, controllerClass, handlerName } of UC_FACING_ROUTES) {
    it(`${label} returns its flat Unicommerce response unwrapped`, async () => {
      const interceptor = new ResponseInterceptor(new Reflector());
      const flatShape = { status: 'SUCCESS', accessToken: 'tok-1' };
      const ctx = fakeContext(controllerClass, handlerName);

      const result = await firstValueFrom(interceptor.intercept(ctx, { handle: () => of(flatShape) }));

      expect(result).toEqual(flatShape);
    });
  }
});

describe('ResponseInterceptor — default envelope behavior is unchanged for non-Unicommerce routes', () => {
  it('still wraps a plain response when no bypass metadata is present', async () => {
    class SomeOtherController {
      handler() {
        return undefined;
      }
    }
    const interceptor = new ResponseInterceptor(new Reflector());
    const ctx = fakeContext(SomeOtherController, 'handler');

    const result = await firstValueFrom(interceptor.intercept(ctx, { handle: () => of({ foo: 'bar' }) }));

    expect(result).toEqual({
      status_code: 200,
      message: 'success',
      data: { foo: 'bar' },
      request_id: 'req-1',
    });
  });
});
