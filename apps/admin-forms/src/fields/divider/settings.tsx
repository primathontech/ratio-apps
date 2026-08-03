import { Divider, Input, Segmented } from '@primathonos/orion';
import { FORM_DIVIDER_VARIANTS, type FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow } from '../_shared/controls';

/** Capitalize an enum literal for a Segmented label (line → Line). */
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export function DividerSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'divider' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'divider' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Divider</Divider>
      <SettingRow label="Style">
        <Segmented
          aria-label="Divider style"
          value={field.variant}
          onChange={(value) =>
            patch({ variant: value as Extract<FormField, { type: 'divider' }>['variant'] })
          }
          options={FORM_DIVIDER_VARIANTS.map((v) => ({ value: v, label: cap(v) }))}
        />
      </SettingRow>
      <SettingRow label="Spacing (px, 0-80)">
        <Input
          aria-label="Divider spacing"
          type="number"
          min={0}
          max={80}
          placeholder="Default"
          value={field.spacing ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            // Empty ⇒ clear back to the default spacing (absent key).
            if (raw === '') {
              patch({ spacing: undefined });
              return;
            }
            const parsed = parseIntOr(raw);
            if (parsed === undefined) return;
            patch({ spacing: Math.min(80, Math.max(0, parsed)) });
          }}
        />
      </SettingRow>
    </>
  );
}
