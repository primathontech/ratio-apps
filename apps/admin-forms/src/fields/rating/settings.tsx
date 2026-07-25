import { Divider, Input, Radio, RadioGroup, Select } from '@primathonos/orion';
import { FORM_RATING_DISPLAYS } from '@shared/schemas/fields/rating/schema';
import { FORM_RATING_ICONS, type FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow, SettingRowGroup } from '../_shared/controls';

type RatingField = Extract<FormField, { type: 'rating' }>;

const DISPLAY_LABELS: Record<RatingField['display'] & string, string> = {
  stars: 'Stars',
  numbers: 'Numbers',
};

export function RatingSettings({
  field,
  dispatch,
}: {
  field: RatingField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<RatingField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Rating</Divider>
      <SettingRowGroup>
        <SettingRow label="Min (0-1)" style={{ flex: 1 }}>
          <Input
            aria-label="Min rating"
            type="number"
            min={0}
            max={1}
            value={field.min ?? ''}
            onChange={(e) => {
              const parsed = parseIntOr(e.target.value);
              patch({ min: parsed === undefined ? undefined : Math.min(1, Math.max(0, parsed)) });
            }}
          />
        </SettingRow>
        <SettingRow label="Max (3-10)" style={{ flex: 1 }}>
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
      </SettingRowGroup>
      <SettingRow label="Display style">
        <Select
          aria-label="Display style"
          style={{ width: '100%' }}
          value={field.display ?? 'stars'}
          onChange={(value) => patch({ display: value as RatingField['display'] })}
          options={FORM_RATING_DISPLAYS.map((d) => ({ value: d, label: DISPLAY_LABELS[d] }))}
        />
      </SettingRow>
      <SettingRow label="Icon">
        <RadioGroup
          value={field.icon}
          onChange={(e) => patch({ icon: e.target.value as RatingField['icon'] })}
        >
          {FORM_RATING_ICONS.map((icon) => (
            <Radio key={icon} value={icon}>
              {icon === 'heart' ? 'Heart' : 'Star'}
            </Radio>
          ))}
        </RadioGroup>
      </SettingRow>
      <SettingRowGroup>
        <SettingRow label="Low label" style={{ flex: 1 }}>
          <Input
            aria-label="Low label"
            maxLength={80}
            placeholder="e.g. Not likely"
            value={field.lowLabel ?? ''}
            onChange={(e) => patch({ lowLabel: e.target.value || undefined })}
          />
        </SettingRow>
        <SettingRow label="High label" style={{ flex: 1 }}>
          <Input
            aria-label="High label"
            maxLength={80}
            placeholder="e.g. Very likely"
            value={field.highLabel ?? ''}
            onChange={(e) => patch({ highLabel: e.target.value || undefined })}
          />
        </SettingRow>
      </SettingRowGroup>
    </>
  );
}
