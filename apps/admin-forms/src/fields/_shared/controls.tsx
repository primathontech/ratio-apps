import { Typography } from '@primathonos/orion';
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
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      {children}
    </div>
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
