import { describe, expect, it } from 'vitest';
import { themeVars } from './theme';

describe('themeVars', () => {
  it('emits a CSS custom-property block from a theme', () => {
    const css = themeVars({ primary: '#0fb3a9' });
    expect(css).toContain('--wz-primary: #0fb3a9');
  });
  it('falls back to the default primary when none given', () => {
    const css = themeVars({});
    expect(css).toContain('--wz-primary:');
  });
});
