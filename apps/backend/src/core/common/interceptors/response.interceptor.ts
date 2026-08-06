import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { map, type Observable } from 'rxjs';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

export interface ResponseEnvelope<T> {
  status_code: number;
  message: string;
  data: T;
  request_id?: string;
}

function isRedirectShape(data: unknown): data is { url: string; statusCode?: number } {
  return !!data && typeof data === 'object' && typeof (data as { url?: unknown }).url === 'string';
}

/**
 * Wraps controller return values in the standard envelope.
 * - Routes/controllers decorated with `@RawResponse()` (see
 *   `../decorators/raw-response.decorator.ts`) bypass this entirely — their
 *   return value is passed through completely unmodified. Used by
 *   inbound integration endpoints (e.g. the Unicommerce-facing controllers)
 *   that must return a third-party platform's own documented flat contract.
 * - Already-enveloped responses pass through unchanged.
 * - @Redirect() return shapes ({ url, statusCode? }) pass through so NestJS's
 *   redirect handler can consume them.
 * - SDK endpoints that emit raw JS use @Res() + reply.send() and bypass this
 *   interceptor entirely.
 * - The `x-request-id` header is echoed on every response so clients can
 *   correlate to server logs (pino sets `req.id` from the same header, via
 *   `genReqId` in app.module.ts).
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const res = http.getResponse<FastifyReply>();
    const requestId = (req as { id?: string }).id;
    if (requestId) {
      res.header('x-request-id', requestId);
    }

    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isRaw) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && 'status_code' in data && 'message' in data) {
          // Already-enveloped response. Backfill request_id if missing so
          // every envelope carries it.
          const envelope = data as Record<string, unknown>;
          if (requestId && envelope.request_id === undefined) {
            return { ...envelope, request_id: requestId };
          }
          return data as ResponseEnvelope<unknown>;
        }
        if (isRedirectShape(data)) {
          return data;
        }
        return {
          status_code: 200,
          message: 'success',
          data,
          ...(requestId ? { request_id: requestId } : {}),
        };
      }),
    );
  }
}
