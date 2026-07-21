import { Divider, Input, Segmented } from '@primathonos/orion';
import { FORM_HEADING_LEVELS, type FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

export function HeadingSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'heading' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'heading' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Heading</Divider>
      <SettingRow label="Text">
        <Input
          aria-label="Heading text"
          value={field.text}
          onChange={(e) => patch({ text: e.target.value })}
        />
      </SettingRow>
      <SettingRow label="Level">
        <Segmented
          aria-label="Heading level"
          value={field.level}
          onChange={(value) =>
            patch({ level: value as Extract<FormField, { type: 'heading' }>['level'] })
          }
          options={FORM_HEADING_LEVELS.map((l) => ({ value: l, label: l.toUpperCase() }))}
        />
      </SettingRow>
    </>
  );
}
