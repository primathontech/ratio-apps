import { css } from 'lit';

/**
 * Theme input accepted by the SDK. Only the visual tokens a storefront is
 * likely to override are exposed; everything else falls back to sensible
 * defaults baked into {@link themeVars} / {@link baseStyles}.
 */
export interface DelhiveryThemeInput {
  primary?: string;
  radius?: string;
}

/**
 * Emit a `:host` CSS custom-property block from a theme. Returned as a plain
 * string so consumers can inline it (e.g. an inline `<style>` block) — the
 * widget reads these tokens via `var(--dlv-*)`.
 */
export function themeVars(theme: DelhiveryThemeInput): string {
  const primary = theme.primary || '#1e874b';
  const radius = theme.radius || '8px';
  return `:host { --dlv-primary: ${primary}; --dlv-radius: ${radius}; --dlv-fg: #1a1a1a; --dlv-bg: #fff; --dlv-muted: #6b7280; --dlv-border: #e5e7eb; --dlv-danger: #b91c1c; }`;
}

/**
 * Shared resets + token-driven helpers for the SDK's Shadow-DOM UI. Kept lean:
 * box model, system font stack, button reset, and the badge helper the
 * serviceability result uses.
 */
export const baseStyles = css`
  :host {
    --dlv-primary: #1e874b;
    --dlv-radius: 8px;
    --dlv-fg: #1a1a1a;
    --dlv-bg: #fff;
    --dlv-muted: #6b7280;
    --dlv-border: #e5e7eb;
    --dlv-danger: #b91c1c;
    box-sizing: border-box;
    color: var(--dlv-fg);
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
  .dlv-badge {
    display: inline-block;
    border: 1px solid var(--dlv-border);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
    color: var(--dlv-muted);
  }
  .dlv-badge--ok {
    border-color: var(--dlv-primary);
    color: var(--dlv-primary);
  }
`;
