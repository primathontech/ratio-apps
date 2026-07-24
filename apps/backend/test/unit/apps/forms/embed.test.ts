import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FormIdPipe } from '../../../../src/core/common/pipes/form-id.pipe';
import { FormsEmbedController } from '../../../../src/modules/forms/sdk/embed.controller';
import { FormsEmbedService } from '../../../../src/modules/forms/sdk/embed.service';
import { makeFakeHandle } from './fixtures/fake-db';

const KNOWN_FORM = 'form_W1GVsh6Skzezuwzw';

function makeService(seedForms: Record<string, unknown>[] = []) {
  const { handle } = makeFakeHandle({ forms: seedForms as never });
  return new FormsEmbedService(handle);
}

/** Fastify reply fake that records headers, status, removed headers, and body. */
function makeReply() {
  const headers: Record<string, string> = {};
  const removed: string[] = [];
  const state: { status: number; body: string } = { status: 200, body: '' };
  const reply = {
    header: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
      return reply;
    },
    removeHeader: (k: string) => {
      removed.push(k);
      delete headers[k.toLowerCase()];
      return reply;
    },
    status: (code: number) => {
      state.status = code;
      return reply;
    },
    send: (body: string) => {
      state.body = body;
      return reply;
    },
  };
  return { reply, headers, removed, state };
}

describe('FormsEmbedService — form resolution (GET /forms/embed/:formId)', () => {
  it('resolves merchant + name for an existing, non-deleted form (status not gated)', async () => {
    const service = makeService([
      { id: KNOWN_FORM, merchantId: 'mer_1', name: 'Contact us', status: 'inactive', deletedAt: null },
    ]);
    // status=inactive still resolves — the SDK renders the closed state itself.
    await expect(service.resolve(KNOWN_FORM)).resolves.toEqual({
      merchantId: 'mer_1',
      name: 'Contact us',
    });
  });

  it('returns null for an unknown or soft-deleted form', async () => {
    const service = makeService([
      { id: 'form_deleted', merchantId: 'mer_1', name: 'Gone', status: 'active', deletedAt: new Date() },
    ]);
    await expect(service.resolve('form_missing')).resolves.toBeNull();
    await expect(service.resolve('form_deleted')).resolves.toBeNull();
  });
});

describe('FormsEmbedController — iframe embed page', () => {
  it('200 text/html with the mount div + relative SDK script for a known form', async () => {
    const service = makeService([
      { id: KNOWN_FORM, merchantId: 'mer_abc', name: 'Contact us', status: 'active', deletedAt: null },
    ]);
    const controller = new FormsEmbedController(service);
    const { reply, headers, state } = makeReply();

    await controller.serve(KNOWN_FORM, reply as never);

    expect(state.status).toBe(200);
    expect(headers['content-type']).toBe('text/html; charset=utf-8');
    expect(state.body).toContain('<!doctype html>');
    expect(state.body).toContain(`<div data-ratio-form="${KNOWN_FORM}">`);
    expect(state.body).toContain('<script src="/forms/sdk/mer_abc.js" defer></script>');
    expect(state.body).toContain('<title>Contact us</title>');
  });

  it('is frameable from any origin — no X-Frame-Options, CSP allows all frame-ancestors', async () => {
    const service = makeService([
      { id: KNOWN_FORM, merchantId: 'mer_abc', name: 'Contact us', status: 'active', deletedAt: null },
    ]);
    const controller = new FormsEmbedController(service);
    const { reply, headers, removed } = makeReply();

    await controller.serve(KNOWN_FORM, reply as never);

    expect(removed).toContain('X-Frame-Options');
    expect(headers['x-frame-options']).toBeUndefined();
    expect(headers['content-security-policy']).toBe('frame-ancestors *');
  });

  it('404 HTML (not a JSON error) for an unknown form', async () => {
    const service = makeService([]);
    const controller = new FormsEmbedController(service);
    const { reply, headers, state } = makeReply();

    await controller.serve('form_unknown', reply as never);

    expect(state.status).toBe(404);
    expect(headers['content-type']).toBe('text/html; charset=utf-8');
    expect(state.body).toContain('<!doctype html>');
    expect(state.body).toContain('This form is not available.');
    // Even the 404 stays frameable so it renders inside the iframe.
    expect(headers['x-frame-options']).toBeUndefined();
  });

  it('escapes the form name into the title (no raw HTML injection)', async () => {
    const service = makeService([
      { id: KNOWN_FORM, merchantId: 'mer_abc', name: '<script>x</script>', status: 'active', deletedAt: null },
    ]);
    const controller = new FormsEmbedController(service);
    const { reply, state } = makeReply();

    await controller.serve(KNOWN_FORM, reply as never);

    expect(state.body).toContain('<title>&lt;script&gt;x&lt;/script&gt;</title>');
    expect(state.body).not.toContain('<title><script>x</script></title>');
  });
});

describe('FormIdPipe', () => {
  const pipe = new FormIdPipe();

  it('accepts a minted form id', () => {
    expect(pipe.transform(KNOWN_FORM)).toBe(KNOWN_FORM);
  });

  it('rejects path-traversal / malformed ids', () => {
    for (const bad of ['../etc', 'form_../x', 'mer_1', 'form_', '', 'form_a/b']) {
      expect(() => pipe.transform(bad)).toThrow(BadRequestException);
    }
  });
});
