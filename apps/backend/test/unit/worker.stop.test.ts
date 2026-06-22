import { describe, expect, it } from 'vitest';
import { GoogleProductSyncWorker } from '../../src/modules/google/gmc/google-product-sync.worker';

describe('GoogleProductSyncWorker graceful stop', () => {
  it('onModuleDestroy stops the run loop', () => {
    const w = new GoogleProductSyncWorker({} as never, {} as never);
    (w as unknown as { running: boolean }).running = true;
    w.onModuleDestroy();
    expect((w as unknown as { running: boolean }).running).toBe(false);
  });
});
