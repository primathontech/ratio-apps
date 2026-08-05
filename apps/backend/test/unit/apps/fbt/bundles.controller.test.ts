import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { FbtBundlesController } from '../../../../src/modules/fbt/bundles/bundles.controller';
import { FbtMerchantTokenGuard } from '../../../../src/modules/fbt/guards';

const MERCHANT = { id: 'm-1', isActive: true } as never;

function stubServices() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const record =
    (fn: string) =>
    async (...args: unknown[]) => {
      calls.push({ fn, args });
      return { id: 'b-1' };
    };
  const bundles = {
    create: record('create'),
    list: record('list'),
    getById: record('getById'),
    update: record('update'),
    remove: record('remove'),
    duplicate: record('duplicate'),
    setStatus: record('setStatus'),
  } as never;
  const lookup = { resolve: record('resolve'), preview: record('preview') } as never;
  return { bundles, lookup, calls };
}

describe('FbtBundlesController wiring', () => {
  it('is mounted at fbt/api/bundles — no v1 segment', () => {
    // Repo convention: `v1` is for OAuth prefixes only. Verified across all
    // vendors (wizzy/api/catalog, loyalty/api/dashboard). The spec's
    // `/fbt/api/v1/bundles` is wrong.
    expect(Reflect.getMetadata(PATH_METADATA, FbtBundlesController)).toBe('fbt/api/bundles');
  });

  it('guards the whole controller with the merchant token guard', () => {
    const guards = Reflect.getMetadata('__guards__', FbtBundlesController) ?? [];
    expect(guards.length).toBeGreaterThan(0);
    expect(guards).toContain(FbtMerchantTokenGuard);
  });

  it('declares the lookup route before the :id route', () => {
    // Otherwise GET /bundles/lookup can resolve as getById('lookup').
    const proto = FbtBundlesController.prototype as object;
    const names = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(names).toContain('lookup');
    expect(names).toContain('getById');
    expect(names.indexOf('lookup')).toBeLessThan(names.indexOf('getById'));
  });

  it('declares the duplicate route before any :id/... POST route', () => {
    const proto = FbtBundlesController.prototype as object;
    const names = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(names).toContain('duplicate');
    expect(names).toContain('setStatus');
    expect(names.indexOf('duplicate')).toBeLessThan(names.indexOf('setStatus'));
  });
});

describe('FbtBundlesController — merchant identity', () => {
  it('passes the guard-supplied merchant id to create, never a body field', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.create(MERCHANT, { name: 'x', merchantId: 'attacker' } as never);

    expect(calls[0]?.fn).toBe('create');
    expect(calls[0]?.args[0]).toBe('m-1');
  });

  it('passes the merchant id to getById so one tenant cannot read another', async () => {
    const { bundles, lookup, calls } = stubServices();
    await new FbtBundlesController(bundles, lookup).getById(MERCHANT, 'b-9');

    expect(calls[0]?.args).toEqual(['m-1', 'b-9']);
  });

  it('coerces list paging params from strings and defaults them', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.list(MERCHANT, undefined, undefined, undefined, undefined);

    expect(calls[0]?.args[1]).toMatchObject({ page: 1, limit: 20 });
  });

  it('forwards status and mode filters when supplied', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.list(MERCHANT, 'published', 'auto', '2', '50');

    expect(calls[0]?.args[1]).toMatchObject({
      status: 'published',
      mode: 'auto',
      page: 2,
      limit: 50,
    });
  });

  it('drops an unrecognised status filter rather than passing it to SQL', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.list(MERCHANT, 'bogus', undefined, undefined, undefined);

    expect(calls[0]?.args[1]).not.toHaveProperty('status');
    // Strengthened: the weak form above would also pass if `list` dropped
    // every filter unconditionally. Pin that a *valid* mode alongside the
    // bogus status still comes through, so we know filtering is selective,
    // not blanket.
    await c.list(MERCHANT, 'bogus', 'auto', undefined, undefined);
    expect(calls[1]?.args[1]).toMatchObject({ mode: 'auto' });
    expect(calls[1]?.args[1]).not.toHaveProperty('status');
  });

  it('drops an unrecognised mode filter rather than passing it to SQL', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.list(MERCHANT, 'published', 'bogus-mode', undefined, undefined);

    expect(calls[0]?.args[1]).toMatchObject({ status: 'published' });
    expect(calls[0]?.args[1]).not.toHaveProperty('mode');
  });

  it('rejects a lookup with neither productId nor collectionId', async () => {
    const { bundles, lookup } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await expect(c.lookup(MERCHANT, undefined, undefined)).rejects.toThrow();
  });

  it('passes productId through to the lookup service without touching collectionId', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.lookup(MERCHANT, 'p-1', undefined);

    expect(calls[0]?.fn).toBe('resolve');
    expect(calls[0]?.args).toEqual(['m-1', { productId: 'p-1' }]);
  });

  it('passes the merchant id and bundle id to duplicate, plus an optional name', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.duplicate(MERCHANT, { id: 'b-1', name: 'copy' } as never);

    expect(calls[0]?.fn).toBe('duplicate');
    expect(calls[0]?.args).toEqual(['m-1', 'b-1', 'copy']);
  });

  it('passes the merchant id, bundle id and status to setStatus', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.setStatus(MERCHANT, 'b-1', { status: 'published' } as never);

    expect(calls[0]?.fn).toBe('setStatus');
    expect(calls[0]?.args).toEqual(['m-1', 'b-1', 'published']);
  });

  it('passes the merchant id and bundle id to preview, delegating to the lookup service', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.preview(MERCHANT, 'b-1');

    expect(calls[0]?.fn).toBe('preview');
    expect(calls[0]?.args).toEqual(['m-1', 'b-1']);
  });

  it('passes the merchant id and bundle id to remove, and to update with the body', async () => {
    const { bundles, lookup, calls } = stubServices();
    const c = new FbtBundlesController(bundles, lookup);
    await c.remove(MERCHANT, 'b-1');
    await c.update(MERCHANT, 'b-1', { name: 'y' } as never);

    expect(calls[0]?.fn).toBe('remove');
    expect(calls[0]?.args).toEqual(['m-1', 'b-1']);
    expect(calls[1]?.fn).toBe('update');
    expect(calls[1]?.args).toEqual(['m-1', 'b-1', { name: 'y' }]);
  });
});
