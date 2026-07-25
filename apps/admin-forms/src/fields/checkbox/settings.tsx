import { Button, Divider, Input, Space, Typography } from '@primathonos/orion';
import {
  CONSENT_LINK_TEXT_MAX_LENGTH,
  CONSENT_MAX_LINKS,
  CONSENT_TEXT_MAX_LENGTH,
} from '@shared/schemas/fields/checkbox/constants';
import type { ConsentLink } from '@shared/schemas/fields/checkbox/schema';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

type CheckboxField = Extract<FormField, { type: 'checkbox' }>;

export function CheckboxConsentSettings({
  field,
  dispatch,
}: {
  field: CheckboxField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<CheckboxField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });

  const links: ConsentLink[] = field.links ?? [];
  const setLinks = (next: ConsentLink[]) => patch({ links: next.length ? next : undefined });
  const atMax = links.length >= CONSENT_MAX_LINKS;

  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Consent</Divider>
      <SettingRow label="Consent text">
        <Input.TextArea
          aria-label="Consent text"
          rows={3}
          maxLength={CONSENT_TEXT_MAX_LENGTH}
          placeholder="I agree to the {link} and the {link2}."
          value={field.consentText ?? ''}
          onChange={(e) => patch({ consentText: e.target.value || undefined })}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          Use {'{link}'}, {'{link2}'}, {'{link3}'} to place the links below inline in the sentence.
        </Typography.Text>
      </SettingRow>

      <Divider style={{ margin: '4px 0' }}>Policy links</Divider>
      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
        {links.map((link, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: links are editable rows, index is the identity
          <div key={index} style={{ display: 'flex', gap: 4 }}>
            <Input
              aria-label={`Link ${index + 1} text`}
              maxLength={CONSENT_LINK_TEXT_MAX_LENGTH}
              placeholder="Privacy policy"
              value={link.text}
              onChange={(e) => {
                const next = [...links];
                const current = next[index];
                if (current === undefined) return;
                next[index] = { ...current, text: e.target.value };
                setLinks(next);
              }}
            />
            <Input
              aria-label={`Link ${index + 1} URL`}
              placeholder="https://example.com/privacy"
              value={link.url}
              onChange={(e) => {
                const next = [...links];
                const current = next[index];
                if (current === undefined) return;
                next[index] = { ...current, url: e.target.value };
                setLinks(next);
              }}
            />
            <Button
              size="small"
              danger
              aria-label={`Remove link ${index + 1}`}
              onClick={() => setLinks(links.filter((_, i) => i !== index))}
            >
              ✕
            </Button>
          </div>
        ))}
        <Button
          size="small"
          disabled={atMax}
          title={atMax ? `At most ${CONSENT_MAX_LINKS} links` : undefined}
          onClick={() => {
            if (atMax) return;
            setLinks([...links, { text: '', url: '' }]);
          }}
        >
          Add link
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Referenced in order: {'{link}'} → first, {'{link2}'} → second, {'{link3}'} → third.
        </Typography.Text>
      </Space>
    </>
  );
}
