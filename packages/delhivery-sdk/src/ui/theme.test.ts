import { describe, expect, it } from 'vitest';
import { themeVars } from './theme';

describe('themeVars', () => {
  it('emits a CSS custom-property block from a theme', () => {
    const css = themeVars({ primary: '#e11b22' });
    expect(css).toContain('--dlv-primary: #e11b22');
  });
  it('falls back to the default primary when none given', () => {
    const css = themeVars({});
    expect(css).toContain('--dlv-primary:');
  });
});
