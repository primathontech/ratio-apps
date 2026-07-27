import { Divider, Input, Segmented } from '@primathonos/orion';
import { FORM_BLOCK_ALIGNMENTS, type FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

/** Capitalize an enum literal for a Segmented label (left → Left). */
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

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
      <SettingRow label="Alignment">
        <Segmented
          aria-label="Paragraph alignment"
          value={field.align}
          onChange={(value) =>
            patch({ align: value as Extract<FormField, { type: 'paragraph' }>['align'] })
          }
          options={FORM_BLOCK_ALIGNMENTS.map((a) => ({ value: a, label: cap(a) }))}
        />
      </SettingRow>
    </>
  );
}
