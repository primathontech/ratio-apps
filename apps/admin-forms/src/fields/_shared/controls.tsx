import { Divider, Input, Typography } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
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

export function parseIntOr(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function parseFloatOr(value: string): number | undefined {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? undefined : n;
}
