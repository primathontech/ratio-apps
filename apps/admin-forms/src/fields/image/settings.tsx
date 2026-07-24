import { Divider, Input } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

export function ImageBlockSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'image' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'image' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Image</Divider>
      <SettingRow label="Image URL (https)">
        <Input
          aria-label="Image URL"
          placeholder="https://cdn.example.com/image.png"
          value={field.url}
          onChange={(e) => patch({ url: e.target.value.trim() })}
        />
      </SettingRow>
      <SettingRow label="Alt text">
        <Input
          aria-label="Image alt text"
          placeholder="Describes the image for screen readers"
          value={field.alt ?? ''}
          onChange={(e) => patch({ alt: e.target.value ? e.target.value : undefined })}
        />
      </SettingRow>
    </>
  );
}
