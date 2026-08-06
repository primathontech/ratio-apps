import { describe, expect, it } from 'vitest';
import { UcEventLogService } from '../../../../src/modules/unicommerce/services/event-log.service';

describe('UcEventLogService.record', () => {
  it('writes one row per call with the full context needed for the dashboard', async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      db: {
        insertInto: () => ({
          values: (v: Record<string, unknown>) => {
            inserted.push(v);
            return { execute: async () => undefined };
          },
        }),
      },
    };
    const svc = new UcEventLogService(db as never);

    await svc.record({
      merchantId: 'm1',
      direction: 'outbound',
      flow: 'order_push',
      reference: 'order-1',
      result: 'success',
      payload: { code: 'ratio-order-1' },
      response: { saleOrderCode: 'UC-1' },
    });

    expect(inserted[0]).toMatchObject({
      merchantId: 'm1',
      direction: 'outbound',
      flow: 'order_push',
      reference: 'order-1',
      result: 'success',
    });
  });
});
