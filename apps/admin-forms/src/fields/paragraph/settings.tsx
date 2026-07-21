import { Divider, Input } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

export function ParagraphSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'paragraph' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'paragraph' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Text</Divider>
      <SettingRow label="Text">
        <Input.TextArea
          aria-label="Paragraph text"
          rows={4}
          value={field.text}
          onChange={(e) => patch({ text: e.target.value })}
        />
      </SettingRow>
    </>
  );
}
