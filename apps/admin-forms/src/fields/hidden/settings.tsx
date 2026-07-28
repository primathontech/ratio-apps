import { Divider, Input, Select, Typography } from '@primathonos/orion';
import { HIDDEN_SOURCES, type HiddenSource } from '@shared/schemas/fields/hidden/constants';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

type HiddenField = Extract<FormField, { type: 'hidden' }>;

/** Human labels for each capture source (§4). Keyed by the closed enum. */
const SOURCE_LABELS: Record<HiddenSource, string> = {
  url_param: 'URL query parameter',
  cookie: 'Cookie',
  referrer: 'Referrer URL',
  landing_url: 'Landing page URL',
  timestamp: 'Submission timestamp',
  constant: 'Fixed value',
};

export function HiddenSettings({
  field,
  dispatch,
}: {
  field: HiddenField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<HiddenField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });

  const source: HiddenSource = field.source ?? 'url_param';
  const usesParamName = source === 'url_param' || source === 'cookie';

  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Hidden capture</Divider>
      <SettingRow label="Value source">
        <Select
          aria-label="Value source"
          style={{ width: '100%' }}
          value={source}
          onChange={(value) => patch({ source: value as HiddenSource })}
          options={HIDDEN_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          Where this field&rsquo;s value is captured from. Never shown to the visitor.
        </Typography.Text>
      </SettingRow>

      {usesParamName && (
        <SettingRow label={source === 'cookie' ? 'Cookie name' : 'URL parameter name'}>
          <Input
            aria-label="Param name"
            placeholder={source === 'cookie' ? 'e.g. _ga' : 'e.g. utm_source'}
            value={field.paramName}
            onChange={(e) => patch({ paramName: e.target.value })}
          />
          <Typography.Text
            type="secondary"
            style={{ display: 'block', marginTop: 4, fontSize: 12 }}
          >
            {source === 'cookie'
              ? 'Read from the visitor&rsquo;s cookies on page load.'
              : 'Read from the page URL query string on page load.'}
          </Typography.Text>
        </SettingRow>
      )}

      {source === 'constant' && (
        <SettingRow label="Fixed value">
          <Input
            aria-label="Constant value"
            placeholder="e.g. landing-page-a"
            maxLength={2048}
            value={field.constantValue ?? ''}
            onChange={(e) => patch({ constantValue: e.target.value || undefined })}
          />
        </SettingRow>
      )}

      <SettingRow label="Default value" style={{ marginTop: 8 }}>
        <Input
          aria-label="Default value"
          placeholder="Used when nothing is captured"
          maxLength={2048}
          value={field.fallback ?? ''}
          onChange={(e) => patch({ fallback: e.target.value || undefined })}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          Used when the source is empty, so a required field isn't blocked.
        </Typography.Text>
      </SettingRow>
    </>
  );
}
