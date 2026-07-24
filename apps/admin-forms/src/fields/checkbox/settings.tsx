import { Divider, Input } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

export function CheckboxConsentSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'checkbox' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'checkbox' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Consent link</Divider>
      <SettingRow label="Link text">
        <Input
          aria-label="Link text"
          placeholder="e.g. Privacy policy"
          value={field.linkText ?? ''}
          onChange={(e) => patch({ linkText: e.target.value ? e.target.value : undefined })}
        />
      </SettingRow>
      <SettingRow label="Link URL (https)">
        <Input
          aria-label="Link URL"
          placeholder="https://example.com/privacy"
          value={field.linkUrl ?? ''}
          onChange={(e) => patch({ linkUrl: e.target.value ? e.target.value : undefined })}
        />
      </SettingRow>
    </>
  );
}
