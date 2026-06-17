import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * Normalizes every error to the standard envelope:
 *   { status_code, message, error_code?, details?, request_id? }
 * Errors leak no internal stack traces in non-development.
 *
 * In production, `details` are stripped from forwarded `HttpException`
 * payloads UNLESS the thrown object explicitly opts in with
 * `safeForClient: true` — a guardrail so future contributors don't
 * accidentally leak internal context through a thrown HttpException.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const requestId = (req as { id?: string }).id;

    const { status, message, errorCode, details } = this.classify(exception);

    this.logger.error({
      msg: 'request failed',
      method: req.method,
      url: req.url,
      status,
      errorCode,
      request_id: requestId,
      err:
        exception instanceof Error
          ? { name: exception.name, message: exception.message }
          : exception,
    });

    if (requestId) {
      res.header('x-request-id', requestId);
    }

    // Pin the response content-type explicitly so any future Fastify config
    // that disables the default JSON serializer can't accidentally serve our
    // error envelope as text/plain (which clients parse differently).
    res.header('content-type', 'application/json; charset=utf-8');

    res.status(status).send({
      status_code: status,
      message,
      ...(errorCode ? { error_code: errorCode } : {}),
      ...(details ? { details } : {}),
      ...(requestId ? { request_id: requestId } : {}),
    });
  }

  /**
   * Recognize a ZodError across Zod versions. The shared package ships Zod 3
   * typings and the backend imports Zod 4 — `instanceof ZodError` (from
   * Zod 4) returns false for a Zod 3 ZodError thrown by `parse()`. Both
   * versions set `.name === 'ZodError'` and expose an `.issues` array, so
   * duck-type instead of using `instanceof`.
   */
  private isZodError(exception: unknown): boolean {
    if (exception instanceof ZodError) return true;
    if (
      exception !== null &&
      typeof exception === 'object' &&
      (exception as { name?: unknown }).name === 'ZodError' &&
      Array.isArray((exception as { issues?: unknown }).issues)
    ) {
      return true;
    }
    return false;
  }

  private classify(exception: unknown): {
    status: number;
    message: string;
    errorCode?: string;
    details?: unknown;
  } {
    if (this.isZodError(exception)) {
      const ze = exception as ZodError;
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'validation failed',
        errorCode: 'VALIDATION_ERROR',
        details: ze.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
      };
    }
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        // Guardrail: in production, refuse to forward `details` unless the
        // thrown object explicitly opts in via `safeForClient: true`. Nothing
        // throws with `details` today; this exists so a future contributor
        // can't accidentally leak internal context by attaching `details` to
        // an HttpException response.
        //
        // We build a *fresh* `safeObj` via spread instead of mutating the
        // exception's own response object — `HttpException.getResponse()`
        // returns the live reference the caller constructed, and other
        // consumers (e.g. tests that catch the exception, or other filters
        // in test setups) may inspect it after `catch` runs. Mutating it
        // here would be a spooky-action-at-a-distance bug.
        const isProd = process.env.NODE_ENV === 'production';
        const obj = exceptionResponse as {
          message?: string | string[];
          error_code?: string;
          details?: unknown;
          safeForClient?: boolean;
        };
        const safeObj =
          isProd && obj.safeForClient !== true && 'details' in obj
            ? { ...obj, details: undefined }
            : obj;
        return {
          status: exception.getStatus(),
          message: Array.isArray(safeObj.message)
            ? safeObj.message.join('; ')
            : (safeObj.message ?? exception.message),
          ...(safeObj.error_code !== undefined ? { errorCode: safeObj.error_code } : {}),
          ...(safeObj.details !== undefined ? { details: safeObj.details } : {}),
        };
      }
      return { status: exception.getStatus(), message: exception.message };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'internal server error',
      errorCode: 'INTERNAL',
    };
  }
}
