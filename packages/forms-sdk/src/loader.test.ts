import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootForms, stopObserving, upgradeMounts } from './loader';

afterEach(() => {
  stopObserving();
  document.body.innerHTML = '';
  delete window.__FORMS_SDK_CONFIG__;
  delete window.RatioForms;
});

describe('upgradeMounts', () => {
  it('does nothing without the SDK config prelude', () => {
    document.body.innerHTML = '<div data-ratio-form="form_1"></div>';
    expect(upgradeMounts()).toBe(0);
    expect(document.querySelector('ratio-form')).toBeNull();
  });

  it('upgrades every [data-ratio-form] mount to a <ratio-form> renderer', () => {
    window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
    document.body.innerHTML =
      '<div data-ratio-form="form_1"></div><div data-ratio-form="form_2"></div>';
    expect(upgradeMounts()).toBe(2);
    const els = document.querySelectorAll('ratio-form');
    expect(els).toHaveLength(2);
    expect(els[0]?.getAttribute('form-id')).toBe('form_1');
    expect(els[1]?.getAttribute('form-id')).toBe('form_2');
  });

  it('is idempotent — a second scan never double-renders a mount', () => {
    window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
    document.body.innerHTML = '<div data-ratio-form="form_1"></div>';
    expect(upgradeMounts()).toBe(1);
    expect(upgradeMounts()).toBe(0);
    expect(document.querySelectorAll('ratio-form')).toHaveLength(1);
  });

  it('skips mounts with an empty form id', () => {
    window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
    document.body.innerHTML = '<div data-ratio-form=""></div>';
    expect(upgradeMounts()).toBe(0);
  });
});

describe('bootForms — late mounts (SPA client navigation)', () => {
  it('upgrades a mount added AFTER boot, via the MutationObserver', async () => {
    window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
    // Boot on an empty page (nothing to scan), then "navigate" — the mount
    // div appears afterwards, exactly as it does on Next.js soft navigation.
    bootForms();
    expect(document.querySelector('ratio-form')).toBeNull();

    document.body.innerHTML = '<div data-ratio-form="form_late"></div>';
    await vi.waitFor(() => {
      expect(document.querySelector('ratio-form')?.getAttribute('form-id')).toBe('form_late');
    });
  });

  it('upgrades several mounts that arrive across separate batches', async () => {
    window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
    bootForms();
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = '<div data-ratio-form="a"></div>';
    await vi.waitFor(() =>
      expect(document.querySelector('ratio-form[form-id="a"]')).not.toBeNull(),
    );
    // A later, independent DOM change (second soft navigation) is still caught.
    host.insertAdjacentHTML('beforeend', '<div data-ratio-form="b"></div>');
    await vi.waitFor(() =>
      expect(document.querySelector('ratio-form[form-id="b"]')).not.toBeNull(),
    );
    expect(document.querySelectorAll('ratio-form')).toHaveLength(2);
  });

  it('does not re-mount on unrelated mutations (idempotent under churn)', async () => {
    window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
    document.body.innerHTML = '<div data-ratio-form="form_1"></div>';
    bootForms();
    await vi.waitFor(() => expect(document.querySelector('ratio-form')).not.toBeNull());
    // Churn the DOM with nodes that are not mounts — must not add more forms.
    for (let i = 0; i < 5; i++) document.body.appendChild(document.createElement('span'));
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelectorAll('ratio-form')).toHaveLength(1);
  });

  it('self-heals via the observer when the renderer child is removed', async () => {
    window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
    document.body.innerHTML = '<div data-ratio-form="form_1"></div>';
    bootForms();
    const mount = document.querySelector('[data-ratio-form]') as HTMLElement;
    await vi.waitFor(() => expect(mount.querySelector('ratio-form')).not.toBeNull());
    // A framework re-render drops the child — a removedNodes-only mutation the
    // observer must still react to, or the mount stays permanently blank.
    mount.querySelector('ratio-form')?.remove();
    await vi.waitFor(() => expect(mount.querySelector('ratio-form')).not.toBeNull());
  });

  it('exposes window.RatioForms.upgrade as a manual re-scan hook', () => {
    window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
    bootForms();
    document.body.innerHTML = '<div data-ratio-form="form_1"></div>';
    expect(window.RatioForms?.upgrade()).toBe(1);
    expect(document.querySelector('ratio-form')?.getAttribute('form-id')).toBe('form_1');
  });

  it('self-heals: re-upgrades a mount whose renderer was removed by a re-render', () => {
    window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
    document.body.innerHTML = '<div data-ratio-form="form_1"></div>';
    const mount = document.querySelector('[data-ratio-form]') as HTMLElement;
    expect(upgradeMounts()).toBe(1);
    // A framework re-render drops the injected child but leaves the marker attr.
    mount.querySelector('ratio-form')?.remove();
    expect(mount.hasAttribute('data-ratio-form-mounted')).toBe(true);
    // Next scan restores the renderer rather than skipping on the stale attr.
    expect(upgradeMounts()).toBe(1);
    expect(mount.querySelector('ratio-form')?.getAttribute('form-id')).toBe('form_1');
  });

  it('falls back to setTimeout when requestAnimationFrame is unavailable', async () => {
    const raf = globalThis.requestAnimationFrame;
    // biome-ignore lint/suspicious/noExplicitAny: temporarily unset rAF to hit the fallback branch
    (globalThis as any).requestAnimationFrame = undefined;
    try {
      window.__FORMS_SDK_CONFIG__ = { merchantId: 'm1', apiBase: '/forms' };
      bootForms();
      document.body.innerHTML = '<div data-ratio-form="form_late"></div>';
      await vi.waitFor(() =>
        expect(document.querySelector('ratio-form')?.getAttribute('form-id')).toBe('form_late'),
      );
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
