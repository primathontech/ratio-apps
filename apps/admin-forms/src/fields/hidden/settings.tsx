import { Divider, Input, Typography } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

export function HiddenSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'hidden' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'hidden' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Hidden capture</Divider>
      <SettingRow label="URL parameter name">
        <Input
          aria-label="Param name"
          placeholder="e.g. utm_source"
          value={field.paramName}
          onChange={(e) => patch({ paramName: e.target.value })}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          Captured from the page URL query string; never shown to the visitor.
        </Typography.Text>
      </SettingRow>
    </>
  );
}
