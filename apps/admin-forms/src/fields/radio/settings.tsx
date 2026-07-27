import { Divider, Segmented } from '@primathonos/orion';
import {
  RADIO_LAYOUTS,
  RADIO_MAX_GRID_COLUMNS,
  RADIO_MIN_GRID_COLUMNS,
  RADIO_VARIANTS,
} from '@shared/schemas/fields/radio/schema';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';
import { OptionsEditor } from '../_shared/OptionsEditor';

type RadioField = Extract<FormField, { type: 'radio' }>;

const LAYOUT_LABELS: Record<(typeof RADIO_LAYOUTS)[number], string> = {
  vertical: 'Vertical',
  horizontal: 'Horizontal',
  grid: 'Grid',
};
const VARIANT_LABELS: Record<(typeof RADIO_VARIANTS)[number], string> = {
  list: 'List',
  button: 'Buttons',
  card: 'Cards',
};

const GRID_COLUMN_OPTIONS = Array.from(
  { length: RADIO_MAX_GRID_COLUMNS - RADIO_MIN_GRID_COLUMNS + 1 },
  (_, i) => RADIO_MIN_GRID_COLUMNS + i,
);

export function RadioSettings({
  field,
  dispatch,
}: {
  field: RadioField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<RadioField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  const layout = field.layout ?? 'vertical';
  const variant = field.variant ?? 'list';

  return (
    <>
      <OptionsEditor field={field} dispatch={dispatch} />

      <Divider style={{ margin: '8px 0 4px' }}>Layout</Divider>
      <SettingRow label="Arrangement">
        <Segmented
          aria-label="Radio layout"
          value={layout}
          onChange={(value) => patch({ layout: value as RadioField['layout'] })}
          options={RADIO_LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABELS[l] }))}
        />
      </SettingRow>
      {layout === 'grid' && (
        <SettingRow label="Columns">
          <Segmented
            aria-label="Grid columns"
            value={field.gridColumns ?? RADIO_MIN_GRID_COLUMNS}
            onChange={(value) => patch({ gridColumns: Number(value) as RadioField['gridColumns'] })}
            options={GRID_COLUMN_OPTIONS.map((c) => ({ value: c, label: String(c) }))}
          />
        </SettingRow>
      )}
      <SettingRow label="Style" style={{ marginTop: 8 }}>
        <Segmented
          aria-label="Radio variant"
          value={variant}
          onChange={(value) => patch({ variant: value as RadioField['variant'] })}
          options={RADIO_VARIANTS.map((v) => ({ value: v, label: VARIANT_LABELS[v] }))}
        />
      </SettingRow>
    </>
  );
}
