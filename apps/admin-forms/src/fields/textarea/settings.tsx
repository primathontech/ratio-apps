import { Divider, Input, Segmented, Switch, Typography } from '@primathonos/orion';
import {
  TEXTAREA_COUNTER_UNITS,
  TEXTAREA_ROW_MAX,
  TEXTAREA_ROW_MIN,
} from '@shared/schemas/fields/textarea/constants';
import { FORM_TEXTAREA_HARD_MAX_LENGTH, type FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow, SettingRowGroup } from '../_shared/controls';

type TextareaField = Extract<FormField, { type: 'textarea' }>;
type TextareaDisplay = NonNullable<TextareaField['display']>;

export function TextareaValidationSettings({
  field,
  dispatch,
}: {
  field: TextareaField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? { maxLength: 5000 };
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });

  const display: TextareaDisplay = field.display ?? {};
  const setDisplay = (patch: Partial<TextareaDisplay>) => {
    const next = { ...display, ...patch };
    dispatch({ type: 'updateField', key: field.key, patch: { display: next } });
  };

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
            max={FORM_TEXTAREA_HARD_MAX_LENGTH}
            placeholder={`≤ ${FORM_TEXTAREA_HARD_MAX_LENGTH}`}
            value={validation.maxLength ?? ''}
            onChange={(e) => {
              const parsed = parseIntOr(e.target.value);
              set({
                ...validation,
                maxLength:
                  parsed === undefined
                    ? validation.maxLength
                    : Math.min(parsed, FORM_TEXTAREA_HARD_MAX_LENGTH),
              });
            }}
          />
        </SettingRow>
      </SettingRowGroup>

      <Divider style={{ margin: '4px 0' }}>Display</Divider>
      <SettingRowGroup>
        <SettingRow label="Min rows" style={{ flex: 1 }}>
          <Input
            aria-label="Min rows"
            type="number"
            min={TEXTAREA_ROW_MIN}
            max={TEXTAREA_ROW_MAX}
            value={display.minRows ?? ''}
            onChange={(e) => setDisplay({ minRows: parseIntOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Max rows" style={{ flex: 1 }}>
          <Input
            aria-label="Max rows"
            type="number"
            min={TEXTAREA_ROW_MIN}
            max={TEXTAREA_ROW_MAX}
            value={display.maxRows ?? ''}
            onChange={(e) => setDisplay({ maxRows: parseIntOr(e.target.value) })}
          />
        </SettingRow>
      </SettingRowGroup>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Switch
          aria-label="Grow with content"
          checked={display.autoGrow ?? false}
          onChange={(checked) => setDisplay({ autoGrow: checked || undefined })}
        />
        <Typography.Text>Grow with content</Typography.Text>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Switch
          aria-label="Stop typing at max length"
          checked={display.enforceMaxLength ?? false}
          onChange={(checked) => setDisplay({ enforceMaxLength: checked || undefined })}
        />
        <Typography.Text>Stop typing at max length</Typography.Text>
      </div>

      <SettingRow label="Counter unit" style={{ marginTop: 8 }}>
        <Segmented
          aria-label="Counter unit"
          value={display.counterUnit ?? 'characters'}
          onChange={(value) => setDisplay({ counterUnit: value as TextareaDisplay['counterUnit'] })}
          options={TEXTAREA_COUNTER_UNITS.map((u) => ({
            value: u,
            label: u === 'characters' ? 'Characters' : 'Words',
          }))}
        />
      </SettingRow>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Switch
          aria-label="Monospace font"
          checked={display.monospace ?? false}
          onChange={(checked) => setDisplay({ monospace: checked || undefined })}
        />
        <Typography.Text>Monospace font</Typography.Text>
      </div>
    </>
  );
}
