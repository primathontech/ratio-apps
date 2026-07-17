import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('kysely', () => ({
  sql: (..._args: unknown[]) => ({ execute: vi.fn().mockResolvedValue(undefined) }),
}));

import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { DelhiveryDatabase, DelhiveryShipmentRow } from '../../../../src/modules/delhivery/db/types';
import { istParts, PickupCron } from '../../../../src/modules/delhivery/pickup/pickup.cron';
import type { DelhiverySdkService } from '../../../../src/modules/delhivery/sdk/sdk.service';

const pendingShipment = {
  id: 'shp_1',
  merchantId: 'mer_1',
  status: 'awaiting_pickup',
  awb: 'AWB123456',
  pickupRequestedAt: null,
} as unknown as DelhiveryShipmentRow;

function fakeHandle(init: { configs: Array<{ merchantId: string; pickupCutoff: string }>; pending: DelhiveryShipmentRow[] }) {
  const recorder: { stamped: boolean } = { stamped: false };
  const configChain = {
    innerJoin: () => configChain,
    select: () => configChain,
    where: () => configChain,
    execute: async () => init.configs,
  };
  const shipmentChain = {
    selectAll: () => shipmentChain,
    where: () => shipmentChain,
    execute: async () => init.pending,
  };
  const updateChain = {
    set: () => {
      recorder.stamped = true;
      return updateChain;
    },
    where: () => updateChain,
    execute: async () => [],
  };
  const db = {
    selectFrom: (table: string) => (table === 'delhivery_configs' ? configChain : shipmentChain),
    updateTable: () => updateChain,
  };
  return { handle: { db } as unknown as KyselyClient<DelhiveryDatabase>, recorder };
}

function makeCron(opts: { configs?: Array<{ merchantId: string; pickupCutoff: string }>; pending?: DelhiveryShipmentRow[] } = {}) {
  const { handle, recorder } = fakeHandle({
    configs: opts.configs ?? [{ merchantId: 'mer_1', pickupCutoff: '10:00' }],
    pending: opts.pending ?? [pendingShipment],
  });
  const sdk = { requestPickup: vi.fn(async () => ({ scheduled: true })) } as unknown as DelhiverySdkService;
  return { cron: new PickupCron(handle, sdk), sdk, recorder };
}

/** An instant that is HH:mm IST on 2026-07-02. */
function istInstant(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  // 10:00 IST == 04:30 UTC
  return new Date(Date.UTC(2026, 6, 2, h - 5, m - 30));
}

describe('PickupCron', () => {
  beforeEach(() => vi.clearAllMocks());

  it('istParts converts an instant to IST HH:mm + date', () => {
    expect(istParts(istInstant('10:00'))).toEqual({ hhmm: '10:00', date: '2026-07-02' });
  });

  it('pickup.cronSchedulesPending — past the cutoff it files a pickup covering pending shipments', async () => {
    const { cron, sdk, recorder } = makeCron();
    const res = await cron.runOnce(istInstant('10:05'));

    expect(res).toEqual({ ran: true, merchants: 1 });
    expect(sdk.requestPickup).toHaveBeenCalledWith('mer_1', { date: '2026-07-02', count: 1 });
    expect(recorder.stamped).toBe(true);
  });

  it('before the cutoff nothing is filed', async () => {
    const { cron, sdk } = makeCron();
    const res = await cron.runOnce(istInstant('09:45'));

    expect(res).toEqual({ ran: true, merchants: 0 });
    expect(sdk.requestPickup).not.toHaveBeenCalled();
  });

  it('no pending shipments → no pickup request', async () => {
    const { cron, sdk } = makeCron({ pending: [] });
    await cron.runOnce(istInstant('11:00'));
    expect(sdk.requestPickup).not.toHaveBeenCalled();
  });

  it('pickup.manualRequest — requestNow files a pickup regardless of the cutoff', async () => {
    const { cron, sdk } = makeCron();
    const res = await cron.requestNow('mer_1');

    expect(res).toEqual({ scheduled: true, count: 1 });
    expect(sdk.requestPickup).toHaveBeenCalled();
  });

  it('manual request with nothing pending reports scheduled:false', async () => {
    const { cron, sdk } = makeCron({ pending: [] });
    await expect(cron.requestNow('mer_1')).resolves.toEqual({ scheduled: false, count: 0 });
    expect(sdk.requestPickup).not.toHaveBeenCalled();
  });
});
