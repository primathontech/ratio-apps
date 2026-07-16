// Type-only shapes of the shared form-schema contract (no Zod in the bundle).
import type { FormField } from '@ratio-app/shared';
import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getAnonId } from '../anon-id';
import { FormsClient, FormsClientError, type PublicFormSchema } from '../client';
import { baseStyles } from './theme';

/** Mirrors the backend SchemaValidatorService (client-side pre-validation). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(\+91)?[0-9]{10}$/;
const TEXTAREA_DEFAULT_MAX = 5000;

type Status = 'loading' | 'ready' | 'submitting' | 'success' | 'closed' | 'unavailable' | 'error';

declare global {
  interface Window {
    grecaptcha?: {
      ready(cb: () => void): void;
      execute(siteKey: string, opts: { action: string }): Promise<string>;
    };
  }
}

/**
 * `<ratio-form form-id="...">` — the storefront form renderer (PRD
 * "Storefront SDK", TDD §6).
 *
 * Fetches the render schema, renders all 8 field types, validates
 * client-side with the same rules the backend re-checks, lazy-loads
 * reCAPTCHA v3 only when the form actually uses it, runs the presigned
 * upload flow for file fields, disables submit after the first click, and
 * renders the success / "form closed" / "no longer available" states.
 */
@customElement('ratio-form')
export class RatioForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        max-width: 100%;
      }
      .rf-form {
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-width: 100%;
      }
      .rf-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-width: 100%;
      }
      .rf-label {
        font-size: 13px;
        font-weight: 600;
      }
      .rf-required {
        color: #c0392b;
      }
      input,
      select,
      textarea {
        font: inherit;
        padding: 8px 10px;
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        background: var(--wz-bg);
        color: var(--wz-fg);
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      .rf-error {
        color: #c0392b;
        font-size: 12px;
      }
      .rf-phone {
        display: flex;
        gap: 6px;
      }
      .rf-phone-prefix {
        flex: none;
        padding: 8px 10px;
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        background: #f5f5f5;
      }
      .rf-checks {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .rf-check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
      }
      .rf-check input {
        width: auto;
      }
      /* Honeypot: visually hidden but focusable-by-bots. */
      .rf-hp {
        position: absolute !important;
        left: -9999px !important;
        width: 1px;
        height: 1px;
        overflow: hidden;
      }
      .rf-submit {
        font: inherit;
        padding: 10px 18px;
        border: none;
        border-radius: var(--wz-radius);
        background: var(--wz-primary);
        color: #fff;
        cursor: pointer;
        align-self: flex-start;
      }
      .rf-submit[disabled] {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .rf-status {
        padding: 12px;
        border-radius: var(--wz-radius);
        background: #f5f5f5;
        color: var(--wz-muted);
        font-size: 14px;
      }
      .rf-success {
        background: #ecfdf3;
        color: #067647;
      }
      .rf-form-error {
        color: #c0392b;
        font-size: 13px;
      }
    `,
  ];

  @property({ attribute: 'form-id' }) formId = '';
  /** Injectable for tests; defaults to a client built from the SDK prelude config. */
  @property({ attribute: false }) client: FormsClient | null = null;

  @state() private schema: PublicFormSchema | null = null;
  @state() private status: Status = 'loading';
  @state() private values: Record<string, unknown> = {};
  @state() private fieldErrors: Record<string, string> = {};
  @state() private formError = '';
  @state() private hp = '';

  private files: Record<string, File | null> = {};
  private recaptchaInjected = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadSchema();
  }

  private resolveClient(): FormsClient | null {
    if (this.client) return this.client;
    const cfg = window.__FORMS_SDK_CONFIG__;
    if (!cfg?.apiBase) return null;
    this.client = new FormsClient({ apiBase: cfg.apiBase });
    return this.client;
  }

  private async loadSchema(): Promise<void> {
    const client = this.resolveClient();
    if (!client || !this.formId) {
      this.status = 'error';
      return;
    }
    try {
      this.schema = await client.getFormSchema(this.formId);
      this.status = 'ready';
      this.maybeInjectRecaptcha();
    } catch (err) {
      if (err instanceof FormsClientError && err.isFormClosed) {
        this.status = 'closed';
      } else if (err instanceof FormsClientError && err.isFormUnavailable) {
        this.status = 'unavailable';
      } else {
        this.status = 'error';
      }
    }
  }

  /** Lazy: the reCAPTCHA script is injected ONLY when this form needs it. */
  private maybeInjectRecaptcha(): void {
    if (this.recaptchaInjected) return;
    const schema = this.schema;
    if (!schema || schema.spamProtection !== 'recaptcha' || !schema.recaptchaSiteKey) return;
    this.recaptchaInjected = true;
    if (window.grecaptcha) return;
    const marker = 'data-ratio-forms-recaptcha';
    if (document.querySelector(`script[${marker}]`)) return;
    const tag = document.createElement('script');
    tag.setAttribute(marker, '');
    tag.async = true;
    tag.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(schema.recaptchaSiteKey)}`;
    document.head.appendChild(tag);
  }

  private async recaptchaToken(): Promise<string | undefined> {
    const schema = this.schema;
    if (!schema || schema.spamProtection !== 'recaptcha' || !schema.recaptchaSiteKey) {
      return undefined;
    }
    const grecaptcha = window.grecaptcha;
    if (!grecaptcha) return undefined; // script blocked/offline: backend falls back to honeypot
    await new Promise<void>((resolve) => grecaptcha.ready(resolve));
    return grecaptcha.execute(schema.recaptchaSiteKey, { action: 'submit' });
  }

  private validateAll(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const field of this.schema?.schema ?? []) {
      const error = this.validateField(field);
      if (error) errors[field.key] = error;
    }
    return errors;
  }

  private isEmpty(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }

  private validateField(field: FormField): string | null {
    if (field.type === 'file') {
      const file = this.files[field.key] ?? null;
      if (!file) return field.required ? 'a file is required' : null;
      const allowed = field.validation?.allowedMimeTypes as readonly string[] | undefined;
      if (allowed && !allowed.includes(file.type)) {
        return `allowed types: ${allowed.join(', ')}`;
      }
      const maxBytes = field.validation?.maxBytes ?? 5 * 1024 * 1024;
      if (file.size > maxBytes) return `file must be at most ${Math.floor(maxBytes / 1024)} KB`;
      return null;
    }

    const value = this.values[field.key];
    if (this.isEmpty(value)) {
      return field.required ? 'this field is required' : null;
    }

    switch (field.type) {
      case 'text': {
        const v = String(value);
        const rules = field.validation;
        if (rules?.minLength !== undefined && v.length < rules.minLength) {
          return `must be at least ${rules.minLength} characters`;
        }
        if (rules?.maxLength !== undefined && v.length > rules.maxLength) {
          return `must be at most ${rules.maxLength} characters`;
        }
        if (rules?.pattern !== undefined && !new RegExp(rules.pattern).test(v)) {
          return 'does not match the required pattern';
        }
        return null;
      }
      case 'textarea': {
        const v = String(value);
        const rules = field.validation;
        const maxLength = rules?.maxLength ?? TEXTAREA_DEFAULT_MAX;
        if (rules?.minLength !== undefined && v.length < rules.minLength) {
          return `must be at least ${rules.minLength} characters`;
        }
        if (v.length > maxLength) return `must be at most ${maxLength} characters`;
        return null;
      }
      case 'email':
        return EMAIL_RE.test(String(value)) ? null : 'must be a valid email address';
      case 'phone': {
        const compact = String(value).replace(/[\s-]/g, '');
        return PHONE_RE.test(compact) ? null : 'must be a 10-digit Indian phone number';
      }
      case 'dropdown':
        return field.options.includes(String(value))
          ? null
          : 'must be one of the configured options';
      case 'multi_select': {
        const list = Array.isArray(value) ? value : [];
        return list.every((v) => field.options.includes(String(v)))
          ? null
          : 'every selection must be one of the configured options';
      }
      case 'date':
        return Number.isNaN(Date.parse(String(value))) ? 'must be a valid date' : null;
    }
  }

  private async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    // Submit-once: ignore anything after the first click until it resolves.
    if (this.status === 'submitting' || this.status === 'success') return;
    const client = this.resolveClient();
    const schema = this.schema;
    if (!client || !schema) return;

    const errors = this.validateAll();
    this.fieldErrors = errors;
    this.formError = '';
    if (Object.keys(errors).length > 0) return;

    this.status = 'submitting';
    try {
      // File flow: presign → PUT bytes → attach object keys.
      const fileKeys: Record<string, string> = {};
      for (const field of schema.schema) {
        if (field.type !== 'file') continue;
        const file = this.files[field.key];
        if (!file) continue;
        const target = await client.requestUpload(this.formId, {
          fieldKey: field.key,
          contentType: file.type,
          size: file.size,
        });
        await client.uploadFile(target, file);
        fileKeys[field.key] = target.objectKey;
      }

      const recaptchaToken = await this.recaptchaToken();
      const fields: Record<string, unknown> = {};
      for (const field of schema.schema) {
        if (field.type === 'file') continue;
        const value = this.values[field.key];
        if (!this.isEmpty(value)) fields[field.key] = value;
      }

      await client.submit(this.formId, {
        fields,
        ...(Object.keys(fileKeys).length > 0 ? { files: fileKeys } : {}),
        sessionId: getAnonId(),
        ...(recaptchaToken ? { recaptchaToken } : {}),
        _hp: this.hp,
      });
      this.status = 'success';
    } catch (err) {
      if (err instanceof FormsClientError) {
        if (err.isDuplicate) {
          // Same submission within the dedup window — treat as delivered.
          this.status = 'success';
          return;
        }
        if (err.isValidationError && err.fieldErrors) {
          this.fieldErrors = err.fieldErrors;
          this.formError = 'Please fix the highlighted fields.';
        } else if (err.isRateLimited) {
          this.formError = 'Too many submissions. Please try again in a few minutes.';
        } else if (err.isFormClosed) {
          this.status = 'closed';
          return;
        } else if (err.isFormUnavailable) {
          this.status = 'unavailable';
          return;
        } else {
          this.formError = 'Something went wrong. Please try again.';
        }
      } else {
        this.formError = 'Something went wrong. Please try again.';
      }
      this.status = 'ready';
    }
  }

  override render(): TemplateResult {
    switch (this.status) {
      case 'loading':
        return html`<div class="rf-status" data-state="loading">Loading...</div>`;
      case 'closed':
        return html`<div class="rf-status" data-state="closed">This form is closed.</div>`;
      case 'unavailable':
        return html`<div class="rf-status" data-state="unavailable">
          This form is no longer available.
        </div>`;
      case 'error':
        return html`<div class="rf-status" data-state="error">
          This form could not be loaded.
        </div>`;
      case 'success':
        return html`<div class="rf-status rf-success" data-state="success">
          ${this.schema?.successMessage ?? 'Thank you!'}
        </div>`;
      default:
        return this.renderForm();
    }
  }

  /**
   * Deliberately a `role="form"` div, not a native `<form>`: submit is the
   * button's click handler (+ Enter on any input). Equivalent UX in real
   * browsers — and it sidesteps native constraint validation and happy-dom's
   * proxied HTMLFormElement, which corrupts Lit child-part bindings.
   */
  private renderForm(): TemplateResult {
    const schema = this.schema;
    if (!schema) return html`${nothing}`;
    return html`
      <div class="rf-form" role="form" @keydown=${this.onKeydown}>
        ${schema.schema.map((field) => this.renderField(field))}
        <div class="rf-hp" aria-hidden="true">
          <input
            type="text"
            name="_hp"
            tabindex="-1"
            autocomplete="off"
            .value=${this.hp}
            @input=${(e: Event) => {
              this.hp = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
        <div class="rf-form-error" role="alert">${this.formError}</div>
        <button
          type="button"
          class="rf-submit"
          ?disabled=${this.status === 'submitting'}
          @click=${this.onSubmit}
        >
          ${this.status === 'submitting' ? 'Submitting...' : schema.submitLabel}
        </button>
      </div>
    `;
  }

  /** Enter in a single-line input submits, like a native form would. */
  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') {
      event.preventDefault();
      void this.onSubmit(event);
    }
  }

  private renderField(field: FormField): TemplateResult {
    const error = this.fieldErrors[field.key];
    return html`
      <div class="rf-field" data-field=${field.key}>
        <label class="rf-label" for=${`rf-${field.key}`}>
          ${field.label}${field.required ? html`<span class="rf-required"> *</span>` : nothing}
        </label>
        ${this.renderControl(field)}
        ${error ? html`<div class="rf-error" data-error-for=${field.key}>${error}</div>` : nothing}
      </div>
    `;
  }

  private setValue(key: string, value: unknown): void {
    this.values = { ...this.values, [key]: value };
  }

  private renderControl(field: FormField): TemplateResult {
    const id = `rf-${field.key}`;
    const onInput = (e: Event) =>
      this.setValue(field.key, (e.target as HTMLInputElement | HTMLTextAreaElement).value);

    switch (field.type) {
      case 'textarea':
        return html`<textarea
          id=${id}
          name=${field.key}
          rows="4"
          placeholder=${field.placeholder ?? ''}
          .value=${String(this.values[field.key] ?? '')}
          @input=${onInput}
        ></textarea>`;
      case 'dropdown':
        return html`<select
          id=${id}
          name=${field.key}
          @change=${(e: Event) => this.setValue(field.key, (e.target as HTMLSelectElement).value)}
        >
          <option value="">${field.placeholder ?? 'Select...'}</option>
          ${field.options.map(
            (opt) =>
              html`<option value=${opt} ?selected=${this.values[field.key] === opt}>
                ${opt}
              </option>`,
          )}
        </select>`;
      case 'multi_select':
        return html`<div class="rf-checks" id=${id}>
          ${field.options.map((opt) => {
            const current = Array.isArray(this.values[field.key])
              ? (this.values[field.key] as string[])
              : [];
            return html`<label class="rf-check">
              <input
                type="checkbox"
                name=${field.key}
                value=${opt}
                .checked=${current.includes(opt)}
                @change=${(e: Event) => {
                  const checked = (e.target as HTMLInputElement).checked;
                  const next = checked ? [...current, opt] : current.filter((v) => v !== opt);
                  this.setValue(field.key, next);
                }}
              />
              ${opt}
            </label>`;
          })}
        </div>`;
      case 'date':
        return html`<input
          id=${id}
          name=${field.key}
          type="date"
          .value=${String(this.values[field.key] ?? '')}
          @input=${onInput}
        />`;
      case 'file':
        return html`<input
          id=${id}
          name=${field.key}
          type="file"
          accept=${(field.validation?.allowedMimeTypes ?? []).join(',')}
          @change=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            this.files[field.key] = input.files?.[0] ?? null;
            // Re-render so a previous error clears on reselect.
            this.requestUpdate();
          }}
        />`;
      case 'phone':
        return html`<div class="rf-phone">
          <span class="rf-phone-prefix">+91</span>
          <input
            id=${id}
            name=${field.key}
            type="tel"
            inputmode="numeric"
            maxlength="10"
            placeholder=${field.placeholder ?? '10-digit number'}
            .value=${String(this.values[field.key] ?? '')}
            @input=${onInput}
          />
        </div>`;
      case 'email':
        return html`<input
          id=${id}
          name=${field.key}
          type="email"
          placeholder=${field.placeholder ?? ''}
          .value=${String(this.values[field.key] ?? '')}
          @input=${onInput}
        />`;
      default:
        return html`<input
          id=${id}
          name=${field.key}
          type="text"
          placeholder=${field.placeholder ?? ''}
          .value=${String(this.values[field.key] ?? '')}
          @input=${onInput}
        />`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ratio-form': RatioForm;
  }
}
