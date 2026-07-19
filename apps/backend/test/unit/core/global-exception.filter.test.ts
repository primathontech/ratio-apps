import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from '../../../src/core/common/filters/global-exception.filter';

// Stand-in for the vendor class; the filter duck-types on name + numeric
// status, so this local copy exercises the exact match path without core
// (or this test) importing the delhivery module.
class DelhiveryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DelhiveryApiError';
  }
}

function run(exception: unknown): { status: number; body: Record<string, unknown> } {
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    header: vi.fn(),
    status(s: number) {
      status = s;
      return this;
    },
    send(b: Record<string, unknown>) {
      body = b;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'POST', url: '/delhivery/api/shipments' }),
    }),
  } as unknown as ArgumentsHost;
  new GlobalExceptionFilter().catch(exception, host);
  return { status, body };
}

describe('GlobalExceptionFilter', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  it('maps a DelhiveryApiError with an out-of-range status to 422', () => {
    const msg = 'delhivery manifestation failed: ["insufficient balance"]';
    const { status, body } = run(new DelhiveryApiError(msg, 200));
    expect(status).toBe(422);
    expect(body).toMatchObject({
      status_code: 422,
      message: msg,
      error_code: 'DELHIVERY_ERROR',
    });
  });

  it('passes a 4xx/5xx DelhiveryApiError status through', () => {
    const { status, body } = run(new DelhiveryApiError('wallet empty', 402));
    expect(status).toBe(402);
    expect(body).toMatchObject({
      status_code: 402,
      message: 'wallet empty',
      error_code: 'DELHIVERY_ERROR',
    });
  });

  it('ignores a lookalike without a numeric status (falls back to 500)', () => {
    const err = new Error('no status here');
    err.name = 'DelhiveryApiError';
    const { status, body } = run(err);
    expect(status).toBe(500);
    expect(body).toMatchObject({ error_code: 'INTERNAL' });
  });

  it('still forwards HttpException status and message', () => {
    const { status, body } = run(new BadRequestException('bad input'));
    expect(status).toBe(400);
    expect(body).toMatchObject({ status_code: 400, message: 'bad input' });
  });

  it('still maps unknown errors to 500 INTERNAL', () => {
    const { status, body } = run(new Error('boom'));
    expect(status).toBe(500);
    expect(body).toMatchObject({
      status_code: 500,
      message: 'internal server error',
      error_code: 'INTERNAL',
    });
  });
});
