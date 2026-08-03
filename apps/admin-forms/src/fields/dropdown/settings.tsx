import { Divider, Input, Switch, Typography } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';
import { OptionsEditor } from '../_shared/OptionsEditor';

type DropdownField = Extract<FormField, { type: 'dropdown' }>;

export function DropdownSettings({
  field,
  dispatch,
}: {
  field: DropdownField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<DropdownField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <OptionsEditor field={field} dispatch={dispatch} />

      <Divider style={{ margin: '8px 0 4px' }}>Behavior</Divider>
      <SettingRow label="Prompt (leading option text)">
        <Input
          aria-label="Prompt text"
          maxLength={120}
          placeholder="Select..."
          value={field.prompt ?? ''}
          onChange={(e) => patch({ prompt: e.target.value || undefined })}
        />
      </SettingRow>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Switch
          aria-label="Searchable"
          checked={field.searchable === true}
          onChange={(checked) => patch({ searchable: checked || undefined })}
        />
        <Typography.Text>Searchable (type-ahead combobox)</Typography.Text>
      </div>
    </>
  );
}
