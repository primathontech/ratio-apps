import { Divider, Input, Radio, RadioGroup } from '@primathonos/orion';
import { FORM_RATING_ICONS, type FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow } from '../_shared/controls';

export function RatingSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'rating' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'rating' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Rating</Divider>
      <SettingRow label="Max (3-10)">
        <Input
          aria-label="Max rating"
          type="number"
          min={3}
          max={10}
          value={field.max}
          onChange={(e) => {
            const parsed = parseIntOr(e.target.value);
            if (parsed === undefined) return;
            patch({ max: Math.min(10, Math.max(3, parsed)) });
          }}
        />
      </SettingRow>
      <SettingRow label="Icon">
        <RadioGroup
          value={field.icon}
          onChange={(e) =>
            patch({ icon: e.target.value as Extract<FormField, { type: 'rating' }>['icon'] })
          }
        >
          {FORM_RATING_ICONS.map((icon) => (
            <Radio key={icon} value={icon}>
              {icon === 'heart' ? 'Heart' : 'Star'}
            </Radio>
          ))}
        </RadioGroup>
      </SettingRow>
    </>
  );
}
