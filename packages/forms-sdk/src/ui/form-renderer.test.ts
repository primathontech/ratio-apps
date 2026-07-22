import { appearanceSchema, type FormAppearance } from '@ratio-app/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './form-renderer';
import { FormsClient, type PublicFormSchema } from '../client';
import { RATIO_FORM_TAG, RatioForm } from './form-renderer';

/** A fully-defaulted appearance with optional group overrides + font family. */
function appearanceWith(
  overrides: Record<string, unknown> = {},
  fontFamily?: string,
): FormAppearance {
  return appearanceSchema.parse({
    ...overrides,
    ...(fontFamily ? { typography: { fontFamily } } : {}),
  });
}

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
      'This field is required',
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
      'allowed type',
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

/** Fixture exercising the P0 field types (radio, single checkbox, number). */
function p0FieldsSchema(overrides: Partial<PublicFormSchema> = {}): PublicFormSchema {
  return {
    id: 'form_p0',
    name: 'P0 fields',
    schema: [
      { key: 'plan', type: 'radio', label: 'Plan', required: true, options: ['Free', 'Pro'] },
      {
        key: 'qty',
        type: 'number',
        label: 'Quantity',
        required: false,
        validation: { min: 1, max: 10, integer: true },
      },
      {
        key: 'consent',
        type: 'checkbox',
        label: 'I agree',
        required: true,
        linkUrl: 'https://example.com/policy',
        linkText: 'Privacy Policy',
      },
    ] as PublicFormSchema['schema'],
    submitLabel: 'Go',
    successMessage: 'Done',
    spamProtection: 'honeypot',
    ...overrides,
  };
}

describe('ratio-form P0 field types', () => {
  it('renders radio group, number input, and single consent checkbox', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: p0FieldsSchema() } } });
    const root = shadow(el);
    expect(root.querySelectorAll('input[name="plan"][type="radio"]')).toHaveLength(2);
    expect(root.querySelector('[role="radiogroup"]')).toBeTruthy();
    expect(root.querySelector('input[name="qty"][type="number"]')).toBeTruthy();
    const consent = root.querySelector(
      'input[name="consent"][type="checkbox"]',
    ) as HTMLInputElement;
    expect(consent).toBeTruthy();
    // Optional policy link rendered next to the box.
    const link = root.querySelector('a[href="https://example.com/policy"]') as HTMLAnchorElement;
    expect(link?.textContent).toContain('Privacy Policy');
    expect(link.rel).toContain('noopener');
  });

  it('number field reflects min/max/step from validation', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: p0FieldsSchema() } } });
    const num = shadow(el).querySelector('input[name="qty"]') as HTMLInputElement;
    expect(num.getAttribute('min')).toBe('1');
    expect(num.getAttribute('max')).toBe('10');
    expect(num.getAttribute('step')).toBe('1');
    expect(num.getAttribute('inputmode')).toBe('numeric');
  });

  it('required radio and required consent block submit', async () => {
    const { el, fetchImpl } = await mount({
      schema: { status: 200, body: { data: p0FieldsSchema() } },
    });
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="plan"]')?.textContent).toContain('required');
    expect(shadow(el).querySelector('[data-error-for="consent"]')?.textContent).toContain(
      'required',
    );
    const posts = fetchImpl.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(posts).toHaveLength(0);
  });

  it('enforces number integer + range rules', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: p0FieldsSchema() } } });
    // Pick radio + consent so only the number error remains.
    const radio = shadow(el).querySelector('input[name="plan"][value="Pro"]') as HTMLInputElement;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    const consent = shadow(el).querySelector('input[name="consent"]') as HTMLInputElement;
    consent.checked = true;
    consent.dispatchEvent(new Event('change', { bubbles: true }));

    setInput(el, 'qty', '2.5');
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="qty"]')?.textContent).toContain('whole');

    setInput(el, 'qty', '99');
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="qty"]')?.textContent).toContain(
      '10 or less',
    );
  });

  it('submits radio value + boolean consent on success', async () => {
    const { el, fetchImpl } = await mount({
      schema: { status: 200, body: { data: p0FieldsSchema() } },
    });
    const radio = shadow(el).querySelector('input[name="plan"][value="Free"]') as HTMLInputElement;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    const consent = shadow(el).querySelector('input[name="consent"]') as HTMLInputElement;
    consent.checked = true;
    consent.dispatchEvent(new Event('change', { bubbles: true }));
    await submit(el);
    const post = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/submissions'));
    const body = JSON.parse(String((post?.[1] as RequestInit).body));
    expect(body.fields.plan).toBe('Free');
    expect(body.fields.consent).toBe(true);
  });
});

describe('ratio-form theming', () => {
  // Parsed so the new appearance keys (background, input/button/focus, etc.)
  // fill in from their today-preserving defaults.
  const themed: FormAppearance = appearanceSchema.parse({
    colors: {
      primary: '#ff0000',
      background: '#000000',
      pageBackground: '#0a0a0a',
      surface: '#111111',
      text: '#eeeeee',
      muted: '#999999',
      border: '#333333',
      error: '#ff8800',
      buttonText: '#ffffff',
    },
    typography: { fontFamily: 'inter', baseSize: 16 },
    layout: {
      radius: 2,
      density: 'spacious',
      maxWidth: 480,
      buttonShape: 'pill',
      fullWidthButton: true,
      buttonAlign: 'left',
      labelPosition: 'left',
      cardBorder: true,
      shadow: 'md',
    },
  });

  it('injects a themed :host style block when appearance is present', async () => {
    const { el } = await mount({
      schema: { status: 200, body: { data: kitchenSinkSchema({ appearance: themed }) } },
    });
    const style = shadow(el).querySelector('style');
    expect(style?.textContent).toContain('--wz-primary: #ff0000');
    expect(style?.textContent).toContain('--wz-btn-radius: 999px');
    expect(style?.textContent).toContain("--wz-font: 'Inter'");
  });

  it('reflects labelPosition:left onto the host', async () => {
    const { el } = await mount({
      schema: { status: 200, body: { data: kitchenSinkSchema({ appearance: themed }) } },
    });
    expect(el.getAttribute('data-label')).toBe('left');
  });

  it('emits default tokens for an un-themed form', async () => {
    const { el } = await mount();
    const style = shadow(el).querySelector('style');
    expect(style?.textContent).toContain('--wz-primary: #0fb3a9');
    expect(el.hasAttribute('data-label')).toBe(false);
  });

  it('drives the page background token and applies it on the outer root', async () => {
    const withPage = appearanceWith({ colors: { pageBackground: '#f2f4f7' } });
    const { el } = await mount({
      schema: { status: 200, body: { data: kitchenSinkSchema({ appearance: withPage }) } },
    });
    const root = shadow(el);
    expect(root.querySelector('style')?.textContent).toContain('--wz-page-bg: #f2f4f7');
    // The card stays centered within the page-colored root via its own max-width.
    expect(root.querySelector('.rf-root')).toBeTruthy();
    expect(root.querySelector('.rf-root > .rf-card')).toBeTruthy();
  });

  it('emits the buttonAlign token from appearance.layout', async () => {
    const centered = appearanceWith({ layout: { buttonAlign: 'center' } });
    const { el } = await mount({
      schema: { status: 200, body: { data: kitchenSinkSchema({ appearance: centered }) } },
    });
    expect(shadow(el).querySelector('style')?.textContent).toContain('--wz-btn-align: center');
  });
});

describe('ratio-form side-by-side field widths', () => {
  /** Two half fields, then a full field, to exercise the wrap pairing. */
  function widthsSchema(): PublicFormSchema {
    return {
      id: 'form_w',
      name: 'Widths',
      schema: [
        { key: 'first', type: 'text', label: 'First', required: false, width: 'half' },
        { key: 'last', type: 'text', label: 'Last', required: false, width: 'half' },
        { key: 'notes', type: 'textarea', label: 'Notes', required: false, width: 'full' },
      ] as PublicFormSchema['schema'],
      submitLabel: 'Go',
      successMessage: 'Done',
      spamProtection: 'honeypot',
    };
  }

  it('wraps fields in a .rf-fields row and reflects each field width', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: widthsSchema() } } });
    const root = shadow(el);
    const fields = root.querySelector('.rf-fields');
    expect(fields).toBeTruthy();
    // Every field wrapper lives inside the wrapping row.
    expect(fields?.querySelectorAll('.rf-field')).toHaveLength(3);
    expect(root.querySelector('[data-field="first"]')?.getAttribute('data-width')).toBe('half');
    expect(root.querySelector('[data-field="last"]')?.getAttribute('data-width')).toBe('half');
    expect(root.querySelector('[data-field="notes"]')?.getAttribute('data-width')).toBe('full');
  });

  it('defaults a field with no width to full', async () => {
    const { el } = await mount();
    // kitchenSinkSchema fields carry no width; they default to full.
    expect(shadow(el).querySelector('[data-field="full_name"]')?.getAttribute('data-width')).toBe(
      'full',
    );
  });

  it('keeps the submit button outside the fields row', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: widthsSchema() } } });
    const root = shadow(el);
    // Submit and honeypot stay in the .rf-form column, not the wrapping row.
    expect(root.querySelector('.rf-fields .rf-submit')).toBeNull();
    expect(root.querySelector('.rf-form > .rf-submit')).toBeTruthy();
  });
});

describe('ratio-form card + heading', () => {
  it('mounts a card wrapper with the form name as an h2 title', async () => {
    const { el } = await mount();
    const root = shadow(el);
    expect(root.querySelector('.rf-card')).toBeTruthy();
    const title = root.querySelector('.rf-title');
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toContain('Kitchen sink');
  });

  it('renders an optional description under the title', async () => {
    const { el } = await mount({
      schema: { status: 200, body: { data: kitchenSinkSchema({ description: 'Reach the team' }) } },
    });
    const desc = shadow(el).querySelector('.rf-desc');
    expect(desc?.textContent).toContain('Reach the team');
  });

  it('renders logo and cover images from appearance', async () => {
    const withAssets = kitchenSinkSchema({
      appearance: appearanceWith({
        logo: { url: 'https://cdn.example.com/logo.png' },
        cover: { url: 'https://cdn.example.com/cover.jpg' },
      }),
    });
    const { el } = await mount({ schema: { status: 200, body: { data: withAssets } } });
    const root = shadow(el);
    expect(root.querySelector('img.rf-logo')?.getAttribute('src')).toBe(
      'https://cdn.example.com/logo.png',
    );
    expect(root.querySelector('img.rf-cover')?.getAttribute('src')).toBe(
      'https://cdn.example.com/cover.jpg',
    );
  });

  it('omits logo, cover, and description when absent', async () => {
    const { el } = await mount();
    const root = shadow(el);
    expect(root.querySelector('.rf-logo')).toBeNull();
    expect(root.querySelector('.rf-cover')).toBeNull();
    expect(root.querySelector('.rf-desc')).toBeNull();
  });
});

describe('ratio-form web fonts', () => {
  afterEach(() => {
    for (const link of Array.from(document.head.querySelectorAll('link[id^="ratio-font-"]'))) {
      link.remove();
    }
  });

  it('injects one guarded document-level <link> for a non-system font', async () => {
    await mount({
      schema: {
        status: 200,
        body: { data: kitchenSinkSchema({ appearance: appearanceWith({}, 'inter') }) },
      },
    });
    const link = document.getElementById('ratio-font-inter') as HTMLLinkElement | null;
    expect(link).toBeTruthy();
    expect(link?.rel).toBe('stylesheet');
    expect(link?.href).toContain('family=Inter');
    // A second mount of the same family must not duplicate the link.
    await mount({
      schema: {
        status: 200,
        body: { data: kitchenSinkSchema({ appearance: appearanceWith({}, 'inter') }) },
      },
    });
    expect(document.head.querySelectorAll('#ratio-font-inter')).toHaveLength(1);
  });

  it('injects a document-level <link> built from a custom Google font name', async () => {
    await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({ typography: { customGoogleFont: 'Figtree' } }),
          }),
        },
      },
    });
    const link = document.getElementById('ratio-font-custom-Figtree') as HTMLLinkElement | null;
    expect(link).toBeTruthy();
    expect(link?.rel).toBe('stylesheet');
    expect(link?.href).toContain('family=Figtree');
  });

  it('injects no font link for the system default', async () => {
    await mount();
    expect(document.head.querySelector('link[id^="ratio-font-"]')).toBeNull();
  });
});

describe('ratio-form error state', () => {
  it('wires aria-invalid + aria-describedby to the inline error text', async () => {
    const { el } = await mount();
    await submit(el);
    const root = shadow(el);
    const email = root.querySelector('input[name="email"]') as HTMLInputElement;
    expect(email.getAttribute('aria-invalid')).toBe('true');
    const describedBy = email.getAttribute('aria-describedby');
    expect(describedBy).toBe('rf-err-email');
    expect(root.getElementById(describedBy as string)?.textContent).toContain('required');
  });

  it('clears aria-invalid once the field becomes valid', async () => {
    const { el } = await mount();
    await submit(el);
    // Fix full_name but leave email invalid so the form stays mounted.
    setInput(el, 'full_name', 'Asha Rao');
    setInput(el, 'email', 'still-bad');
    await submit(el);
    const name = shadow(el).querySelector('input[name="full_name"]') as HTMLInputElement;
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    const email = shadow(el).querySelector('input[name="email"]') as HTMLInputElement;
    expect(email.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('ratio-form themed ending + redirect', () => {
  it('renders the success state with themed classes (no hard-coded green)', async () => {
    const { el } = await mount();
    setInput(el, 'full_name', 'Asha Rao');
    setInput(el, 'email', 'asha@example.com');
    await submit(el);
    const success = shadow(el).querySelector('[data-state="success"]');
    expect(success?.classList.contains('rf-success')).toBe(true);
  });

  it('follows redirectUrl after a delay on success', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });
    // Run scheduled callbacks synchronously so the delayed redirect is testable.
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 0;
    }) as typeof setTimeout);
    try {
      const { el } = await mount({
        schema: {
          status: 200,
          body: { data: kitchenSinkSchema({ redirectUrl: 'https://example.com/thanks' }) },
        },
      });
      setInput(el, 'full_name', 'Asha Rao');
      setInput(el, 'email', 'asha@example.com');
      await submit(el);
      expect(shadow(el).querySelector('[data-state="success"]')).toBeTruthy();
      expect(assign).toHaveBeenCalledWith('https://example.com/thanks');
    } finally {
      timeoutSpy.mockRestore();
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('does not redirect when no redirectUrl is set', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 0;
    }) as typeof setTimeout);
    try {
      const { el } = await mount();
      setInput(el, 'full_name', 'Asha Rao');
      setInput(el, 'email', 'asha@example.com');
      await submit(el);
      expect(assign).not.toHaveBeenCalled();
    } finally {
      timeoutSpy.mockRestore();
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});

/** Fixture exercising the P1 field types (url, rating, hidden). */
function p1FieldsSchema(overrides: Partial<PublicFormSchema> = {}): PublicFormSchema {
  return {
    id: 'form_p1',
    name: 'P1 fields',
    schema: [
      { key: 'website', type: 'url', label: 'Website', required: true },
      { key: 'score', type: 'rating', label: 'Rating', required: true, max: 5, icon: 'star' },
      { key: 'utm', type: 'hidden', label: 'UTM source', required: false, paramName: 'utm_source' },
    ] as PublicFormSchema['schema'],
    submitLabel: 'Go',
    successMessage: 'Done',
    spamProtection: 'honeypot',
    ...overrides,
  };
}

describe('ratio-form P1 field types', () => {
  it('renders a url input, a rating radiogroup, and no visible DOM for hidden', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: p1FieldsSchema() } } });
    const root = shadow(el);
    expect(root.querySelector('input[name="website"][type="url"]')).toBeTruthy();
    const rating = root.querySelector('.rf-rating[role="radiogroup"]');
    expect(rating).toBeTruthy();
    expect(root.querySelectorAll('input[name="score"][type="radio"]')).toHaveLength(5);
    // Hidden field: no field wrapper, no input.
    expect(root.querySelector('[data-field="utm"]')).toBeNull();
    expect(root.querySelector('input[name="utm"]')).toBeNull();
  });

  it('validates url format and requires a rating before submit', async () => {
    const { el, fetchImpl } = await mount({
      schema: { status: 200, body: { data: p1FieldsSchema() } },
    });
    setInput(el, 'website', 'not a url');
    await submit(el);
    expect(shadow(el).querySelector('[data-error-for="website"]')?.textContent).toContain(
      'valid URL',
    );
    expect(shadow(el).querySelector('[data-error-for="score"]')?.textContent).toContain('required');
    const posts = fetchImpl.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(posts).toHaveLength(0);
  });

  it('submits a chosen rating value and a valid url', async () => {
    const { el, fetchImpl } = await mount({
      schema: { status: 200, body: { data: p1FieldsSchema() } },
    });
    setInput(el, 'website', 'https://acme.example');
    const star = shadow(el).querySelector('input[name="score"][value="4"]') as HTMLInputElement;
    star.checked = true;
    star.dispatchEvent(new Event('change', { bubbles: true }));
    await submit(el);
    const post = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/submissions'));
    const body = JSON.parse(String((post?.[1] as RequestInit).body));
    expect(body.fields.website).toBe('https://acme.example');
    expect(body.fields.score).toBe(4);
  });

  it('captures a hidden field value from the page URL and submits it', async () => {
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, search: '?utm_source=newsletter' },
    });
    try {
      const { el, fetchImpl } = await mount({
        schema: { status: 200, body: { data: p1FieldsSchema() } },
      });
      setInput(el, 'website', 'https://acme.example');
      const star = shadow(el).querySelector('input[name="score"][value="5"]') as HTMLInputElement;
      star.checked = true;
      star.dispatchEvent(new Event('change', { bubbles: true }));
      await submit(el);
      const post = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/submissions'));
      const body = JSON.parse(String((post?.[1] as RequestInit).body));
      expect(body.fields.utm).toBe('newsletter');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
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

describe('ratio-form preview mode', () => {
  afterEach(() => {
    for (const link of Array.from(document.head.querySelectorAll('link[id^="ratio-font-"]'))) {
      link.remove();
    }
  });

  /** Mount the renderer driven by inline preview props (no fetch). */
  async function mountPreview(
    props: {
      schema?: PublicFormSchema['schema'];
      appearance?: FormAppearance;
      name?: string;
      description?: string;
      submitLabel?: string;
      successMessage?: string;
      state?: 'ready' | 'success' | 'error' | 'closed';
    } = {},
  ) {
    const fetchImpl = vi.fn() as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const el = document.createElement('ratio-form') as RatioForm;
    // A client is present but must never be touched in preview mode.
    el.client = new FormsClient({ apiBase: '/forms' }, fetchImpl);
    el.previewName = props.name ?? 'Preview form';
    if (props.description) el.previewDescription = props.description;
    if (props.submitLabel) el.previewSubmitLabel = props.submitLabel;
    if (props.successMessage) el.previewSuccessMessage = props.successMessage;
    if (props.appearance) el.previewAppearance = props.appearance;
    if (props.state) el.previewState = props.state;
    el.previewSchema = props.schema ?? kitchenSinkSchema().schema;
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    return { el, fetchImpl };
  }

  it('renders inline fields and the preview name without any network fetch', async () => {
    const { el, fetchImpl } = await mountPreview({ name: 'Contact us' });
    const root = shadow(el);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(root.querySelector('.rf-title')?.textContent).toContain('Contact us');
    expect(root.querySelector('input[name="full_name"][type="text"]')).toBeTruthy();
    expect(root.querySelector('input[name="email"][type="email"]')).toBeTruthy();
    expect(root.querySelector('.rf-submit')).toBeTruthy();
  });

  it('renders the requested ending, error, and closed states', async () => {
    const ok = await mountPreview({ state: 'success' });
    expect(shadow(ok.el).querySelector('[data-state="success"]')?.textContent).toContain(
      'Thank you!',
    );
    const err = await mountPreview({ state: 'error' });
    expect(shadow(err.el).querySelector('[data-state="error"]')).toBeTruthy();
    const closed = await mountPreview({ state: 'closed' });
    expect(shadow(closed.el).querySelector('[data-state="closed"]')).toBeTruthy();
  });

  it('forwards the configured submit label and success message in preview', async () => {
    const { el } = await mountPreview({
      submitLabel: 'Join the list',
      successMessage: 'You are in!',
      state: 'success',
    });
    expect(shadow(el).querySelector('[data-state="success"]')?.textContent).toContain(
      'You are in!',
    );
    el.previewState = 'ready';
    await el.updateComplete;
    expect(shadow(el).querySelector('.rf-submit')?.textContent).toContain('Join the list');
  });

  it('falls back to the default submit label and success message when unset', async () => {
    const ready = await mountPreview();
    expect(shadow(ready.el).querySelector('.rf-submit')?.textContent).toContain('Submit');
    const success = await mountPreview({ state: 'success' });
    expect(shadow(success.el).querySelector('[data-state="success"]')?.textContent).toContain(
      'Thank you!',
    );
  });

  it('validates to show error rings on submit but never POSTs', async () => {
    const { el, fetchImpl } = await mountPreview();
    const button = shadow(el).querySelector('.rf-submit') as HTMLButtonElement;
    button.click();
    await flush();
    await el.updateComplete;
    // Required-field rings are viewable...
    expect(shadow(el).querySelector('[data-error-for="full_name"]')?.textContent).toContain(
      'required',
    );
    const email = shadow(el).querySelector('input[name="email"]') as HTMLInputElement;
    expect(email.getAttribute('aria-invalid')).toBe('true');
    // ...but nothing leaves the browser.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('injects the web-font link in preview mode', async () => {
    await mountPreview({ appearance: appearanceWith({}, 'inter') });
    const link = document.getElementById('ratio-font-inter') as HTMLLinkElement | null;
    expect(link).toBeTruthy();
    expect(link?.href).toContain('family=Inter');
  });

  it('reacts to a changed previewState without a fetch', async () => {
    const { el, fetchImpl } = await mountPreview();
    expect(shadow(el).querySelector('.rf-submit')).toBeTruthy();
    el.previewState = 'success';
    await el.updateComplete;
    expect(shadow(el).querySelector('[data-state="success"]')).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exports the tag constant matching the registered element', () => {
    expect(RATIO_FORM_TAG).toBe('ratio-form');
    expect(customElements.get(RATIO_FORM_TAG)).toBeTruthy();
  });
});

describe('ratio-form input variant (§1.2)', () => {
  it('reflects data-input for filled and underlined; outlined sets no attribute', async () => {
    const filled = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({ layout: { inputVariant: 'filled' } }),
          }),
        },
      },
    });
    expect(filled.el.getAttribute('data-input')).toBe('filled');

    const underlined = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({ layout: { inputVariant: 'underlined' } }),
          }),
        },
      },
    });
    expect(underlined.el.getAttribute('data-input')).toBe('underlined');

    const outlined = await mount();
    expect(outlined.el.hasAttribute('data-input')).toBe(false);
  });
});

describe('ratio-form focus style (§1.7)', () => {
  it('reflects data-focus for glow and border; ring sets no attribute', async () => {
    const glow = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({ layout: { focusStyle: 'glow' } }),
          }),
        },
      },
    });
    expect(glow.el.getAttribute('data-focus')).toBe('glow');

    const border = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({ layout: { focusStyle: 'border' } }),
          }),
        },
      },
    });
    expect(border.el.getAttribute('data-focus')).toBe('border');

    const ring = await mount();
    expect(ring.el.hasAttribute('data-focus')).toBe(false);
  });

  it('makes the three focus treatments mutually exclusive (each keeps one marker)', () => {
    const cssText = (RatioForm as unknown as { styles: Array<{ cssText: string }> }).styles
      .map((s) => s.cssText)
      .join('\n');
    // Default 'ring': the base focus rule paints an outset outline.
    expect(cssText).toContain(':is(input, select, textarea):focus-visible');
    expect(cssText).toContain('outline: var(--wz-focus-width) solid var(--wz-focus)');
    // 'border': a thick inset colored ring and NO outset outline.
    expect(cssText).toContain(
      "[data-focus='border']) :is(input, select, textarea):focus-visible {",
    );
    expect(cssText).toContain('box-shadow: inset 0 0 0 var(--wz-focus-width) var(--wz-focus)');
    // 'glow': a box-shadow halo and NO outset outline.
    expect(cssText).toContain("[data-focus='glow']) :is(input, select, textarea):focus-visible {");
    // Both non-ring variants explicitly drop the outset outline (exclusivity).
    expect((cssText.match(/outline: none/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('ratio-form floating labels (§1.4)', () => {
  it('reflects data-label=floating and drives inputs to a space placeholder', async () => {
    const { el } = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({ layout: { labelPosition: 'floating' } }),
          }),
        },
      },
    });
    expect(el.getAttribute('data-label')).toBe('floating');
    // The label acts as the placeholder, so the input placeholder is a space
    // (so the :placeholder-shown "filled" test works, no duplicate text).
    const name = shadow(el).querySelector('input[name="full_name"]') as HTMLInputElement;
    expect(name.getAttribute('placeholder')).toBe(' ');
  });

  /** A form mixing non-text-like field types with a text field, all under
   *  floating labels: only the text field may float. */
  function mixedFloatingSchema(): PublicFormSchema {
    return {
      id: 'form_float',
      name: 'Mixed floating',
      schema: [
        { key: 'topic', type: 'dropdown', label: 'Topic', required: false, options: ['A', 'B'] },
        { key: 'phone', type: 'phone', label: 'Phone', required: false },
        { key: 'consent', type: 'checkbox', label: 'I agree', required: false },
        { key: 'score', type: 'rating', label: 'Rating', required: false, max: 5, icon: 'star' },
        { key: 'full_name', type: 'text', label: 'Full name', required: true },
      ] as PublicFormSchema['schema'],
      submitLabel: 'Go',
      successMessage: 'Done',
      spamProtection: 'honeypot',
    };
  }

  it('floats only the text-like field; select/phone/checkbox/rating keep a top label', async () => {
    const { el } = await mount({
      schema: {
        status: 200,
        body: {
          data: {
            ...mixedFloatingSchema(),
            appearance: appearanceWith({ layout: { labelPosition: 'floating' } }),
          },
        },
      },
    });
    const root = shadow(el);
    expect(el.getAttribute('data-label')).toBe('floating');
    // Only the text field carries the data-float marker the floating CSS gates on.
    expect(root.querySelector('[data-field="full_name"]')?.hasAttribute('data-float')).toBe(true);
    for (const key of ['topic', 'phone', 'consent', 'score']) {
      expect(root.querySelector(`[data-field="${key}"]`)?.hasAttribute('data-float')).toBe(false);
    }
    // The text field's placeholder is blanked so the label can act as one...
    const name = root.querySelector('input[name="full_name"]') as HTMLInputElement;
    expect(name.getAttribute('placeholder')).toBe(' ');
    // ...but the phone keeps its real placeholder (no label floats over the +91 chip).
    const phone = root.querySelector('input[name="phone"]') as HTMLInputElement;
    expect(phone.getAttribute('placeholder')).toBe('10-digit number');
    expect(root.querySelector('.rf-phone .rf-phone-prefix')?.textContent).toContain('+91');
  });

  /** A prefix chip sits where a floating label would; a prefixed field must
   *  fall back to a top label while an adornment-free sibling still floats. */
  function floatingPrefixSchema(): PublicFormSchema {
    return {
      id: 'form_float_prefix',
      name: 'Floating + prefix',
      schema: [
        { key: 'plain', type: 'text', label: 'Plain', required: false, width: 'full' },
        {
          key: 'priced',
          type: 'number',
          label: 'Price',
          required: false,
          width: 'full',
          prefix: '$',
          placeholder: '0.00',
        },
      ] as PublicFormSchema['schema'],
      submitLabel: 'Go',
      successMessage: 'Done',
      spamProtection: 'honeypot',
    };
  }

  it('does not float a prefixed field, falling back to a top label', async () => {
    const { el } = await mount({
      schema: {
        status: 200,
        body: {
          data: {
            ...floatingPrefixSchema(),
            appearance: appearanceWith({ layout: { labelPosition: 'floating' } }),
          },
        },
      },
    });
    const root = shadow(el);
    expect(el.getAttribute('data-label')).toBe('floating');
    // The adornment-free text-like field still floats...
    expect(root.querySelector('[data-field="plain"]')?.hasAttribute('data-float')).toBe(true);
    // ...but the prefixed field falls back to a top label (no float over the chip).
    expect(root.querySelector('[data-field="priced"]')?.hasAttribute('data-float')).toBe(false);
    // A non-floating field keeps its real placeholder (not blanked to a space).
    const priced = root.querySelector('input[name="priced"]') as HTMLInputElement;
    expect(priced.getAttribute('placeholder')).toBe('0.00');
    // The prefix chip still renders.
    expect(root.querySelector('[data-field="priced"] .rf-adorn-prefix')?.textContent).toContain(
      '$',
    );
  });
});

describe('ratio-form required mark (§1.8)', () => {
  it('renders an asterisk by default, the word for text, and nothing for none', async () => {
    const asterisk = await mount();
    expect(shadow(asterisk.el).querySelector('.rf-required')?.textContent).toContain('*');

    const text = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({ layout: { requiredMark: 'text' } }),
          }),
        },
      },
    });
    expect(shadow(text.el).querySelector('.rf-required')?.textContent).toContain('Required');

    const none = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({ layout: { requiredMark: 'none' } }),
          }),
        },
      },
    });
    expect(shadow(none.el).querySelector('.rf-required')).toBeNull();
  });
});

describe('ratio-form button icon (§1.5)', () => {
  it('renders a leading svg glyph when set and none by default', async () => {
    const withIcon = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({ layout: { buttonIcon: 'arrow' } }),
          }),
        },
      },
    });
    expect(shadow(withIcon.el).querySelector('.rf-submit .rf-btn-icon')).toBeTruthy();

    const noIcon = await mount();
    expect(shadow(noIcon.el).querySelector('.rf-submit .rf-btn-icon')).toBeNull();
  });
});

describe('ratio-form content blocks (§1.3)', () => {
  function blocksSchema(): PublicFormSchema {
    return {
      id: 'form_blocks',
      name: 'Blocks',
      schema: [
        { key: 'sec', type: 'heading', text: 'Your details', level: 'h2', width: 'full' },
        {
          key: 'intro',
          type: 'paragraph',
          text: 'Tell us a little about yourself.',
          width: 'full',
        },
        { key: 'hr1', type: 'divider', width: 'full' },
        {
          key: 'banner',
          type: 'image',
          url: 'https://cdn.example.com/banner.png',
          alt: 'Banner',
          width: 'full',
        },
        { key: 'name', type: 'text', label: 'Name', required: true, width: 'full' },
      ] as PublicFormSchema['schema'],
      submitLabel: 'Go',
      successMessage: 'Done',
      spamProtection: 'honeypot',
    };
  }

  it('renders heading, paragraph, divider, and image blocks inline', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: blocksSchema() } } });
    const root = shadow(el);
    const heading = root.querySelector('h2.rf-heading');
    expect(heading?.textContent).toContain('Your details');
    expect(root.querySelector('p.rf-paragraph')?.textContent).toContain('Tell us a little');
    expect(root.querySelector('hr.rf-divider')).toBeTruthy();
    const img = root.querySelector('img.rf-block-img') as HTMLImageElement;
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/banner.png');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('alt')).toBe('Banner');
    // Blocks carry no label element.
    expect(root.querySelector('[data-field="sec"] .rf-label')).toBeNull();
  });

  it('never validates or submits a value for content blocks', async () => {
    const { el, fetchImpl } = await mount({
      schema: { status: 200, body: { data: blocksSchema() } },
    });
    setInput(el, 'name', 'Asha Rao');
    await submit(el);
    // No block produced an inline error.
    expect(shadow(el).querySelector('[data-error-for="sec"]')).toBeNull();
    const post = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/submissions'));
    const body = JSON.parse(String((post?.[1] as RequestInit).body));
    // Only the real field is in the payload — no heading/paragraph/divider/image keys.
    expect(body.fields).toEqual({ name: 'Asha Rao' });
  });
});

describe('ratio-form page background (§1.1)', () => {
  it('injects the gradient/image tokens and keeps the scrim layer over the root', async () => {
    const bg = appearanceWith({
      background: {
        type: 'image',
        imageUrl: 'https://cdn.example.com/hero.jpg',
        imageFit: 'cover',
        scrim: 0.5,
      },
    });
    const { el } = await mount({
      schema: { status: 200, body: { data: kitchenSinkSchema({ appearance: bg }) } },
    });
    const style = shadow(el).querySelector('style');
    expect(style?.textContent).toContain(
      '--wz-page-bg-image: url("https://cdn.example.com/hero.jpg")',
    );
    expect(style?.textContent).toContain('--wz-page-scrim: linear-gradient(rgba(0,0,0,0.5)');
    // The card stays layered above the scrim.
    expect(shadow(el).querySelector('.rf-root > .rf-card')).toBeTruthy();
  });
});

/** Concatenated static styles of the element, for asserting scoped CSS rules. */
function staticCss(): string {
  return (RatioForm as unknown as { styles: Array<{ cssText: string }> }).styles
    .map((s) => s.cssText)
    .join('\n');
}

describe('ratio-form multi-column layout (§2.1)', () => {
  it('reflects data-cols for 2 / auto and sets nothing for the single-column default', async () => {
    const two = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({ appearance: appearanceWith({ layout: { columns: '2' } }) }),
        },
      },
    });
    expect(two.el.getAttribute('data-cols')).toBe('2');

    const auto = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({ appearance: appearanceWith({ layout: { columns: 'auto' } }) }),
        },
      },
    });
    expect(auto.el.getAttribute('data-cols')).toBe('auto');

    const one = await mount();
    expect(one.el.hasAttribute('data-cols')).toBe(false);
  });

  it('drives .rf-fields to a grid and defines full/half column spans', () => {
    const css = staticCss();
    // The grid is gated on the attribute, so the single-column default is untouched.
    expect(css).toContain(':host([data-cols]) .rf-fields {');
    expect(css).toContain('display: grid');
    // Narrow default: every field spans the single track.
    expect(css).toContain(':host([data-cols]) .rf-field {');
    expect(css).toContain('grid-column: 1 / -1');
    // Above the container breakpoint 2 promotes to two tracks; a half takes one cell.
    expect(css).toContain('@container (min-width: 34rem)');
    expect(css).toContain(":host([data-cols='2']) .rf-fields {");
    expect(css).toContain('grid-template-columns: 1fr 1fr');
    expect(css).toContain('grid-column: auto');
  });
});

describe('ratio-form per-field style override (§2.2)', () => {
  /** One field pinned to a filled variant + accent; a plain sibling inherits. */
  function overrideSchema(): PublicFormSchema {
    return {
      id: 'form_style',
      name: 'Per-field style',
      schema: [
        {
          key: 'email',
          type: 'email',
          label: 'Email',
          required: true,
          width: 'full',
          style: { inputVariant: 'filled', accent: '#ff00aa' },
        },
        { key: 'note', type: 'text', label: 'Note', required: false, width: 'full' },
      ] as PublicFormSchema['schema'],
      submitLabel: 'Go',
      successMessage: 'Done',
      spamProtection: 'honeypot',
    };
  }

  it('scopes the variant attribute and accent custom-property to that field only', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: overrideSchema() } } });
    const root = shadow(el);
    const styled = root.querySelector('[data-field="email"]') as HTMLElement;
    // Variant reflected on the field wrapper (never the host).
    expect(styled.getAttribute('data-input')).toBe('filled');
    expect(el.hasAttribute('data-input')).toBe(false);
    // Accent scoped inline as --wz-* on the wrapper, hex-only.
    expect(styled.getAttribute('style')).toContain('--wz-focus:#ff00aa');
    expect(styled.getAttribute('style')).toContain('--wz-primary:#ff00aa');
    // The un-styled sibling carries neither.
    const plain = root.querySelector('[data-field="note"]') as HTMLElement;
    expect(plain.hasAttribute('data-input')).toBe(false);
    expect(plain.getAttribute('style')).toBeNull();
  });

  it('ships the scoped per-field variant rules that win over the global variant', () => {
    const css = staticCss();
    expect(css).toContain(".rf-field[data-input='filled'] :is(input, select, textarea) {");
    expect(css).toContain(".rf-field[data-input='underlined'] :is(input, select, textarea) {");
    expect(css).toContain(".rf-field[data-input='outlined'] :is(input, select, textarea) {");
  });
});

describe('ratio-form per-field adornments (§2.3)', () => {
  function adornSchema(): PublicFormSchema {
    return {
      id: 'form_adorn',
      name: 'Adornments',
      schema: [
        {
          key: 'price',
          type: 'number',
          label: 'Price',
          required: false,
          width: 'full',
          prefix: '$',
          suffix: '.00',
        },
        {
          key: 'bio',
          type: 'text',
          label: 'Bio',
          required: false,
          width: 'full',
          helpText: 'Keep it short and sweet.',
          showCounter: true,
          validation: { maxLength: 10 },
        },
      ] as PublicFormSchema['schema'],
      submitLabel: 'Go',
      successMessage: 'Done',
      spamProtection: 'honeypot',
    };
  }

  it('renders flanking prefix/suffix chips around a text-like input', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: adornSchema() } } });
    const group = shadow(el).querySelector('[data-field="price"] .rf-adorned') as HTMLElement;
    expect(group).toBeTruthy();
    expect(group.querySelector('.rf-adorn-prefix')?.textContent).toContain('$');
    expect(group.querySelector('.rf-adorn-suffix')?.textContent).toContain('.00');
    // The input still lives inside, keeping its own styling.
    expect(group.querySelector('input[name="price"]')).toBeTruthy();
  });

  it('wires help text via aria-describedby and renders a live counter', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: adornSchema() } } });
    const root = shadow(el);
    const help = root.querySelector('#rf-help-bio');
    expect(help?.textContent).toContain('Keep it short');
    const input = root.querySelector('input[name="bio"]') as HTMLInputElement;
    expect(input.getAttribute('aria-describedby')).toBe('rf-help-bio');
    // Counter starts at 0/limit and tracks the live value length.
    const counter = () => root.querySelector('[data-field="bio"] .rf-counter');
    expect(counter()?.textContent).toContain('0/10');
    setInput(el, 'bio', 'hello');
    await el.updateComplete;
    expect(counter()?.textContent).toContain('5/10');
    // Near the limit the counter shifts to the near-limit marker.
    setInput(el, 'bio', 'nine chars');
    await el.updateComplete;
    expect(counter()?.getAttribute('data-near')).toBe('true');
  });

  it('appends the error id after the help id in aria-describedby on failure', async () => {
    const withError = kitchenSinkSchema({
      schema: [
        {
          key: 'email',
          type: 'email',
          label: 'Email',
          required: true,
          width: 'full',
          helpText: 'We never share it.',
        },
      ] as PublicFormSchema['schema'],
    });
    const { el } = await mount({ schema: { status: 200, body: { data: withError } } });
    await submit(el);
    const input = shadow(el).querySelector('input[name="email"]') as HTMLInputElement;
    expect(input.getAttribute('aria-describedby')).toBe('rf-help-email rf-err-email');
  });
});

describe('ratio-form adornment capability matrix (§2.3)', () => {
  /** A text field with a prefix, plus a textarea and phone that (defensively)
   *  also carry a prefix, to prove non-adornable types never render chips. */
  function matrixSchema(): PublicFormSchema {
    return {
      id: 'form_matrix',
      name: 'Capability matrix',
      schema: [
        {
          key: 'handle',
          type: 'text',
          label: 'Handle',
          required: false,
          width: 'full',
          prefix: '@',
        },
        {
          key: 'about',
          type: 'textarea',
          label: 'About',
          required: false,
          width: 'full',
          prefix: 'X',
          showCounter: true,
          validation: { maxLength: 40 },
        },
        {
          key: 'phone',
          type: 'phone',
          label: 'Phone',
          required: false,
          width: 'full',
          prefix: 'X',
        },
        {
          key: 'name',
          type: 'text',
          label: 'Name',
          required: false,
          width: 'full',
          showCounter: true,
          validation: { maxLength: 30 },
        },
      ] as PublicFormSchema['schema'],
      submitLabel: 'Go',
      successMessage: 'Done',
      spamProtection: 'honeypot',
    };
  }

  it('renders a prefix chip on an adornable text field', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: matrixSchema() } } });
    const group = shadow(el).querySelector('[data-field="handle"] .rf-adorned') as HTMLElement;
    expect(group).toBeTruthy();
    expect(group.querySelector('.rf-adorn-prefix')?.textContent).toContain('@');
    expect(group.querySelector('input[name="handle"][type="text"]')).toBeTruthy();
  });

  it('never renders prefix chips on non-adornable textarea or phone', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: matrixSchema() } } });
    const root = shadow(el);
    // textarea is multiline: no chip, and the admin no longer offers one.
    expect(root.querySelector('[data-field="about"] .rf-adorned')).toBeNull();
    expect(root.querySelector('[data-field="about"] .rf-adorn-prefix')).toBeNull();
    // phone keeps only its own +91 chip, never a prefix adornment chip.
    expect(root.querySelector('[data-field="phone"] .rf-adorned')).toBeNull();
    expect(root.querySelector('[data-field="phone"] .rf-adorn-prefix')).toBeNull();
    expect(root.querySelector('[data-field="phone"] .rf-phone-prefix')?.textContent).toContain(
      '+91',
    );
  });

  it('renders a character counter for both text and textarea', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: matrixSchema() } } });
    const root = shadow(el);
    expect(root.querySelector('[data-field="name"] .rf-counter')?.textContent).toContain('0/30');
    expect(root.querySelector('[data-field="about"] .rf-counter')?.textContent).toContain('0/40');
  });
});

describe('ratio-form micro-animations (§2.4)', () => {
  it('emits a live duration token when animations are on and 0 by default', async () => {
    const on = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({ appearance: appearanceWith({ layout: { animations: true } }) }),
        },
      },
    });
    expect(shadow(on.el).querySelector('style')?.textContent).toContain('--wz-dur: 0.12s');
    const off = await mount();
    expect(shadow(off.el).querySelector('style')?.textContent).toContain('--wz-dur: 0s');
  });

  it('gates the input transitions on the motion tokens and reduced-motion', () => {
    const css = staticCss();
    expect(css).toContain('border-color var(--wz-dur) var(--wz-ease)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('ratio-form frosted card (§2.6)', () => {
  it('reflects data-card-blur only over an image backdrop with a blur radius', async () => {
    const frosted = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({
              background: {
                type: 'image',
                imageUrl: 'https://cdn.example.com/bg.jpg',
                cardBlur: 8,
              },
            }),
          }),
        },
      },
    });
    expect(frosted.el.getAttribute('data-card-blur')).toBe('on');
    expect(shadow(frosted.el).querySelector('style')?.textContent).toContain('--wz-card-blur: 8px');

    // Image but no blur radius ⇒ no frost.
    const noBlur = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({
              background: {
                type: 'image',
                imageUrl: 'https://cdn.example.com/bg.jpg',
                cardBlur: 0,
              },
            }),
          }),
        },
      },
    });
    expect(noBlur.el.hasAttribute('data-card-blur')).toBe(false);

    // Blur set but no image backdrop (gradient) ⇒ no frost (contrast rule).
    const gradient = await mount({
      schema: {
        status: 200,
        body: {
          data: kitchenSinkSchema({
            appearance: appearanceWith({
              background: {
                type: 'gradient',
                gradientFrom: '#111111',
                gradientTo: '#222222',
                cardBlur: 12,
              },
            }),
          }),
        },
      },
    });
    expect(gradient.el.hasAttribute('data-card-blur')).toBe(false);
  });

  it('ships the gated backdrop-filter rule with a translucent card', () => {
    const css = staticCss();
    expect(css).toContain(':host([data-card-blur]) .rf-card {');
    expect(css).toContain('backdrop-filter: blur(var(--wz-card-blur))');
  });
});

describe('ratio-form group accessible name (P2-7)', () => {
  it('binds radio/multi_select/rating groups to their label via aria-labelledby', async () => {
    // radio (P0 fixture): the group div carries the accessible name, and the
    // label no longer holds an inert for= pointing at that non-labelable div.
    const radioRoot = shadow(
      (await mount({ schema: { status: 200, body: { data: p0FieldsSchema() } } })).el,
    );
    const radioGroup = radioRoot.querySelector('[data-field="plan"] [role="radiogroup"]');
    expect(radioGroup?.getAttribute('aria-labelledby')).toBe('rf-label-plan');
    const radioLabel = radioRoot.getElementById('rf-label-plan');
    expect(radioLabel?.textContent).toContain('Plan');
    expect(radioLabel?.hasAttribute('for')).toBe(false);

    // multi_select (kitchen sink): a role=group container named by its label.
    const msRoot = shadow((await mount()).el);
    const msGroup = msRoot.querySelector('[data-field="interests"] [role="group"]');
    expect(msGroup?.getAttribute('aria-labelledby')).toBe('rf-label-interests');
    expect(msRoot.getElementById('rf-label-interests')?.textContent).toContain('Interests');
    expect(msRoot.getElementById('rf-label-interests')?.hasAttribute('for')).toBe(false);

    // rating (P1 fixture): the radiogroup gains the labelledby binding.
    const ratingRoot = shadow(
      (await mount({ schema: { status: 200, body: { data: p1FieldsSchema() } } })).el,
    );
    const ratingGroup = ratingRoot.querySelector('.rf-rating[role="radiogroup"]');
    expect(ratingGroup?.getAttribute('aria-labelledby')).toBe('rf-label-score');
    expect(ratingRoot.getElementById('rf-label-score')?.textContent).toContain('Rating');
    expect(ratingRoot.getElementById('rf-label-score')?.hasAttribute('for')).toBe(false);
  });

  it('keeps <label for> pointing at the real control on non-group fields', async () => {
    const root = shadow((await mount()).el);
    const label = root.querySelector('[data-field="full_name"] .rf-label');
    expect(label?.getAttribute('for')).toBe('rf-full_name');
  });
});

describe('ratio-form checkbox + file aria wiring (P2-8)', () => {
  it('wires aria-invalid + aria-describedby onto an invalid consent checkbox', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: p0FieldsSchema() } } });
    await submit(el);
    const consent = shadow(el).querySelector('input[name="consent"]') as HTMLInputElement;
    expect(consent.getAttribute('aria-invalid')).toBe('true');
    expect(consent.getAttribute('aria-describedby')).toBe('rf-err-consent');
  });

  it('clears the checkbox aria-invalid once consent is given', async () => {
    const { el } = await mount({ schema: { status: 200, body: { data: p0FieldsSchema() } } });
    await submit(el);
    const consent = shadow(el).querySelector('input[name="consent"]') as HTMLInputElement;
    consent.checked = true;
    consent.dispatchEvent(new Event('change', { bubbles: true }));
    await submit(el);
    expect(consent.hasAttribute('aria-invalid')).toBe(false);
  });

  it('wires aria-invalid + aria-describedby onto an invalid required file input', async () => {
    const fileSchema: PublicFormSchema = {
      id: 'form_file',
      name: 'File',
      schema: [
        {
          key: 'resume',
          type: 'file',
          label: 'Resume',
          required: true,
          validation: { allowedMimeTypes: ['application/pdf'], maxBytes: 1024 },
        },
      ] as PublicFormSchema['schema'],
      submitLabel: 'Go',
      successMessage: 'Done',
      spamProtection: 'honeypot',
    };
    const { el } = await mount({ schema: { status: 200, body: { data: fileSchema } } });
    await submit(el);
    const file = shadow(el).querySelector('input[name="resume"]') as HTMLInputElement;
    expect(file.getAttribute('aria-invalid')).toBe('true');
    expect(file.getAttribute('aria-describedby')).toBe('rf-err-resume');
  });
});
