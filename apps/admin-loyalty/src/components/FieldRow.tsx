import { Typography } from '@primathonos/orion';
import type { ReactNode } from 'react';

/**
 * The one labelled-field wrapper for every form in this admin.
 *
 * Three near-identical private copies of this used to live in `config.tsx`,
 * `rules.tsx` and `qr.tsx`, and only the config one rendered validation
 * messages — which is why the other screens could only report errors as one
 * lumped-together Alert above the submit button. Everything renders through
 * here now, so a required marker and an inline message are available
 * everywhere by construction.
 *
 * - `required` renders the `*` marker QA asked for. It is `aria-hidden` and
 *   paired with `aria-required` on the wrapped control's row plus
 *   visually-hidden text, so screen readers announce "required" rather than
 *   reading a bare asterisk.
 * - `error` replaces `hint` while present (never both — the message matters
 *   more than the guidance) and is announced via `role="alert"`.
 */
export function FieldRow({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
        {label}
        {required && (
          <>
            <span aria-hidden="true" style={{ color: '#ff4d4f', marginInlineStart: 2 }}>
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </Typography.Text>
      {children}
      {error && (
        <Typography.Text
          type="danger"
          role="alert"
          style={{ fontSize: 12, display: 'block', marginTop: 4 }}
        >
          {error}
        </Typography.Text>
      )}
      {hint && !error && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {hint}
        </Typography.Text>
      )}
    </div>
  );
}
