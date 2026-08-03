import { Divider, Input, Segmented, Switch, Typography } from '@primathonos/orion';
import {
  MULTI_SELECT_DISPLAY_MODES,
  MULTI_SELECT_MAX_COLUMNS,
  MULTI_SELECT_MIN_COLUMNS,
} from '@shared/schemas/fields/multi_select/schema';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow, SettingRowGroup } from '../_shared/controls';
import { OptionsEditor } from '../_shared/OptionsEditor';

type MultiSelectField = Extract<FormField, { type: 'multi_select' }>;

const COLUMN_OPTIONS = Array.from(
  { length: MULTI_SELECT_MAX_COLUMNS - MULTI_SELECT_MIN_COLUMNS + 1 },
  (_, i) => MULTI_SELECT_MIN_COLUMNS + i,
);

export function MultiSelectSettings({
  field,
  dispatch,
}: {
  field: MultiSelectField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<MultiSelectField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  const selection = field.selection ?? {};
  const setSelection = (s: MultiSelectField['selection']) => patch({ selection: s });
  const display = field.display ?? 'checklist';
  const hasMax = selection.max !== undefined;

  return (
    <>
      <OptionsEditor field={field} dispatch={dispatch} />

      <Divider style={{ margin: '4px 0' }}>Selection limits</Divider>
      <SettingRowGroup>
        <SettingRow label="Min selections" style={{ flex: 1 }}>
          <Input
            aria-label="Minimum selections"
            type="number"
            min={0}
            value={selection.min ?? ''}
            onChange={(e) => setSelection({ ...selection, min: parseIntOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Max selections" style={{ flex: 1 }}>
          <Input
            aria-label="Maximum selections"
            type="number"
            min={1}
            value={selection.max ?? ''}
            onChange={(e) => setSelection({ ...selection, max: parseIntOr(e.target.value) })}
          />
        </SettingRow>
      </SettingRowGroup>

      <Divider style={{ margin: '4px 0' }}>Layout</Divider>
      <SettingRow label="Display mode">
        <Segmented
          aria-label="Display mode"
          value={display}
          onChange={(value) => patch({ display: value as MultiSelectField['display'] })}
          options={MULTI_SELECT_DISPLAY_MODES.map((m) => ({
            value: m,
            label: m === 'chips' ? 'Chips' : 'Checklist',
          }))}
        />
      </SettingRow>
      {display === 'checklist' && (
        <SettingRow label="Columns">
          <Segmented
            aria-label="Columns"
            value={field.columns ?? 1}
            onChange={(value) => patch({ columns: Number(value) as MultiSelectField['columns'] })}
            options={COLUMN_OPTIONS.map((c) => ({ value: c, label: String(c) }))}
          />
        </SettingRow>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Switch
          aria-label="Show select all"
          disabled={hasMax}
          checked={field.showSelectAll === true}
          onChange={(checked) => patch({ showSelectAll: checked || undefined })}
        />
        <Typography.Text>Show &ldquo;Select all&rdquo; control</Typography.Text>
      </div>
      {hasMax && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          Hidden while a maximum-selection limit is set.
        </Typography.Text>
      )}
    </>
  );
}
