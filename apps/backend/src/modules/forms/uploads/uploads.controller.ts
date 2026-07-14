import {
  Body,
  Controller,
  HttpException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  type FormField,
} from '@ratio-app/shared/schemas/form-schema';
import type { FastifyRequest } from 'fastify';
import { type ZodType, z } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { SubmitRateLimitService } from '../spam/submit-rate-limit.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { FormsS3Service } from './s3.service';

const uploadBodySchema = z
  .object({
    fieldKey: z.string().min(1).max(64),
    contentType: z.string().min(1).max(255),
    size: z.number().int().positive(),
  })
  .strict();

type UploadBody = z.infer<typeof uploadBodySchema>;

const uploadBodyPipe = new ZodValidationPipe(uploadBodySchema as unknown as ZodType<UploadBody>);

/**
 * PUBLIC presigned-upload endpoint (TRD §2) — file fields upload BEFORE
 * submit; the returned `objectKey` is attached to the submission's `files`
 * map (and re-validated against the `<merchantId>/<formId>/` prefix there).
 *
 * Same protection front as the public submit: the edge 10/min bucket, the
 * app-level 5-per-10-min (form, IP) limiter, and the form-active/kill-switch
 * gate all run before any presigning. Constraints (F2/F3): content type ∈
 * field allowlist ∩ platform allowlist → else 422; size ≤ min(field cap,
 * 5 MB) → else 413. Uploads disabled (no bucket) → 503 `uploads_unavailable`.
 */
@Controller('forms/public/v1/forms')
export class UploadsController {
  constructor(
    private readonly s3: FormsS3Service,
    private readonly submissions: SubmissionsService,
    private readonly rateLimit: SubmitRateLimitService,
  ) {}

  @Post(':formId/uploads')
  async createUpload(
    @Param('formId') formId: string,
    @Body(uploadBodyPipe) body: UploadBody,
    @Req() req: FastifyRequest,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    if (!this.s3.enabled) {
      throw new ServiceUnavailableException({
        message: 'file uploads are not available',
        error_code: 'uploads_unavailable',
      });
    }
    // Same app-level business limit as submissions (uploads precede them).
    if (!(await this.rateLimit.allow(formId, req.ip))) {
      throw new HttpException(
        { message: 'too many submissions — try again later', error_code: 'RATE_LIMITED' },
        429,
      );
    }
    // Form must exist, be active, and not be kill-switched — 403 otherwise.
    const ctx = await this.submissions.loadActiveForm(formId);

    const field = ctx.schema.find(
      (f): f is Extract<FormField, { type: 'file' }> =>
        f.key === body.fieldKey && f.type === 'file',
    );
    if (!field) {
      throw new UnprocessableEntityException({
        message: 'no such file field on this form',
        error_code: 'UNKNOWN_FILE_FIELD',
        details: { fields: { [body.fieldKey]: 'not a file field of this form' } },
        safeForClient: true,
      });
    }

    // Content type must be in the field's allowlist AND the platform allowlist.
    const allowed = field.validation?.allowedMimeTypes ?? [...FORM_FILE_ALLOWED_MIME_TYPES];
    if (
      !(FORM_FILE_ALLOWED_MIME_TYPES as readonly string[]).includes(body.contentType) ||
      !(allowed as readonly string[]).includes(body.contentType)
    ) {
      throw new UnprocessableEntityException({
        message: 'file type not allowed',
        error_code: 'FILE_TYPE_NOT_ALLOWED',
        details: { fields: { [body.fieldKey]: `allowed types: ${allowed.join(', ')}` } },
        safeForClient: true,
      });
    }

    const maxBytes = Math.min(
      field.validation?.maxBytes ?? FORM_FILE_MAX_BYTES,
      FORM_FILE_MAX_BYTES,
    );
    if (body.size > maxBytes) {
      throw new HttpException(
        {
          message: 'file too large',
          error_code: 'FILE_TOO_LARGE',
          details: { fields: { [body.fieldKey]: `maximum size is ${maxBytes} bytes` } },
          safeForClient: true,
        },
        413,
      );
    }

    return this.s3.createUpload({
      merchantId: ctx.form.merchantId,
      formId: ctx.form.id,
      fieldKey: field.key,
      contentType: body.contentType,
      size: body.size,
    });
  }
}
