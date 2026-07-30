import { Checkbox, Divider, Input, Space, Switch, Typography } from '@primathonos/orion';
import {
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  FORM_FILE_MAX_FILES,
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
  // `maxFiles` lives on the field itself (not `validation`). ABSENT ⇒ 1 =
  // single-file; 2..FORM_FILE_MAX_FILES opt the SDK dropzone into `<input
  // multiple>` and cap the count — the same key `renderFile` reads.
  const maxFiles = field.maxFiles ?? 1;
  const multiple = maxFiles > 1;
  const setMaxFiles = (n: number) =>
    dispatch({ type: 'updateField', key: field.key, patch: { maxFiles: n } });
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
      <Divider style={{ margin: '4px 0' }}>Multiple files</Divider>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch
          aria-label="Allow multiple files"
          checked={multiple}
          // OFF ⇒ single-file (maxFiles 1, the pre-multi default); ON ⇒ open the
          // dropzone at 2, the smallest count above the single-file line.
          onChange={(checked) => setMaxFiles(checked ? 2 : 1)}
        />
        <Typography.Text>Allow multiple files</Typography.Text>
      </div>
      {multiple && (
        <SettingRow label={`How many files (2–${FORM_FILE_MAX_FILES})`} style={{ marginTop: 8 }}>
          <Input
            aria-label="Max files"
            type="number"
            min={2}
            max={FORM_FILE_MAX_FILES}
            value={maxFiles}
            onChange={(e) => {
              const parsed = parseIntOr(e.target.value);
              if (parsed === undefined) return;
              setMaxFiles(Math.min(FORM_FILE_MAX_FILES, Math.max(2, parsed)));
            }}
          />
        </SettingRow>
      )}
    </>
  );
}
