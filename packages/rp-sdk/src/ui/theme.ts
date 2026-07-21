import { css } from 'lit';

export const baseStyles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  :host {
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: var(--rp-text, #111827);
    --rp-primary: #2563eb;
    --rp-primary-hover: #1d4ed8;
    --rp-bg: #ffffff;
    --rp-surface: #f9fafb;
    --rp-border: #e5e7eb;
    --rp-muted: #6b7280;
    --rp-error: #dc2626;
    --rp-success: #16a34a;
    --rp-radius: 8px;
    --rp-shadow: 0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06);
  }
  .rp-card {
    background: var(--rp-bg);
    border: 1px solid var(--rp-border);
    border-radius: var(--rp-radius);
    box-shadow: var(--rp-shadow);
    padding: 24px;
    max-width: 520px;
    margin: 0 auto;
  }
  .rp-title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .rp-subtitle {
    font-size: 13px;
    color: var(--rp-muted);
    margin-bottom: 20px;
  }
  .rp-label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 6px;
    color: var(--rp-text, #111827);
  }
  .rp-input {
    display: block;
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--rp-border);
    border-radius: 6px;
    font-size: 14px;
    outline: none;
    background: var(--rp-bg);
    color: var(--rp-text, #111827);
    transition: border-color 0.15s;
  }
  .rp-input:focus {
    border-color: var(--rp-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--rp-primary) 15%, transparent);
  }
  .rp-field {
    margin-bottom: 16px;
  }
  .rp-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.15s, opacity 0.15s;
  }
  .rp-btn-primary {
    background: var(--rp-primary);
    color: #fff;
    width: 100%;
  }
  .rp-btn-primary:hover {
    background: var(--rp-primary-hover);
  }
  .rp-btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .rp-btn-ghost {
    background: transparent;
    color: var(--rp-muted);
    padding: 0;
    font-size: 13px;
  }
  .rp-btn-ghost:hover {
    color: var(--rp-text, #111827);
  }
  .rp-error-msg {
    font-size: 13px;
    color: var(--rp-error);
    margin-top: 12px;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--rp-error) 8%, transparent);
    border-radius: 6px;
  }
  .rp-spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid color-mix(in srgb, var(--rp-primary) 30%, transparent);
    border-top-color: var(--rp-primary);
    border-radius: 50%;
    animation: rp-spin 0.7s linear infinite;
  }
  @keyframes rp-spin {
    to { transform: rotate(360deg); }
  }
  .rp-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 0;
    gap: 12px;
    color: var(--rp-muted);
    font-size: 14px;
  }
  .rp-back {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--rp-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 0 16px;
  }
  .rp-back:hover { color: var(--rp-text, #111827); }
  .rp-divider {
    border: none;
    border-top: 1px solid var(--rp-border);
    margin: 16px 0;
  }
`;
