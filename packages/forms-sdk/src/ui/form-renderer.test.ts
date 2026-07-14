import { afterEach, describe, expect, it, vi } from 'vitest';
import './form-renderer';
import { FormsClient, type PublicFormSchema } from '../client';
import type { RatioForm } from './form-renderer';

/** Kitchen-sink fixture — all 8 field types (TDD §7). */
function kitchenSinkSchema(overrides: Partial<PublicFormSchema> = {}): PublicFormSchema {
  return {
    id: 'form_1',
    name: 'Kitchen sink',
    schema: [
      {
        key: 'full_name',
        type: 'text',
        label: 'Full name',
        required: true,
        validation: { minLength: 2, maxLength: 80 },
      },
      { key: 'message', type: 'textarea', label: 'Message', required: false },
      { key: 'email', type: 'email', label: 'Email', required: true },
      { key: 'phone', type: 'phone', label: 'Phone', required: false },
      {
        key: 'topic',
        type: 'dropdown',
        label: 'Topic',
        required: false,
        options: ['Sales', 'Support'],
      },
      {
        key: 'interests',
        type: 'multi_select',
        label: 'Interests',
        required: false,
        options: ['A', 'B'],
      },
      { key: 'visit_date', type: 'date', label: 'Visit date', required: false },
      {
        key: 'resume',
        type: 'file',
        label: 'Resume',
        required: false,
        validation: { allowedMimeTypes: ['application/pdf'], maxBytes: 1024 },
      },
    ] as PublicFormSchema['schema'],
    submitLabel: 'Send it',
    successMessage: 'Thanks — got it!',
    spamProtection: 'honeypot',
    ...overrides,
  };
}

interface RouteTable {
  schema?: { status: number; body: unknown };
  uploads?: { status: number; body: unknown };
  submissions?: { status: number; body: unknown };
  putStatus?: number;
}

function makeFetch(routes: RouteTable) {
  return vi.fn((url: string, init?: RequestInit) => {
    const respond = (status: number, body: unknown) =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response);
    if (init?.method === 'PUT') {
      return Promise.resolve({
        ok: (routes.putStatus ?? 200) < 300,
        status: routes.putStatus ?? 200,
      } as Response);
    }
    if (url.endsWith('/uploads')) {
      const r = routes.uploads ?? {
        status: 200,
        body: { data: { uploadUrl: 'https://s3/put', objectKey: 'm1/form_1/d1/resume' } },
      };
      return respond(r.status, r.body);
    }
    if (url.endsWith('/submissions')) {
      const r = routes.submissions ?? { status: 200, body: { data: { submissionId: 'sub_1' } } };
      return respond(r.status, r.body);
    }
    const r = routes.schema ?? { status: 200, body: { data: kitchenSinkSchema() } };
    return respond(r.status, r.body);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(routes: RouteTable = {}) {
  const fetchImpl = makeFetch(routes);
  const el = document.createElement('ratio-form') as RatioForm;
  el.formId = 'form_1';
  el.client = new FormsClient({ apiBase: '/forms' }, fetchImpl);
  document.body.appendChild(el);
  await flush();
  await el.updateComplete;
  return { el, fetchImpl };
}

function shadow(el: RatioForm): ShadowRoot {
  const root = el.shadowRoot;
  if (!root) throw new Error('no shadow root');
  return root;
}

function setInput(el: RatioForm, key: string, value: string): void {
  const input = shadow(el).querySelector(`[name="${key}"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit(el: RatioForm): Promise<void> {
  const button = shadow(el).querySelector('.rf-submit') as HTMLButtonElement;
  button.click();
  await flush();
  await el.updateComplete;
}

afterEach(() => {
  document.body.innerHTML = '';
  for (const tag of Array.from(
    document.head.querySelectorAll('script[data-ratio-forms-recaptcha]'),
  )) {
    tag.remove();
  }
  delete window.grecaptcha;
  localStorage.clear();
});

describe('ratio-form rendering', () => {
  it('renders all 8 field types from the fetched schema', async () => {
    const { el } = await mount();
    const root = shadow(el);
    expect(root.querySelector('input[name="full_name"][type="text"]')).toBeTruthy();
    expect(root.querySelector('textarea[name="message"]')).toBeTruthy();
    expect(root.querySelector('input[name="email"][type="email"]')).toBeTruthy();
    expect(root.querySelector('input[name="phone"][type="tel"]')).toBeTruthy();
    expect(root.querySelector('select[name="topic"]')).toBeTruthy();
    expect(root.querySelectorAll('input[name="interests"][type="checkbox"]')).toHaveLength(2);
    expect(root.querySelector('input[name="visit_date"][type="date"]')).toBeTruthy();
    expect(root.querySelector('input[name="resume"][type="file"]')).toBeTruthy();
    // +91 prefix UI on the phone field.
    expect(root.textContent).toContain('+91');
    // Submit label from the schema.
    expect(root.querySelector('.rf-submit')?.textContent).toContain('Send it');
  });

  it('renders the honeypot input hidden from humans', async () => {
    const { el } = await mount();
    const hpWrap = shadow(el).querySelector('.rf-hp') as HTMLElement;
    expect(hpWrap).toBeTruthy();
    expect(hpWrap.getAttribute('aria-hidden')).toBe('true');
    const hp = hpWrap.querySelector('input[name="_hp"]') as HTMLInputElement;
    expect(hp).toBeTruthy();
    expect(hp.tabIndex).toBe(-1);
  });

  it('renders "form closed" on 403 form_inactive', async () => {
    const { el } = await mount({
      schema: { status: 403, body: { message: 'closed', error_code: 'form_inactive' } },
    });
    expect(shadow(el).querySelector('[data-state="closed"]')).toBeTruthy();
    expect(shadow(el).textContent).toContain('This form is closed');
  });

  it('renders "no longer available" on 404 and on the kill switch 403', async () => {
    const first = await mount({
      schema: { status: 404, body: { error_code: 'form_not_available' } },
    });
    expect(shadow(first.el).querySelector('[data-state="unavailable"]')).toBeTruthy();
    const second = await mount({
      schema: { status: 403, body: { error_code: 'form_unavailable' } },
    });
    expect(shadow(second.el).querySelector('[data-state="unavailable"]')).toBeTruthy();
  });
});

describe('ratio-form client-side validation', () => {
  it('required fields block submit with inline errors — nothing is POSTed', async () => {
    const { el, fetchImpl } = await mount();
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="full_name"]')?.textContent).toContain(
      'this field is required',
    );
    expect(shadow(el).querySelector('[data-error-for="email"]')).toBeTruthy();
    const posts = fetchImpl.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(posts).toHaveLength(0);
  });

  it('validates email format and +91 10-digit phone', async () => {
    const { el } = await mount();
    setInput(el, 'full_name', 'Asha');
    setInput(el, 'email', 'not-an-email');
    setInput(el, 'phone', '12345');
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="email"]')?.textContent).toContain(
      'valid email',
    );
    expect(shadow(el).querySelector('[data-error-for="phone"]')?.textContent).toContain('10-digit');
  });

  it('enforces text min/max validation rules', async () => {
    const { el } = await mount();
    setInput(el, 'full_name', 'A');
    setInput(el, 'email', 'a@b.co');
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="full_name"]')?.textContent).toContain(
      'at least 2 characters',
    );
  });

  it('rejects an oversized or wrong-type file before any upload', async () => {
    const { el, fetchImpl } = await mount();
    setInput(el, 'full_name', 'Asha');
    setInput(el, 'email', 'a@b.co');
    const input = shadow(el).querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File([new ArrayBuffer(4096)], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [big], configurable: true });
    input.dispatchEvent(new Event('change'));
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="resume"]')?.textContent).toContain('at most');
    const wrongType = new File(['x'], 'x.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [wrongType], configurable: true });
    input.dispatchEvent(new Event('change'));
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="resume"]')?.textContent).toContain(
      'allowed types',
    );
    const posts = fetchImpl.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(posts).toHaveLength(0);
  });
});

describe('ratio-form submit flow', () => {
  async function fillMinimum(el: RatioForm): Promise<void> {
    setInput(el, 'full_name', 'Asha Rao');
    setInput(el, 'email', 'asha@example.com');
  }

  it('POSTs fields + sessionId + honeypot and shows the success message on 200', async () => {
    const { el, fetchImpl } = await mount();
    await fillMinimum(el);
    await submit(el);
    const post = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/submissions'));
    expect(post).toBeDefined();
    const body = JSON.parse(String((post?.[1] as RequestInit).body));
    expect(body.fields).toEqual({ full_name: 'Asha Rao', email: 'asha@example.com' });
    expect(body.sessionId).toMatch(/^wz_/);
    expect(body._hp).toBe('');
    expect(shadow(el).querySelector('[data-state="success"]')?.textContent).toContain(
      'Thanks — got it!',
    );
  });

  it('disables the submit button after the first click (submit-once)', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn((url: string) => {
      if (String(url).endsWith('/submissions')) {
        return gate.then(
          () =>
            ({
              ok: true,
              status: 200,
              text: () => Promise.resolve(JSON.stringify({ data: { submissionId: 's' } })),
            }) as unknown as Response,
        );
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ data: kitchenSinkSchema() })),
      } as unknown as Response);
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

    const el = document.createElement('ratio-form') as RatioForm;
    el.formId = 'form_1';
    el.client = new FormsClient({ apiBase: '/forms' }, fetchImpl);
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    await fillMinimum(el);

    const button = shadow(el).querySelector('.rf-submit') as HTMLButtonElement;
    button.click();
    await flush(2);
    await el.updateComplete;
    expect(button.disabled).toBe(true);
    // A second submit while in flight must not POST again.
    button.click();
    await flush(2);
    release?.();
    await flush();
    const posts = fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith('/submissions'));
    expect(posts).toHaveLength(1);
  });

  it('runs the presigned upload flow: presign → PUT bytes → object key attached', async () => {
    const { el, fetchImpl } = await mount();
    await fillMinimum(el);
    const input = shadow(el).querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['pdfbytes'], 'cv.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await submit(el);

    const presign = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/uploads'));
    expect(presign).toBeDefined();
    expect(JSON.parse(String((presign?.[1] as RequestInit).body))).toEqual({
      fieldKey: 'resume',
      contentType: 'application/pdf',
      size: file.size,
    });
    const put = fetchImpl.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT');
    expect(put?.[0]).toBe('https://s3/put');
    const post = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/submissions'));
    const body = JSON.parse(String((post?.[1] as RequestInit).body));
    expect(body.files).toEqual({ resume: 'm1/form_1/d1/resume' });
  });

  it('treats a 409 duplicate as success (double-click safety)', async () => {
    const { el } = await mount({
      submissions: { status: 409, body: { message: 'dup', error_code: 'duplicate_submission' } },
    });
    setInput(el, 'full_name', 'Asha');
    setInput(el, 'email', 'a@b.co');
    await submit(el);
    expect(shadow(el).querySelector('[data-state="success"]')).toBeTruthy();
  });

  it('renders server 422 per-field errors inline', async () => {
    const { el } = await mount({
      submissions: {
        status: 422,
        body: {
          message: 'submission validation failed',
          error_code: 'SUBMISSION_INVALID',
          details: { fields: { email: 'must be a valid email address' } },
        },
      },
    });
    setInput(el, 'full_name', 'Asha');
    setInput(el, 'email', 'looks@valid.example');
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="email"]')?.textContent).toContain(
      'valid email',
    );
    // Form stays interactive for a retry.
    expect((shadow(el).querySelector('.rf-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('surfaces a friendly message on 429 rate limiting', async () => {
    const { el } = await mount({
      submissions: { status: 429, body: { message: 'slow down', error_code: 'RATE_LIMITED' } },
    });
    setInput(el, 'full_name', 'Asha');
    setInput(el, 'email', 'a@b.co');
    await submit(el);
    expect(shadow(el).textContent).toContain('Too many submissions');
  });
});

describe('ratio-form reCAPTCHA v3', () => {
  it('lazy-loads the reCAPTCHA script only for recaptcha forms with a site key', async () => {
    await mount(); // honeypot fixture → no script
    expect(document.head.querySelector('script[data-ratio-forms-recaptcha]')).toBeNull();
    await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({ spamProtection: 'recaptcha', recaptchaSiteKey: 'site-key-1' }),
        },
      },
    });
    const tag = document.head.querySelector(
      'script[data-ratio-forms-recaptcha]',
    ) as HTMLScriptElement;
    expect(tag).toBeTruthy();
    expect(tag.src).toContain('render=site-key-1');
  });

  it('executes grecaptcha on submit and attaches the token', async () => {
    const execute = vi.fn().mockResolvedValue('recaptcha-token-1');
    window.grecaptcha = { ready: (cb: () => void) => cb(), execute };
    const { el, fetchImpl } = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({ spamProtection: 'recaptcha', recaptchaSiteKey: 'site-key-1' }),
        },
      },
    });
    setInput(el, 'full_name', 'Asha');
    setInput(el, 'email', 'a@b.co');
    await submit(el);
    expect(execute).toHaveBeenCalledWith('site-key-1', { action: 'submit' });
    const post = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/submissions'));
    const body = JSON.parse(String((post?.[1] as RequestInit).body));
    expect(body.recaptchaToken).toBe('recaptcha-token-1');
  });

  it('still submits without a token when grecaptcha is unavailable (backend honeypot fallback)', async () => {
    const { el, fetchImpl } = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({ spamProtection: 'recaptcha', recaptchaSiteKey: 'site-key-1' }),
        },
      },
    });
    setInput(el, 'full_name', 'Asha');
    setInput(el, 'email', 'a@b.co');
    await submit(el);
    const post = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/submissions'));
    const body = JSON.parse(String((post?.[1] as RequestInit).body));
    expect(body.recaptchaToken).toBeUndefined();
    expect(shadow(el).querySelector('[data-state="success"]')).toBeTruthy();
  });
});
