import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Generic Zod validation pipe.
 *
 * Two modes:
 *   1. Global pipe (no schema): validates nothing, acts as a passthrough.
 *      Used in configure-app.ts as a base global pipe.
 *   2. Per-decorator (with schema): parses the incoming value and throws 400
 *      on failure. Usage: @Body(new ZodValidationPipe(mySchema)) body: MyType
 */
@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform {
  constructor(private readonly schema?: ZodSchema<T>) {}

  transform(value: unknown): T {
    if (!this.schema) return value as T;
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'validation failed',
        error_code: 'INVALID_REQUEST_BODY',
        details: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
