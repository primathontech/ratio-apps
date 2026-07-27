import { Divider, Input, Typography } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

/** Length bound must match `htmlFieldSchema` (max 10000). */
const MAX_HTML_LENGTH = 10000;

export function HtmlBlockSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'html' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'html' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  const used = field.html.length;
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Custom HTML</Divider>
      <SettingRow label="HTML">
        <Input.TextArea
          aria-label="Custom HTML"
          rows={8}
          maxLength={MAX_HTML_LENGTH}
          style={{ fontFamily: 'monospace' }}
          value={field.html}
          onChange={(e) => patch({ html: e.target.value })}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          {used}/{MAX_HTML_LENGTH} — renders as-is in your form.
        </Typography.Text>
      </SettingRow>
    </>
  );
}
