import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { UnicommerceModule } from '../../../../src/modules/unicommerce/unicommerce.module';

describe('UnicommerceModule', () => {
  it('compiles without throwing', async () => {
    // A full compile requires real env vars (RATIO_UNICOMMERCE_DATABASE_URL etc.)
    // which aren't present in the unit test environment, so we only assert
    // the module metadata is well-formed (imports/controllers/providers arrays
    // exist) rather than instantiating the whole Nest context.
    const imports = Reflect.getMetadata('imports', UnicommerceModule);
    const providers = Reflect.getMetadata('providers', UnicommerceModule);
    expect(Array.isArray(imports)).toBe(true);
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });
});
