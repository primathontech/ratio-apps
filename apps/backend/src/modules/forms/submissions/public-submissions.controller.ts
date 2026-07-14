import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type ZodType, z } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import {
  type PublicFormSchema,
  type PublicSubmissionResult,
  SubmissionsService,
} from './submissions.service';

/**
 * Transport shape only — the REAL validation happens server-side against the
 * form's persisted schema (SchemaValidatorService). Extra top-level keys are
 * rejected here; unknown FIELD keys are rejected by the validator.
 */
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

/**
 * PUBLIC intake endpoints (TRD §2) — deliberately NO merchant guard: these
 * are called by shopper browsers via the storefront SDK. The merchant is
 * resolved SERVER-side from the form id; nothing merchant-identifying is
 * accepted from the client.
 *
 * Protection chain (AC6) — edge rate limit (main.ts 10/min bucket) runs
 * before Nest; the rest runs in order inside `SubmissionsService.submitPublic`.
 */
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
    // Idempotency scope preference: explicit body sessionId → SDK header →
    // client IP (SubmissionsService falls back to `meta.ip` when unset).
    const sessionKey = body.sessionId ?? session;
    return this.submissions.submitPublic(formId, body, {
      ip: req.ip,
      ...(sessionKey ? { sessionKey } : {}),
    });
  }
}
