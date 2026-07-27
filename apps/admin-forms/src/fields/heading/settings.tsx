import { Divider, Input, Segmented } from '@primathonos/orion';
import {
  FORM_BLOCK_ALIGNMENTS,
  FORM_HEADING_LEVELS,
  FORM_HEADING_SIZES,
  type FormField,
} from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

/** Capitalize an enum literal for a Segmented label (left → Left). */
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

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
      <SettingRow label="Eyebrow">
        <Input
          aria-label="Heading eyebrow"
          placeholder="Small kicker line above the heading"
          value={field.eyebrow ?? ''}
          onChange={(e) => patch({ eyebrow: e.target.value ? e.target.value : undefined })}
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
      <SettingRow label="Size">
        <Segmented
          aria-label="Heading size"
          value={field.size}
          onChange={(value) =>
            patch({ size: value as Extract<FormField, { type: 'heading' }>['size'] })
          }
          options={FORM_HEADING_SIZES.map((s) => ({ value: s, label: s.toUpperCase() }))}
        />
      </SettingRow>
      <SettingRow label="Alignment">
        <Segmented
          aria-label="Heading alignment"
          value={field.align}
          onChange={(value) =>
            patch({ align: value as Extract<FormField, { type: 'heading' }>['align'] })
          }
          options={FORM_BLOCK_ALIGNMENTS.map((a) => ({ value: a, label: cap(a) }))}
        />
      </SettingRow>
    </>
  );
}
