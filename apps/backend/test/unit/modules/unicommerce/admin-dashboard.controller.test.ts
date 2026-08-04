import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UcAdminDashboardController } from '../../../../src/modules/unicommerce/controllers/admin-dashboard.controller';

/**
 * Fake query builder recording every `.where(...)` call and the final
 * `.limit()`/`.offset()` values, returning `rowsToReturn` from `.execute()` —
 * lets each test control exactly what "the DB returned" to verify the
 * controller's OWN hasMore/slicing logic, independent of real filtering.
 */
function fakeDb(rowsToReturn: Record<string, unknown>[]) {
  const wheres: Array<[string, string, unknown]> = [];
  let limitArg: number | undefined;
  let offsetArg: number | undefined;

  const builder = {
    selectAll: () => builder,
    where: (col: string, op: string, val: unknown) => {
      wheres.push([col, op, val]);
      return builder;
    },
    orderBy: () => builder,
    limit: (n: number) => {
      limitArg = n;
      return builder;
    },
    offset: (n: number) => {
      offsetArg = n;
      return builder;
    },
    execute: async () => rowsToReturn,
  };

  return {
    db: { selectFrom: () => builder },
    wheres,
    getLimitArg: () => limitArg,
    getOffsetArg: () => offsetArg,
  };
}

function fakeReconciliationSweep() {
  return { triggerManual: vi.fn(), getJob: vi.fn() };
}

function fakeAlerting() {
  return { listAlerts: vi.fn(), acknowledge: vi.fn() };
}

function fakeConfigService() {
  return { getByMerchantId: vi.fn(), upsert: vi.fn() };
}

function fakeFeatureFlags() {
  return { invalidate: vi.fn() };
}

describe('UcAdminDashboardController.listActivity', () => {
  it('returns rows + hasMore:false when fewer rows exist than the limit', async () => {
    // `fakeDb()`'s return value IS the `KyselyClient`-shaped handle (`{db, ...helpers}`) —
    // pass it whole, not its inner `.db` property, or `this.handle.db` is undefined.
    const fake = fakeDb([{ id: '1', flow: 'order_push', result: 'success' }]);
    const syncQueue = { attemptImmediate: vi.fn() };
    const controller = new UcAdminDashboardController(
      fake as never,
      syncQueue as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    const result = await controller.listActivity('m1');

    expect(result).toEqual({
      rows: [{ id: '1', flow: 'order_push', result: 'success' }],
      hasMore: false,
    });
    expect(fake.wheres).toContainEqual(['merchantId', '=', 'm1']);
    // Default page size is 5; the controller requests limit+1 to derive hasMore.
    expect(fake.getLimitArg()).toBe(6);
  });

  it('sets hasMore:true and trims the extra row when more rows exist than the limit', async () => {
    const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const fake = fakeDb(rows);
    const syncQueue = { attemptImmediate: vi.fn() };
    const controller = new UcAdminDashboardController(
      fake as never,
      syncQueue as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    const result = await controller.listActivity('m1', '2');

    expect(result).toEqual({ rows: [{ id: '1' }, { id: '2' }], hasMore: true });
  });

  it('applies limit/offset from query params for "Show more" pagination', async () => {
    const fake = fakeDb([]);
    const syncQueue = { attemptImmediate: vi.fn() };
    const controller = new UcAdminDashboardController(
      fake as never,
      syncQueue as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    await controller.listActivity('m1', '10', '20');

    expect(fake.getLimitArg()).toBe(11); // limit+1
    expect(fake.getOffsetArg()).toBe(20);
  });

  it('filters by result when ?result= is a valid value (Failed Syncs tab)', async () => {
    const fake = fakeDb([]);
    const syncQueue = { attemptImmediate: vi.fn() };
    const controller = new UcAdminDashboardController(
      fake as never,
      syncQueue as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    await controller.listActivity('m1', undefined, undefined, 'failed');

    expect(fake.wheres).toContainEqual(['result', '=', 'failed']);
  });

  it('rejects an invalid ?result= value', async () => {
    const fake = fakeDb([]);
    const syncQueue = { attemptImmediate: vi.fn() };
    const controller = new UcAdminDashboardController(
      fake as never,
      syncQueue as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    await expect(
      controller.listActivity('m1', undefined, undefined, 'bogus'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires merchantId', async () => {
    const fake = fakeDb([]);
    const syncQueue = { attemptImmediate: vi.fn() };
    const controller = new UcAdminDashboardController(
      fake as never,
      syncQueue as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    await expect(controller.listActivity('')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UcAdminDashboardController.retry', () => {
  it('retry re-enqueues the job by delegating to the sync queue', async () => {
    const db = { db: {} };
    const syncQueue = { attemptImmediate: vi.fn().mockResolvedValue(undefined) };
    const controller = new UcAdminDashboardController(
      db as never,
      syncQueue as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    await controller.retry('job-1');

    expect(syncQueue.attemptImmediate).toHaveBeenCalledWith('job-1');
  });
});

describe('UcAdminDashboardController.triggerReconcile / getReconcileJob', () => {
  it('triggers a manual reconciliation and returns the job id', async () => {
    const db = { db: {} };
    const reconciliationSweep = {
      triggerManual: vi.fn().mockResolvedValue('job-1'),
      getJob: vi.fn(),
    };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      reconciliationSweep as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    const result = await controller.triggerReconcile({
      merchantId: 'm1',
      timeRangeStart: '2026-07-20T00:00:00.000Z',
      timeRangeEnd: '2026-07-20T06:00:00.000Z',
    });

    expect(reconciliationSweep.triggerManual).toHaveBeenCalledWith(
      'm1',
      new Date('2026-07-20T00:00:00.000Z'),
      new Date('2026-07-20T06:00:00.000Z'),
    );
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('returns the job row when found', async () => {
    const db = { db: {} };
    const job = { id: 'job-1', status: 'COMPLETED' };
    const reconciliationSweep = { triggerManual: vi.fn(), getJob: vi.fn().mockResolvedValue(job) };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      reconciliationSweep as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    const result = await controller.getReconcileJob('job-1');

    expect(result).toEqual(job);
  });

  it('404s when no job matches the id', async () => {
    const db = { db: {} };
    const reconciliationSweep = { triggerManual: vi.fn(), getJob: vi.fn().mockResolvedValue(null) };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      reconciliationSweep as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    await expect(controller.getReconcileJob('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UcAdminDashboardController.listAlerts / acknowledgeAlert', () => {
  it('lists alerts for the given merchant', async () => {
    const db = { db: {} };
    const alerts = [{ id: 'a1', type: 'STALE_ORDER' }];
    const alerting = { listAlerts: vi.fn().mockResolvedValue(alerts), acknowledge: vi.fn() };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      fakeReconciliationSweep() as never,
      alerting as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    const result = await controller.listAlerts('m1');

    expect(alerting.listAlerts).toHaveBeenCalledWith('m1');
    expect(result).toEqual({ alerts });
  });

  it('requires merchantId', async () => {
    const db = { db: {} };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    await expect(controller.listAlerts('')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acknowledges the alert with the given acknowledgedBy', async () => {
    const db = { db: {} };
    const alerting = { listAlerts: vi.fn(), acknowledge: vi.fn().mockResolvedValue(undefined) };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      fakeReconciliationSweep() as never,
      alerting as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    const result = await controller.acknowledgeAlert('a1', { acknowledgedBy: 'ops@example.com' });

    expect(alerting.acknowledge).toHaveBeenCalledWith('a1', 'ops@example.com');
    expect(result).toEqual({ ok: true });
  });
});

describe('UcAdminDashboardController.getConfig / updateConfig', () => {
  it('returns the config service result for the given merchant', async () => {
    const db = { db: {} };
    const config = { productSyncEnabled: true };
    const configService = { getByMerchantId: vi.fn().mockResolvedValue(config), upsert: vi.fn() };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      configService as never,
      fakeFeatureFlags() as never,
    );

    const result = await controller.getConfig('m1');

    expect(configService.getByMerchantId).toHaveBeenCalledWith('m1');
    expect(result).toEqual(config);
  });

  it('requires merchantId on GET config', async () => {
    const db = { db: {} };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    await expect(controller.getConfig('')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upserts the config for the merchant and invalidates the feature-flags cache', async () => {
    const db = { db: {} };
    const configService = {
      getByMerchantId: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ orderPushEnabled: true }),
    };
    const featureFlags = { invalidate: vi.fn() };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      configService as never,
      featureFlags as never,
    );

    const result = await controller.updateConfig('m1', { orderPushEnabled: true });

    expect(configService.upsert).toHaveBeenCalledWith('m1', { orderPushEnabled: true });
    expect(featureFlags.invalidate).toHaveBeenCalledWith('m1');
    expect(result).toEqual({ orderPushEnabled: true });
  });

  it('requires merchantId on PUT config', async () => {
    const db = { db: {} };
    const controller = new UcAdminDashboardController(
      db as never,
      {} as never,
      fakeReconciliationSweep() as never,
      fakeAlerting() as never,
      fakeConfigService() as never,
      fakeFeatureFlags() as never,
    );

    await expect(controller.updateConfig('', { productSyncEnabled: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
