import { describe, expect, it } from 'vitest';
import { UcStatusMappingService } from '../../../../src/modules/unicommerce/services/status-mapping.service';

describe('UcStatusMappingService.map', () => {
  const svc = new UcStatusMappingService();

  it('maps every forward-flow status from the corrected 17-value table', () => {
    expect(svc.map('DISPATCHED', false)).toBe('fulfilled');
    expect(svc.map('SHIPPED', false)).toBe('fulfilled');
    expect(svc.map('DELIVERED', false)).toBe('delivered');
    expect(svc.map('RETURNED', false)).toBe('returned');
    for (const noChange of [
      'CREATED', 'LOCATION_NOT_SERVICEABLE', 'PICKING', 'PICKED', 'PENDING_CUSTOMIZATION',
      'CUSTOMIZATION_COMPLETE', 'PACKED', 'READY_TO_SHIP', 'SPLITTED', 'MERGED', 'MANIFESTED',
    ]) {
      expect(svc.map(noChange, false)).toBe('no_change');
    }
  });

  it('maps every reverse-flow status', () => {
    expect(svc.map('CREATED', true)).toBe('return_pickup_scheduled');
    expect(svc.map('COURIER_ALLOCATED', true)).toBe('return_pickup_scheduled');
    expect(svc.map('COMPLETE', true)).toBe('restocked');
    expect(svc.map('NOT_RECEIVED', true)).toBe('return_failed');
  });

  it('throws on an unrecognized status rather than silently defaulting', () => {
    expect(() => svc.map('SOME_NEW_STATUS_NOT_IN_THE_TABLE', false)).toThrow(
      'unrecognized Unicommerce status: SOME_NEW_STATUS_NOT_IN_THE_TABLE (forward)',
    );
  });
});
