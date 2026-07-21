import { Divider, Input } from '@primathonos/orion';
import { FORM_TEXTAREA_HARD_MAX_LENGTH, type FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow } from '../_shared/controls';

export function TextareaValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'textarea' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? { maxLength: 5000 };
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <div style={{ display: 'flex', gap: 8 }}>
        <SettingRow label="Min length">
          <Input
            aria-label="Min length"
            type="number"
            min={0}
            value={validation.minLength ?? ''}
            onChange={(e) => set({ ...validation, minLength: parseIntOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label={`Max length (≤ ${FORM_TEXTAREA_HARD_MAX_LENGTH})`}>
          <Input
            aria-label="Max length"
            type="number"
            min={1}
            max={FORM_TEXTAREA_HARD_MAX_LENGTH}
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
      </div>
    </>
  );
}
