import { Divider, Input, Switch, Typography } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow } from '../_shared/controls';
import { FieldHint } from '../_shared/FieldHint';

export function UrlSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'url' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? { requireHttps: false };
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <FieldHint title="URL">Validated as a URL when the form is submitted.</FieldHint>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <SettingRow label="Max length">
        <Input
          aria-label="Max length"
          type="number"
          min={1}
          max={2048}
          value={validation.maxLength ?? ''}
          onChange={(e) => set({ ...validation, maxLength: parseIntOr(e.target.value) })}
        />
      </SettingRow>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Switch
          aria-label="Require HTTPS"
          checked={validation.requireHttps}
          onChange={(checked) => set({ ...validation, requireHttps: checked })}
        />
        <Typography.Text>Require HTTPS</Typography.Text>
      </div>
    </>
  );
}
