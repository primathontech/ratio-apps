import { Divider, Input, Typography } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

/**
 * page_break settings (§1.3). A page break is a display-only layout separator
 * that splits the form's fields into wizard steps — it collects no value, so
 * the only thing to edit is the optional heading shown at the top of the step
 * it starts. Mirrors the divider/heading panels; an empty title clears back to
 * the default (absent key), like the heading eyebrow.
 */
export function PageBreakSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'page_break' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'page_break' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Page break</Divider>
      <SettingRow label="Step title">
        <Input
          aria-label="Step title"
          placeholder="Heading shown at the top of this step"
          value={field.title ?? ''}
          onChange={(e) => patch({ title: e.target.value ? e.target.value : undefined })}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          Starts a new step; everything after it moves to the next page.
        </Typography.Text>
      </SettingRow>
    </>
  );
}
