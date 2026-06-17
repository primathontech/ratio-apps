import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

const MERCHANT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Validates a `:merchantId` route param against `/^[A-Za-z0-9_-]{1,128}$/`.
 * Throws `INVALID_MERCHANT_ID` BadRequest when input is malformed (fixes
 * Finding #4). This guards against path-traversal, control characters, and
 * pathological length attacks in unauthenticated SDK endpoints.
 */
@Injectable()
export class MerchantIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !MERCHANT_ID_RE.test(value)) {
      throw new BadRequestException({
        message: 'invalid merchant id',
        error_code: 'INVALID_MERCHANT_ID',
      });
    }
    return value;
  }
}
