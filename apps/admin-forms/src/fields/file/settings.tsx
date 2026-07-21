import { Checkbox, Divider, Input, Space } from '@primathonos/orion';
import {
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  type FormField,
} from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow } from '../_shared/controls';

export function FileValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'file' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? {
    allowedMimeTypes: [...FORM_FILE_ALLOWED_MIME_TYPES],
    maxBytes: FORM_FILE_MAX_BYTES,
  };
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>File constraints</Divider>
      <SettingRow label="Allowed types">
        <Space direction="vertical" size={4}>
          {FORM_FILE_ALLOWED_MIME_TYPES.map((mime) => (
            <Checkbox
              key={mime}
              checked={validation.allowedMimeTypes.includes(mime)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...validation.allowedMimeTypes, mime]
                  : validation.allowedMimeTypes.filter((m) => m !== mime);
                // At least one type must stay allowed (schema minimum).
                if (next.length === 0) return;
                set({ ...validation, allowedMimeTypes: next });
              }}
            >
              {mime}
            </Checkbox>
          ))}
        </Space>
      </SettingRow>
      <SettingRow label="Max size (bytes, ≤ 5 MB)">
        <Input
          aria-label="Max bytes"
          type="number"
          min={1}
          max={FORM_FILE_MAX_BYTES}
          value={validation.maxBytes}
          onChange={(e) => {
            const parsed = parseIntOr(e.target.value);
            if (parsed === undefined) return;
            set({ ...validation, maxBytes: Math.min(parsed, FORM_FILE_MAX_BYTES) });
          }}
        />
      </SettingRow>
    </>
  );
}
