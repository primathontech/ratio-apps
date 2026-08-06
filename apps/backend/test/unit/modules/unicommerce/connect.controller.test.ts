import { ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UcConnectController } from '../../../../src/modules/unicommerce/controllers/connect.controller';
import { CredentialsAlreadyExistError } from '../../../../src/modules/unicommerce/services/credentials.service';

function fakeConfig(publicBaseUrl: string | undefined) {
  return { get: () => publicBaseUrl } as never;
}

describe('UcConnectController.generate', () => {
  it('builds the baseUrl from RATIO_UNICOMMERCE_PUBLIC_BASE_URL, not a hardcoded placeholder', async () => {
    const credentials = {
      generate: vi.fn().mockResolvedValue({ username: 'ratio-abc', password: 'secret' }),
    };
    const controller = new UcConnectController(
      credentials as never,
      fakeConfig('https://my-tunnel.example'),
    );

    const result = await controller.generate({ merchantId: 'm1', ucUsername: 'uc-login' });

    expect(result).toEqual({
      username: 'ratio-abc',
      password: 'secret',
      baseUrl: 'https://my-tunnel.example/unicommerce/api/v1',
    });
  });

  it('throws a clear error rather than a wrong/placeholder URL when unconfigured', async () => {
    const credentials = {
      generate: vi.fn().mockResolvedValue({ username: 'ratio-abc', password: 'secret' }),
    };
    const controller = new UcConnectController(credentials as never, fakeConfig(undefined));

    await expect(
      controller.generate({ merchantId: 'm1', ucUsername: 'uc-login' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('translates a duplicate-credentials conflict into a clear 409, not a bare 500', async () => {
    const credentials = {
      generate: vi.fn().mockRejectedValue(new CredentialsAlreadyExistError('m1')),
    };
    const controller = new UcConnectController(
      credentials as never,
      fakeConfig('https://my-tunnel.example'),
    );

    await expect(
      controller.generate({ merchantId: 'm1', ucUsername: 'uc-login' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('UcConnectController.getCredentials', () => {
  it('returns the existing credentials with the baseUrl attached', async () => {
    const credentials = {
      getCredentials: vi.fn().mockResolvedValue({
        username: 'ratio-abc',
        password: 'secret',
        ucUsername: 'uc-login',
        lastInboundCallAt: null,
      }),
    };
    const controller = new UcConnectController(
      credentials as never,
      fakeConfig('https://my-tunnel.example'),
    );

    const result = await controller.getCredentials('m1');

    expect(result).toEqual({
      username: 'ratio-abc',
      password: 'secret',
      ucUsername: 'uc-login',
      lastInboundCallAt: null,
      baseUrl: 'https://my-tunnel.example/unicommerce/api/v1',
    });
  });

  // Backs the Admin UI's connection-status display (§7) — the last time UC
  // called us at all, proving the connection is genuinely alive.
  it('passes through a real lastInboundCallAt timestamp for the connection-status display', async () => {
    const lastInboundCallAt = new Date('2026-07-20T10:00:00.000Z');
    const credentials = {
      getCredentials: vi.fn().mockResolvedValue({
        username: 'ratio-abc',
        password: 'secret',
        ucUsername: 'uc-login',
        lastInboundCallAt,
      }),
    };
    const controller = new UcConnectController(
      credentials as never,
      fakeConfig('https://my-tunnel.example'),
    );

    const result = await controller.getCredentials('m1');

    expect(result?.lastInboundCallAt).toBe(lastInboundCallAt);
  });

  it('returns null when the merchant has no credentials yet', async () => {
    const credentials = { getCredentials: vi.fn().mockResolvedValue(null) };
    const controller = new UcConnectController(
      credentials as never,
      fakeConfig('https://my-tunnel.example'),
    );

    expect(await controller.getCredentials('m1')).toBeNull();
  });
});

describe('UcConnectController.regenerate', () => {
  it('returns the new credentials on success', async () => {
    const credentials = {
      regenerate: vi.fn().mockResolvedValue({ username: 'ratio-new', password: 'new-secret' }),
    };
    const controller = new UcConnectController(
      credentials as never,
      fakeConfig('https://my-tunnel.example'),
    );

    const result = await controller.regenerate({ merchantId: 'm1' });

    expect(result).toEqual({
      username: 'ratio-new',
      password: 'new-secret',
      baseUrl: 'https://my-tunnel.example/unicommerce/api/v1',
    });
  });

  it('throws NotFoundException when there is nothing to regenerate', async () => {
    const credentials = { regenerate: vi.fn().mockResolvedValue(null) };
    const controller = new UcConnectController(
      credentials as never,
      fakeConfig('https://my-tunnel.example'),
    );

    await expect(controller.regenerate({ merchantId: 'm1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
