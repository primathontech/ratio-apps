// The forms PUBLIC API contract (TRD §2 /forms/public/v1/*): schema fetch,
// presigned upload, and submission intake. Types come from `@ratio-app/shared`
// TYPE-ONLY so Zod never reaches the browser bundle.
import type { FormAppearance, FormField } from '@ratio-app/shared';

/** Runtime config injected by the backend SDK prelude (sdk.service.ts). */
export interface FormsClientConfig {
  /** e.g. `/forms` (same-origin) or `https://api.example.com/forms`. */
  apiBase: string;
}

/** The redacted render schema `GET /public/v1/forms/:formId` serves. */
export interface PublicFormSchema {
  id: string;
  name: string;
  /** Optional subtitle rendered under the form name. */
  description?: string;
  schema: FormField[];
  submitLabel: string;
  successMessage: string;
  /** https-only redirect target followed shortly after a successful submit. */
  redirectUrl?: string;
  spamProtection: 'recaptcha' | 'honeypot';
  recaptchaSiteKey?: string;
  /** Optional rich-theming tokens; absent for un-themed forms. */
  appearance?: FormAppearance;
}

export interface UploadRequest {
  fieldKey: string;
  contentType: string;
  size: number;
}

export interface UploadTarget {
  uploadUrl: string;
  objectKey: string;
}

export interface SubmissionInput {
  fields: Record<string, unknown>;
  files?: Record<string, string>;
  sessionId?: string;
  recaptchaToken?: string;
  /** Honeypot value — forwarded verbatim (must be empty for humans). */
  _hp?: string;
}

export interface SubmissionResult {
  submissionId: string;
}

/**
 * Thrown for every non-2xx response. `errorCode` carries the backend's
 * `error_code` (e.g. `form_inactive`, `form_unavailable`,
 * `duplicate_submission`, `RATE_LIMITED`, `SUBMISSION_INVALID`), and
 * `fieldErrors` the per-field messages of a 422.
 */
export class FormsClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errorCode?: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = 'FormsClientError';
  }

  /** 403 `form_inactive` — the form exists but is unpublished ("form closed"). */
  get isFormClosed(): boolean {
    return this.errorCode === 'form_inactive';
  }

  /** 403 kill switch / 404 deleted — "no longer available". */
  get isFormUnavailable(): boolean {
    return this.status === 404 || this.errorCode === 'form_unavailable';
  }

  get isDuplicate(): boolean {
    return this.status === 409;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isValidationError(): boolean {
    return this.status === 422;
  }
}

interface ErrorEnvelope {
  message?: string;
  error_code?: string;
  details?: { fields?: Record<string, string> };
}

/**
 * Typed `fetch` wrapper over the forms public storefront API. Browser-safe:
 * no credentials of any kind — these endpoints are deliberately public.
 */
export class FormsClient {
  constructor(
    private readonly cfg: FormsClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  /** Render schema for a published form. 403/404 map to FormsClientError. */
  getFormSchema(formId: string): Promise<PublicFormSchema> {
    return this.request<PublicFormSchema>('GET', `/public/v1/forms/${encodeURIComponent(formId)}`);
  }

  /** Presigned PUT for a file field — call before `submit`, PUT the bytes, then attach `objectKey`. */
  requestUpload(formId: string, body: UploadRequest): Promise<UploadTarget> {
    return this.request<UploadTarget>(
      'POST',
      `/public/v1/forms/${encodeURIComponent(formId)}/uploads`,
      body,
    );
  }

  /** Upload the file bytes to the presigned URL. */
  async uploadFile(target: UploadTarget, file: Blob): Promise<void> {
    const res = await this.fetchImpl(target.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    });
    if (!res.ok) {
      throw new FormsClientError(res.status, 'file upload failed');
    }
  }

  /** THE public intake. 200 → submissionId; 403/409/422/429 → FormsClientError. */
  submit(formId: string, input: SubmissionInput): Promise<SubmissionResult> {
    return this.request<SubmissionResult>(
      'POST',
      `/public/v1/forms/${encodeURIComponent(formId)}/submissions`,
      input,
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.cfg.apiBase}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        // Dev-tunnel quirk: ngrok's free tier serves an HTML warning page
        // without this header. Sent only to *.ngrok-free.* API bases.
        ...(/\.ngrok-free\.(dev|app)(:|\/|$)/.test(this.cfg.apiBase)
          ? { 'ngrok-skip-browser-warning': '1' }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }
    }
    if (!res.ok) {
      const envelope = json as ErrorEnvelope;
      throw new FormsClientError(
        res.status,
        envelope.message ?? `request failed (${res.status})`,
        envelope.error_code,
        envelope.details?.fields,
      );
    }
    // The backend's global ResponseInterceptor wraps payloads as `{ data }`.
    const wrapped = json as { data?: T };
    return (wrapped.data ?? json) as T;
  }
}
