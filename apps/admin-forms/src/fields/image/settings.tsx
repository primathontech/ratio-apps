import { Divider, Input, Segmented } from '@primathonos/orion';
import { FORM_BLOCK_ALIGNMENTS, type FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

/** Capitalize an enum literal for a Segmented label (left → Left). */
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

// Size is optional (absent ⇒ today's full width), so 'full' stands in for the
// unset state in the Segmented and maps back to `undefined` on change.
const SIZE_OPTIONS = [
  { value: 'full', label: 'Full' },
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
];

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
      <SettingRow label="Alignment">
        <Segmented
          aria-label="Image alignment"
          value={field.align}
          onChange={(value) =>
            patch({ align: value as Extract<FormField, { type: 'image' }>['align'] })
          }
          options={FORM_BLOCK_ALIGNMENTS.map((a) => ({ value: a, label: cap(a) }))}
        />
      </SettingRow>
      <SettingRow label="Size">
        <Segmented
          aria-label="Image size"
          value={field.size ?? 'full'}
          onChange={(value) =>
            patch({
              size:
                value === 'full'
                  ? undefined
                  : (value as Extract<FormField, { type: 'image' }>['size']),
            })
          }
          options={SIZE_OPTIONS}
        />
      </SettingRow>
      <SettingRow label="Caption">
        <Input
          aria-label="Image caption"
          placeholder="Shown under the image"
          value={field.caption ?? ''}
          onChange={(e) => patch({ caption: e.target.value ? e.target.value : undefined })}
        />
      </SettingRow>
      <SettingRow label="Link URL (https)">
        <Input
          aria-label="Image link URL"
          placeholder="https://example.com"
          value={field.linkUrl ?? ''}
          onChange={(e) => patch({ linkUrl: e.target.value ? e.target.value.trim() : undefined })}
        />
      </SettingRow>
    </>
  );
}
