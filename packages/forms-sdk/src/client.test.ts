import { describe, expect, it, vi } from 'vitest';
import { FormsClient, FormsClientError } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeClient(responses: Array<{ status: number; body: unknown }>) {
  const fetchImpl = vi.fn();
  for (const { status, body } of responses) {
    fetchImpl.mockResolvedValueOnce(jsonResponse(status, body));
  }
  return { client: new FormsClient({ apiBase: '/forms' }, fetchImpl), fetchImpl };
}

const SCHEMA = {
  id: 'form_1',
  name: 'Contact',
  schema: [{ key: 'email', type: 'email', label: 'Email', required: true }],
  submitLabel: 'Send',
  successMessage: 'Thanks!',
  spamProtection: 'honeypot',
};

describe('FormsClient.getFormSchema', () => {
  it('GETs the public schema endpoint and unwraps the { data } envelope', async () => {
    const { client, fetchImpl } = makeClient([{ status: 200, body: { data: SCHEMA } }]);
    const schema = await client.getFormSchema('form_1');
    expect(schema.id).toBe('form_1');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/forms/public/v1/forms/form_1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('maps 403 form_inactive to a "form closed" error', async () => {
    const { client } = makeClient([
      { status: 403, body: { message: 'not accepting', error_code: 'form_inactive' } },
    ]);
    const err = (await client.getFormSchema('form_1').catch((e) => e)) as FormsClientError;
    expect(err).toBeInstanceOf(FormsClientError);
    expect(err.isFormClosed).toBe(true);
    expect(err.isFormUnavailable).toBe(false);
  });

  it('maps 403 form_unavailable (kill switch) and 404 to "unavailable"', async () => {
    const { client } = makeClient([
      { status: 403, body: { error_code: 'form_unavailable' } },
      { status: 404, body: { error_code: 'form_not_available' } },
    ]);
    const killSwitched = (await client.getFormSchema('f').catch((e) => e)) as FormsClientError;
    expect(killSwitched.isFormUnavailable).toBe(true);
    const deleted = (await client.getFormSchema('f').catch((e) => e)) as FormsClientError;
    expect(deleted.isFormUnavailable).toBe(true);
  });
});

describe('FormsClient.submit', () => {
  it('POSTs the submission body and returns the submissionId', async () => {
    const { client, fetchImpl } = makeClient([
      { status: 200, body: { data: { submissionId: 'sub_1' } } },
    ]);
    const result = await client.submit('form_1', {
      fields: { email: 'a@b.co' },
      sessionId: 'wz_x',
      _hp: '',
    });
    expect(result.submissionId).toBe('sub_1');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/forms/public/v1/forms/form_1/submissions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      fields: { email: 'a@b.co' },
      sessionId: 'wz_x',
      _hp: '',
    });
  });

  it('maps 409 to isDuplicate', async () => {
    const { client } = makeClient([
      { status: 409, body: { message: 'dup', error_code: 'duplicate_submission' } },
    ]);
    const err = (await client.submit('f', { fields: {} }).catch((e) => e)) as FormsClientError;
    expect(err.isDuplicate).toBe(true);
  });

  it('maps 422 to isValidationError with per-field errors', async () => {
    const { client } = makeClient([
      {
        status: 422,
        body: {
          message: 'submission validation failed',
          error_code: 'SUBMISSION_INVALID',
          details: { fields: { email: 'must be a valid email address' } },
        },
      },
    ]);
    const err = (await client.submit('f', { fields: {} }).catch((e) => e)) as FormsClientError;
    expect(err.isValidationError).toBe(true);
    expect(err.fieldErrors).toEqual({ email: 'must be a valid email address' });
  });

  it('maps 429 to isRateLimited', async () => {
    const { client } = makeClient([
      { status: 429, body: { message: 'slow down', error_code: 'RATE_LIMITED' } },
    ]);
    const err = (await client.submit('f', { fields: {} }).catch((e) => e)) as FormsClientError;
    expect(err.isRateLimited).toBe(true);
  });
});

describe('FormsClient uploads', () => {
  it('requestUpload POSTs the field/type/size and returns the presign target', async () => {
    const { client, fetchImpl } = makeClient([
      {
        status: 200,
        body: { data: { uploadUrl: 'https://s3/put?sig=1', objectKey: 'm1/form_1/d1/resume' } },
      },
    ]);
    const target = await client.requestUpload('form_1', {
      fieldKey: 'resume',
      contentType: 'application/pdf',
      size: 1234,
    });
    expect(target.objectKey).toBe('m1/form_1/d1/resume');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/forms/public/v1/forms/form_1/uploads');
    expect(JSON.parse(String(init.body))).toEqual({
      fieldKey: 'resume',
      contentType: 'application/pdf',
      size: 1234,
    });
  });

  it('uploadFile PUTs the bytes to the presigned URL and throws on non-2xx', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    const client = new FormsClient({ apiBase: '/forms' }, fetchImpl);
    const blob = new Blob(['x'], { type: 'application/pdf' });
    await client.uploadFile({ uploadUrl: 'https://s3/put', objectKey: 'k' }, blob);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://s3/put',
      expect.objectContaining({ method: 'PUT', body: blob }),
    );
    await expect(
      client.uploadFile({ uploadUrl: 'https://s3/put', objectKey: 'k' }, blob),
    ).rejects.toBeInstanceOf(FormsClientError);
  });
});
