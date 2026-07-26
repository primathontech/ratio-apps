import { Collapse, Divider, Input, Space, Typography } from '@primathonos/orion';
import { MAX_FIELD_CSS_LENGTH, sanitizeFieldCss } from '@shared/schemas/custom-css';
import type { FormField } from '@shared/schemas/form-schema';
import { type Dispatch, useMemo } from 'react';
import type { BuilderAction } from '@/lib/builder-state';

/**
 * Shared admin field-settings primitives (Phase 0 refactor). The per-field
 * settings panels in `../<type>/settings.tsx` compose from these; nothing here
 * adds behavior — it is a pure extraction of the helpers that used to live
 * inline in `builder.$formId.tsx`.
 */

/** Props every per-field settings panel receives. */
export interface FieldSettingsProps<T extends FormField = FormField> {
  field: T;
  dispatch: Dispatch<BuilderAction>;
}

/** The registry value type — a settings panel widened to the field union. */
export type FieldSettingsComponent = (props: FieldSettingsProps) => React.ReactNode;

export function SettingRow({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={style}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
        {label}
      </Typography.Text>
      {children}
    </div>
  );
}

/**
 * Lays paired SettingRows in equal-width columns whose inputs bottom-align.
 * A longer label (e.g. "Max length (≤ 10000)") can wrap to two lines without
 * pushing its input lower than its neighbour's.
 */
export function SettingRowGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>{children}</div>;
}

/** Any input (collectable) field — the members carrying baseFieldShape's
 * helpText/errorMessage. Content blocks (heading/divider/paragraph/image) lack
 * `required` and never reach this control. */
type InputField = Extract<FormField, { required: boolean }>;

/**
 * Shared production-validation messages control: a merchant-authored help hint
 * shown under the field and a custom error message that overrides the humanized
 * default whenever the field fails validation. Both are optional
 * (`baseFieldShape`) and read isomorphically by the SDK and the backend, so the
 * merchant edits one place and both client + server honor it.
 */
export function FieldMessagesSettings({
  field,
  dispatch,
}: {
  field: InputField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<InputField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Messages</Divider>
      <SettingRow label="Help text (shown under the field)">
        <Input
          aria-label="Help text"
          maxLength={200}
          placeholder="A hint shown below the field"
          value={field.helpText ?? ''}
          onChange={(e) => patch({ helpText: e.target.value || undefined })}
        />
      </SettingRow>
      <SettingRow label="Custom error message">
        <Input
          aria-label="Custom error message"
          maxLength={500}
          placeholder="Shown when this field fails validation"
          value={field.errorMessage ?? ''}
          onChange={(e) => patch({ errorMessage: e.target.value || undefined })}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          Leave blank to use the default message.
        </Typography.Text>
      </SettingRow>
    </>
  );
}

/**
 * Shared per-field Custom CSS control (lives on `baseFieldShape.customCss`, so
 * every collectable field renders it). A merchant authors raw CSS to make one
 * field resemble their storefront; we store it raw + bounded and the SDK read
 * path sanitizes + field-scopes it before it ever reaches the widget's shadow
 * root.
 *
 * The admin runs the SAME shared sanitizer (`sanitizeFieldCss`) purely for a
 * LIVE preview: it shows the exact scoped CSS that will apply and, inline, the
 * `removed` notes (e.g. `url()` dropped, `position: fixed` not allowed) so the
 * merchant sees what was stripped and why. The preview is advisory — the
 * authoritative sanitize happens server-side on the embed read path.
 */
export function FieldCustomCssSettings({
  field,
  dispatch,
}: {
  field: InputField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const raw = field.customCss ?? '';
  const scope = `[data-field="${field.key}"]`;
  // Same sanitizer the server/SDK use — recomputed only when the CSS or the
  // field key (which drives the scope) changes.
  const result = useMemo(() => sanitizeFieldCss(raw, scope), [raw, scope]);
  const patch = (p: Partial<InputField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  const trimmed = raw.trim();
  return (
    <Collapse
      items={[
        {
          key: 'custom-css',
          label: 'Custom CSS',
          children: (
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <SettingRow label="Custom CSS">
                <Input.TextArea
                  aria-label="Custom CSS"
                  rows={6}
                  maxLength={MAX_FIELD_CSS_LENGTH}
                  spellCheck={false}
                  placeholder={'input {\n  border-radius: 8px;\n  border-color: #1a1a1a;\n}'}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                  value={raw}
                  onChange={(e) => patch({ customCss: e.target.value || undefined })}
                />
                <Typography.Text
                  type="secondary"
                  aria-label="Custom CSS character count"
                  style={{ display: 'block', marginTop: 4, fontSize: 12 }}
                >
                  {raw.length} / {MAX_FIELD_CSS_LENGTH}
                </Typography.Text>
              </SettingRow>

              {result.removed.length > 0 && (
                <div
                  role="alert"
                  aria-label="Custom CSS warnings"
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: '1px solid #ffccc7',
                    background: '#fff2f0',
                  }}
                >
                  <Typography.Text strong style={{ display: 'block', fontSize: 12 }}>
                    Some CSS was removed:
                  </Typography.Text>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {result.removed.map((note) => (
                      <li key={note}>
                        <Typography.Text type="danger" style={{ fontSize: 12 }}>
                          {note}
                        </Typography.Text>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {trimmed && (
                <SettingRow label="Applied to this field (scoped preview)">
                  <pre
                    aria-label="Sanitized CSS preview"
                    style={{
                      margin: 0,
                      padding: 8,
                      borderRadius: 6,
                      background: '#f5f5f5',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {result.css || '/* Nothing will be applied. */'}
                  </pre>
                  <Typography.Text
                    type="secondary"
                    style={{ display: 'block', marginTop: 4, fontSize: 12 }}
                  >
                    Every rule is scoped to <code>{scope}</code> so it only styles this field.
                  </Typography.Text>
                </SettingRow>
              )}
            </Space>
          ),
        },
      ]}
    />
  );
}

export function parseIntOr(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function parseFloatOr(value: string): number | undefined {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? undefined : n;
}
