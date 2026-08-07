import { describe, expect, it } from 'vitest';
import { DISABLED_ROUTE, type MerchantGateInput, resolveMerchantGate } from './merchant-gate';

function input(overrides: Partial<MerchantGateInput> = {}): MerchantGateInput {
  return {
    isAuthorized: true,
    parentOrigin: 'https://merchant.gokwik.co',
    sessionChecked: true,
    token: 'm1',
    merchant: { isLoading: false, isError: false, isActive: true, hasData: true },
    ...overrides,
  };
}

describe('resolveMerchantGate', () => {
  it('routes an INACTIVE merchant to /disabled instead of the config form', () => {
    const gate = resolveMerchantGate(
      input({ merchant: { isLoading: false, isError: false, isActive: false, hasData: true } }),
    );
    expect(gate.kind).toBe('disabled');
    expect(DISABLED_ROUTE).toBe('/disabled');
  });

  it('lets an active merchant through', () => {
    expect(resolveMerchantGate(input()).kind).toBe('ready');
  });

  it('blocks before any merchant lookup when the iframe embed check fails', () => {
    const gate = resolveMerchantGate(input({ isAuthorized: false }));
    expect(gate).toEqual({ kind: 'embed-blocked', parentOrigin: 'https://merchant.gokwik.co' });
  });

  it('waits while the embed check is undecided', () => {
    expect(resolveMerchantGate(input({ isAuthorized: null })).kind).toBe('checking');
  });

  it('reports no-session when there is no merchant token', () => {
    expect(resolveMerchantGate(input({ token: null })).kind).toBe('no-session');
  });

  it('waits until the session has been read from URL/localStorage', () => {
    expect(resolveMerchantGate(input({ sessionChecked: false, token: null })).kind).toBe(
      'checking',
    );
  });

  it('waits while the merchant query is loading', () => {
    expect(
      resolveMerchantGate(input({ merchant: { isLoading: true, isError: false, hasData: false } }))
        .kind,
    ).toBe('checking');
  });

  it('surfaces the merchant error code on a failed lookup', () => {
    expect(
      resolveMerchantGate(
        input({
          merchant: {
            isLoading: false,
            isError: true,
            errorCode: 'MERCHANT_NOT_FOUND',
            hasData: false,
          },
        }),
      ),
    ).toEqual({ kind: 'invalid', errorCode: 'MERCHANT_NOT_FOUND' });
  });

  it('treats a merchant row with a missing isActive flag as disabled (fail closed)', () => {
    expect(
      resolveMerchantGate(input({ merchant: { isLoading: false, isError: false, hasData: true } }))
        .kind,
    ).toBe('disabled');
  });
});
