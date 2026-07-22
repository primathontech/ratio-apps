import { Divider, Input } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow, SettingRowGroup } from '../_shared/controls';

export function TextValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'text' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? {};
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <SettingRowGroup>
        <SettingRow label="Min length" style={{ flex: 1 }}>
          <Input
            aria-label="Min length"
            type="number"
            min={0}
            value={validation.minLength ?? ''}
            onChange={(e) => set({ ...validation, minLength: parseIntOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Max length" style={{ flex: 1 }}>
          <Input
            aria-label="Max length"
            type="number"
            min={1}
            value={validation.maxLength ?? ''}
            onChange={(e) => set({ ...validation, maxLength: parseIntOr(e.target.value) })}
          />
        </SettingRow>
      </SettingRowGroup>
      <SettingRow label="Pattern (regex)">
        <Input
          aria-label="Pattern"
          placeholder="e.g. ^[A-Z]{2}[0-9]{4}$"
          value={validation.pattern ?? ''}
          onChange={(e) =>
            set({ ...validation, pattern: e.target.value ? e.target.value : undefined })
          }
        />
      </SettingRow>
    </>
  );
}
