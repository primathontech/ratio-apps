import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type ZodType, z } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import {
  type PublicFormSchema,
  type PublicSubmissionResult,
  SubmissionsService,
} from './submissions.service';

/** Transport shape only (extra top-level keys rejected here); the real validation is server-side in SchemaValidatorService. */
export const publicSubmissionBodySchema = z
  .object({
    fields: z.record(z.string(), z.unknown()),
    files: z.record(z.string(), z.string().min(1).max(1024)).optional(),
    /** SDK-minted session id — the idempotency scope (falls back to IP). */
    sessionId: z.string().min(1).max(128).optional(),
    recaptchaToken: z.string().max(4096).optional(),
    _hp: z.string().max(1024).optional(),
  })
  .strict();

type PublicSubmissionBody = z.infer<typeof publicSubmissionBodySchema>;

const bodyPipe = new ZodValidationPipe(
  publicSubmissionBodySchema as unknown as ZodType<PublicSubmissionBody>,
);

/** Public intake endpoints (TRD §2, AC6) — deliberately NO merchant guard: the merchant is resolved server-side from the form id, nothing merchant-identifying is accepted from the client. */
@Controller('forms/public/v1/forms')
export class PublicSubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  /** Render schema for the SDK — active forms only, secrets stripped. */
  @Get(':formId')
  async schema(@Param('formId') formId: string): Promise<PublicFormSchema> {
    return this.submissions.getPublicSchema(formId);
  }

  /** THE public intake. 200 {submissionId} | 403 | 422 | 429 envelopes. */
  @Post(':formId/submissions')
  async submit(
    @Param('formId') formId: string,
    @Body(bodyPipe) body: PublicSubmissionBody,
    @Req() req: FastifyRequest,
    @Headers('x-forms-session') session?: string,
  ): Promise<PublicSubmissionResult> {
    // Idempotency scope preference: body sessionId → SDK header → client IP (service falls back to `meta.ip`).
    const sessionKey = body.sessionId ?? session;
    return this.submissions.submitPublic(formId, body, {
      ip: req.ip,
      ...(sessionKey ? { sessionKey } : {}),
    });
  }
}
