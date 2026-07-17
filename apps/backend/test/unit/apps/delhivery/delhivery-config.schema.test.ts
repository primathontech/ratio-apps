import {
  delhiveryConfigInputSchema,
  delhiveryConfigSchema,
} from '@ratio-app/shared/schemas/delhivery-config';
import { describe, expect, it } from 'vitest';

const valid = {
  apiToken: 'dlv-token-1234567890',
  pickupLocationName: 'Main Warehouse BLR',
  pickupPincode: '560001',
  pickupPhone: '9876543210',
  pickupAddress: '1 MG Road',
  pickupCity: 'Bengaluru',
  gstin: '29ABCDE1234F1Z5',
  pickupCutoff: '10:00',
  awbTrigger: 'auto',
  defaultBox: { l: 10, b: 12, h: 8 },
  enabled: true,
};

describe('delhivery-config schema (TDD §5)', () => {
  it('schema.acceptsValid — full config parses', () => {
    const parsed = delhiveryConfigSchema.parse(valid);
    expect(parsed.apiToken).toBe(valid.apiToken);
    expect(parsed.defaultBox).toEqual({ l: 10, b: 12, h: 8 });
  });

  it('schema.acceptsValid — input schema fills defaults for omitted fields', () => {
    const { pickupCutoff, awbTrigger, enabled, ...minimal } = valid;
    const parsed = delhiveryConfigInputSchema.parse(minimal);
    expect(parsed.apiToken).toBe(valid.apiToken);
    // Zod fills the schema defaults even through `.partial()`.
    expect(parsed.pickupCutoff).toBe('10:00');
  });

  it('schema.tokenRequiredOnBase_optionalOnInput', () => {
    const { apiToken, ...rest } = valid;
    // The full config always carries a token.
    expect(delhiveryConfigSchema.safeParse(rest).success).toBe(false);
    expect(delhiveryConfigSchema.safeParse({ ...rest, apiToken: '' }).success).toBe(false);
    // The PUT input shape does not: the token is write-only (never round-trips),
    // so blank/omitted is valid here. The backend requires one only on first setup.
    expect(delhiveryConfigInputSchema.safeParse(rest).success).toBe(true);
    expect(delhiveryConfigInputSchema.safeParse({ ...rest, apiToken: '' }).success).toBe(true);
  });

  it('schema.rejectsBadCutoff (non-HH:mm)', () => {
    for (const bad of ['25:00', '9:00', '10:60', '10.00', 'ten', '']) {
      expect(delhiveryConfigSchema.safeParse({ ...valid, pickupCutoff: bad }).success).toBe(false);
    }
    expect(delhiveryConfigSchema.safeParse({ ...valid, pickupCutoff: '23:59' }).success).toBe(true);
  });

  it('schema.rejectsInvalidAwbTrigger', () => {
    expect(delhiveryConfigSchema.safeParse({ ...valid, awbTrigger: 'always' }).success).toBe(false);
    expect(delhiveryConfigSchema.safeParse({ ...valid, awbTrigger: 'manual' }).success).toBe(true);
  });

  it('schema.rejectsBadPickupPincode (not 6 digits)', () => {
    for (const bad of ['12345', '1234567', 'ABCDEF', '', '12 345']) {
      expect(delhiveryConfigSchema.safeParse({ ...valid, pickupPincode: bad }).success).toBe(false);
    }
    expect(delhiveryConfigSchema.safeParse({ ...valid, pickupPincode: '560001' }).success).toBe(true);
  });

  it('schema.rejectsBadPickupPhone (not 10 digits)', () => {
    for (const bad of ['98765', '98765432101', 'phone12345', '']) {
      expect(delhiveryConfigSchema.safeParse({ ...valid, pickupPhone: bad }).success).toBe(false);
    }
    expect(delhiveryConfigSchema.safeParse({ ...valid, pickupPhone: '9876543210' }).success).toBe(true);
  });

  it('schema.requiresPickupAddress', () => {
    const { pickupAddress, ...rest } = valid;
    expect(delhiveryConfigInputSchema.safeParse(rest).success).toBe(false);
    expect(delhiveryConfigInputSchema.safeParse({ ...rest, pickupAddress: '' }).success).toBe(false);
  });

  it('schema.pickupCityDefaultsToEmpty', () => {
    const { pickupCity, ...rest } = valid;
    const parsed = delhiveryConfigInputSchema.parse(rest);
    expect(parsed.pickupCity).toBe('');
  });

  it('schema.rejectsNegativeBoxDims', () => {
    expect(
      delhiveryConfigSchema.safeParse({ ...valid, defaultBox: { l: -1, b: 10, h: 10 } }).success,
    ).toBe(false);
    expect(
      delhiveryConfigSchema.safeParse({ ...valid, defaultBox: { l: 10, b: 0, h: 10 } }).success,
    ).toBe(false);
    expect(
      delhiveryConfigSchema.safeParse({ ...valid, defaultBox: { l: 10, b: 10, h: 1.5 } }).success,
    ).toBe(false);
  });
});
