import { css } from 'lit';

/**
 * Theme input accepted by the SDK. Only the visual tokens a storefront is
 * likely to override are exposed; everything else falls back to sensible
 * defaults baked into {@link themeVars}.
 */
export interface WizzyThemeInput {
  primary?: string;
  radius?: string;
}

/**
 * Emit a `:host` CSS custom-property block from a theme. Returned as a plain
 * string so consumers can inline it (e.g. an inline `<style>` block) — Lit
 * components read these tokens via `var(--wz-*)`.
 */
export function themeVars(theme: WizzyThemeInput): string {
  const primary = theme.primary || '#0fb3a9';
  const radius = theme.radius || '10px';
  return `:host { --wz-primary: ${primary}; --wz-radius: ${radius}; --wz-fg: #1a1a1a; --wz-bg: #fff; --wz-muted: #6b7280; --wz-border: #e5e7eb; }`;
}

/**
 * Shared resets + token-driven helpers imported by every Wizzy UI component.
 * Kept lean: box model, system font stack, button/anchor resets, and a couple
 * of layout helpers (`.wz-card`, `.wz-grid`).
 */
export const baseStyles = css`
  :host {
    --wz-primary: #0fb3a9;
    --wz-radius: 10px;
    --wz-fg: #1a1a1a;
    --wz-bg: #fff;
    --wz-muted: #6b7280;
    --wz-border: #e5e7eb;
    box-sizing: border-box;
    color: var(--wz-fg);
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      Roboto,
      Helvetica,
      Arial,
      sans-serif;
  }
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }
  a {
    color: inherit;
    text-decoration: none;
  }
  .wz-card {
    background: var(--wz-bg);
    border: 1px solid var(--wz-border);
    border-radius: var(--wz-radius);
    overflow: hidden;
  }
  .wz-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }
`;
