import { Divider, Input, Switch, Typography } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow, SettingRowGroup } from '../_shared/controls';

export function DateValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'date' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? {};
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <SettingRowGroup>
        <SettingRow label="Earliest date" style={{ flex: 1 }}>
          <Input
            aria-label="Earliest date"
            type="date"
            value={validation.min ?? ''}
            onChange={(e) => set({ ...validation, min: e.target.value || undefined })}
          />
        </SettingRow>
        <SettingRow label="Latest date" style={{ flex: 1 }}>
          <Input
            aria-label="Latest date"
            type="date"
            value={validation.max ?? ''}
            onChange={(e) => set({ ...validation, max: e.target.value || undefined })}
          />
        </SettingRow>
      </SettingRowGroup>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch
          aria-label="Default to today"
          checked={validation.defaultTo === 'today'}
          onChange={(checked) => set({ ...validation, defaultTo: checked ? 'today' : '' })}
        />
        <Typography.Text>Default to today</Typography.Text>
      </div>
    </>
  );
}
