import { describe, expect, it, vi } from 'vitest';
import { GoogleConfigController } from '../../../../src/modules/google/config/config.controller';
import type { GoogleConfigService } from '../../../../src/modules/google/config/config.service';
import type { GmcValidationService } from '../../../../src/modules/google/gmc/gmc-validation.service';
import type { DiscoveryService } from '../../../../src/modules/google/discovery/discovery.service';

describe('GoogleConfigController.discover', () => {
  it('delegates to DiscoveryService with the current merchant id', async () => {
    const payload = { ga4: { streams: [] }, gmc: { accounts: [] } };
    const discovery = { discover: vi.fn(async () => payload) } as unknown as DiscoveryService;
    const controller = new GoogleConfigController(
      {} as GoogleConfigService,
      {} as GmcValidationService,
      discovery,
    );

    const result = await controller.discover({ id: 'm1' } as never);

    expect(discovery.discover).toHaveBeenCalledWith('m1');
    expect(result).toBe(payload);
  });
});
