import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ZodValidationPipe } from '../../../../src/core/common/pipes/zod-validation.pipe';
import {
  PublicSubmissionsController,
  publicSubmissionBodySchema,
} from '../../../../src/modules/forms/submissions/public-submissions.controller';
import type { SubmissionsService } from '../../../../src/modules/forms/submissions/submissions.service';

function makeController() {
  const service = {
    submitPublic: vi.fn(async () => ({ submissionId: 'sub_x' })),
    getPublicSchema: vi.fn(async () => ({ id: 'form_contact', name: 'Contact us' })),
  };
  const controller = new PublicSubmissionsController(service as unknown as SubmissionsService);
  return { controller, service };
}

const req = { ip: '203.0.113.9' } as never;

describe('PublicSubmissionsController (TDD §3.8)', () => {
  it('GET :formId delegates to the redacted public-schema read', async () => {
    const { controller, service } = makeController();
    const result = await controller.schema('form_contact');
    expect(service.getPublicSchema).toHaveBeenCalledWith('form_contact');
    expect(result).toMatchObject({ id: 'form_contact' });
  });

  it('POST :formId/submissions forwards ip + prefers body sessionId over the SDK header', async () => {
    const { controller, service } = makeController();
    await controller.submit(
      'form_contact',
      { fields: { name: 'A' }, sessionId: 'sess_body' },
      req,
      'sess_header',
    );
    expect(service.submitPublic).toHaveBeenCalledWith(
      'form_contact',
      expect.objectContaining({ fields: { name: 'A' } }),
      { ip: '203.0.113.9', sessionKey: 'sess_body' },
    );
  });

  it('falls back to the x-forms-session header, then to bare IP', async () => {
    const { controller, service } = makeController();
    await controller.submit('form_contact', { fields: {} }, req, 'sess_header');
    expect(service.submitPublic).toHaveBeenLastCalledWith('form_contact', expect.anything(), {
      ip: '203.0.113.9',
      sessionKey: 'sess_header',
    });

    await controller.submit('form_contact', { fields: {} }, req, undefined);
    expect(service.submitPublic).toHaveBeenLastCalledWith('form_contact', expect.anything(), {
      ip: '203.0.113.9',
    });
  });

  describe('transport body validation (the @Body pipe schema)', () => {
    const pipe = new ZodValidationPipe(publicSubmissionBodySchema);

    it('accepts the documented shape', () => {
      expect(() =>
        pipe.transform({
          fields: { name: 'A' },
          files: { resume: 'm_1/f_1/d/resume' },
          sessionId: 'sess_1',
          recaptchaToken: 'tok',
          _hp: '',
        }),
      ).not.toThrow();
    });

    it('rejects unknown top-level keys (strict transport shape)', () => {
      expect(() => pipe.transform({ fields: {}, merchantId: 'm_evil' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects a missing fields map and malformed files values', () => {
      expect(() => pipe.transform({})).toThrow(BadRequestException);
      expect(() => pipe.transform({ fields: {}, files: { resume: 42 } })).toThrow(
        BadRequestException,
      );
    });
  });
});
