import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

// Form ids are minted as `form_<base64url>` (FormsService.mintId) — the same
// shape asserted across the forms suite (`/^form_[A-Za-z0-9_-]+$/`). The bound
// length also caps pathological inputs.
const FORM_ID_RE = /^form_[A-Za-z0-9_-]{1,120}$/;

/**
 * Validates a `:formId` route param against the minted `form_<base64url>`
 * shape. Throws `INVALID_FORM_ID` BadRequest when malformed. Guards
 * path-traversal, control characters, and pathological length attacks in the
 * unauthenticated public / embed endpoints (mirrors `MerchantIdPipe`).
 */
@Injectable()
export class FormIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !FORM_ID_RE.test(value)) {
      throw new BadRequestException({
        message: 'invalid form id',
        error_code: 'INVALID_FORM_ID',
      });
    }
    return value;
  }
}
