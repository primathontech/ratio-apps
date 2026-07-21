import { Divider, Input, Switch, Typography } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseFloatOr, SettingRow, SettingRowGroup } from '../_shared/controls';

export function NumberValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'number' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? { integer: false };
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <SettingRowGroup>
        <SettingRow label="Min" style={{ flex: 1 }}>
          <Input
            aria-label="Min"
            type="number"
            value={validation.min ?? ''}
            onChange={(e) => set({ ...validation, min: parseFloatOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Max" style={{ flex: 1 }}>
          <Input
            aria-label="Max"
            type="number"
            value={validation.max ?? ''}
            onChange={(e) => set({ ...validation, max: parseFloatOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Step" style={{ flex: 1 }}>
          <Input
            aria-label="Step"
            type="number"
            min={0}
            value={validation.step ?? ''}
            onChange={(e) => set({ ...validation, step: parseFloatOr(e.target.value) })}
          />
        </SettingRow>
      </SettingRowGroup>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch
          aria-label="Integer only"
          checked={validation.integer}
          onChange={(checked) => set({ ...validation, integer: checked })}
        />
        <Typography.Text>Integer only</Typography.Text>
      </div>
    </>
  );
}
