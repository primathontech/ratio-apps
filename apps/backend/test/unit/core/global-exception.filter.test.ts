import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GlobalExceptionFilter } from '../../../src/core/common/filters/global-exception.filter';

/** Minimal fake ArgumentsHost — the filter only ever calls switchToHttp().getResponse()/getRequest(). */
function fakeHost(req: Record<string, unknown> = {}) {
  const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    header: vi.fn((key: string, value: string) => {
      sent.headers[key] = value;
      return res;
    }),
    status: vi.fn((code: number) => {
      sent.status = code;
      return res;
    }),
    send: vi.fn((body: unknown) => {
      sent.body = body;
      return res;
    }),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'POST', url: '/unicommerce/api/v1/orders/dispatch', id: 'req-1', ...req }),
    }),
  };
  return { host: host as never, sent };
}

describe('GlobalExceptionFilter', () => {
  it('maps an unrecognized thrown value to a generic 500 (baseline/regression)', () => {
    const filter = new GlobalExceptionFilter();
    const { host, sent } = fakeHost();

    filter.catch(new Error('boom'), host);

    expect(sent.status).toBe(500);
    expect(sent.body).toMatchObject({ status_code: 500, message: 'internal server error', error_code: 'INTERNAL' });
  });

  it('maps a ZodError to 400 VALIDATION_ERROR (regression)', () => {
    const filter = new GlobalExceptionFilter();
    const { host, sent } = fakeHost();
    const zodError = z.object({ x: z.string() }).safeParse({}).error;

    filter.catch(zodError, host);

    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ status_code: 400, error_code: 'VALIDATION_ERROR' });
  });

  it('maps a real HttpException using its own status/response (regression)', () => {
    const filter = new GlobalExceptionFilter();
    const { host, sent } = fakeHost();

    filter.catch(new BadRequestException({ message: 'nope', error_code: 'BAD' }), host);

    expect(sent.status).toBe(400);
    expect(sent.body).toMatchObject({ status_code: 400, message: 'nope', error_code: 'BAD' });
  });

  // Found via live testing: @fastify/rate-limit (main.ts) doesn't send its
  // 429 response directly despite the documented intent — it literally
  // `throw`s the object its own errorResponseBuilder constructed, which
  // lands right here like any other exception. Without recognizing this
  // shape, every rate-limited request was reported to the client as a bare
  // 500, discarding the real 429/RATE_LIMITED/retryAfter info already computed.
  it('maps the rate-limiter\'s thrown error object to its own 429/RATE_LIMITED shape, not a generic 500', () => {
    const filter = new GlobalExceptionFilter();
    const { host, sent } = fakeHost();
    const rateLimitError = {
      status_code: 429,
      message: 'too many requests',
      error_code: 'RATE_LIMITED',
      details: { retryAfter: '39 seconds', max: 20 },
    };

    filter.catch(rateLimitError, host);

    expect(sent.status).toBe(429);
    expect(sent.body).toMatchObject({
      status_code: 429,
      message: 'too many requests',
      error_code: 'RATE_LIMITED',
      details: { retryAfter: '39 seconds', max: 20 },
    });
  });

  it('does not misclassify a plain object that merely happens to have a message field', () => {
    const filter = new GlobalExceptionFilter();
    const { host, sent } = fakeHost();

    filter.catch({ message: 'some unrelated plain object' }, host);

    expect(sent.status).toBe(500);
    expect(sent.body).toMatchObject({ status_code: 500, error_code: 'INTERNAL' });
  });
});
