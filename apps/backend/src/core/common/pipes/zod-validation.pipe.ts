import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Standard NestJS pipe that validates `@Body() body: T` when T's metatype is a
 * Zod schema instance. Controllers should declare:
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createDto)) body: CreateDto) { ... }
 *
 * Where `createDto = z.object({...})` and `type CreateDto = z.infer<typeof createDto>`.
 */
@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform<unknown, T> {
  constructor(private readonly schema?: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    if (!this.schema) return value as T;
    return this.schema.parse(value) as T;
  }
}
