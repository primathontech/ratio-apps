import { afterEach, describe, expect, it } from 'vitest';
import { upgradeMounts } from './loader';

afterEach(() => {
  document.body.innerHTML = '';
  delete window.__FORMS_SDK_CONFIG__;
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
