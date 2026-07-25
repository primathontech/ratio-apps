import { Divider, Input, Segmented, Switch, Typography } from '@primathonos/orion';
import {
  EMAIL_MAX_DOMAIN_LIST,
  EMAIL_MAX_LENGTH_CEILING,
  EMAIL_MAX_LENGTH_DEFAULT,
} from '@shared/schemas/fields/email/constants';
import type { FormField } from '@shared/schemas/form-schema';
import { type Dispatch, useEffect, useState } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow } from '../_shared/controls';

type EmailField = Extract<FormField, { type: 'email' }>;
type EmailValidation = NonNullable<EmailField['validation']>;
type DomainMode = 'none' | 'allow' | 'block';

/** Split a free-text domain list on newlines/commas, dedupe, lowercase, cap. */
function parseDomains(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,]/)) {
    const d = raw.trim().toLowerCase();
    if (d) seen.add(d);
  }
  return Array.from(seen).slice(0, EMAIL_MAX_DOMAIN_LIST);
}

/** The mode a stored validation object implies (populated list wins). */
function derivedMode(v: EmailValidation | undefined): DomainMode {
  if (v?.allowedDomains && v.allowedDomains.length > 0) return 'allow';
  if (v?.blockedDomains && v.blockedDomains.length > 0) return 'block';
  return 'none';
}

export function EmailValidationSettings({
  field,
  dispatch,
}: {
  field: EmailField;
  dispatch: Dispatch<BuilderAction>;
}) {
  // Seed unset fields with the schema defaults so a first edit writes a
  // complete, valid object (maxLength defaults to 254 server-side anyway).
  const validation: EmailValidation = field.validation ?? {
    maxLength: EMAIL_MAX_LENGTH_DEFAULT,
    suggestCorrections: true,
    blockFreeProviders: false,
  };
  const set = (v: EmailValidation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });

  // The domain mode is a UI-only choice: 'allow'/'block' with an empty list is
  // a valid intermediate state the stored object can't express, so it lives in
  // local state (reset when a different field is selected).
  const [mode, setMode] = useState<DomainMode>(() => derivedMode(field.validation));
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only when the selected field changes, not on every keystroke.
  useEffect(() => {
    setMode(derivedMode(field.validation));
  }, [field.key]);

  const domainText = (
    mode === 'allow' ? validation.allowedDomains : mode === 'block' ? validation.blockedDomains : []
  )?.join('\n');

  const changeMode = (next: DomainMode) => {
    setMode(next);
    // Mutually exclusive: clear both lists on any mode switch.
    const { allowedDomains: _a, blockedDomains: _b, ...rest } = validation;
    set(rest);
  };

  const setDomains = (text: string) => {
    const list = parseDomains(text);
    const { allowedDomains: _a, blockedDomains: _b, ...rest } = validation;
    if (mode === 'allow') set({ ...rest, allowedDomains: list });
    else if (mode === 'block') set({ ...rest, blockedDomains: list });
    else set(rest);
  };

  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>

      <SettingRow label={`Max length (≤ ${EMAIL_MAX_LENGTH_CEILING})`}>
        <Input
          aria-label="Max length"
          type="number"
          min={1}
          max={EMAIL_MAX_LENGTH_CEILING}
          value={validation.maxLength ?? ''}
          placeholder={String(EMAIL_MAX_LENGTH_DEFAULT)}
          onChange={(e) =>
            set({
              ...validation,
              maxLength: parseIntOr(e.target.value) ?? EMAIL_MAX_LENGTH_DEFAULT,
            })
          }
        />
      </SettingRow>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Switch
          aria-label="Suggest corrections"
          checked={validation.suggestCorrections !== false}
          onChange={(checked) => set({ ...validation, suggestCorrections: checked })}
        />
        <Typography.Text>Suggest corrections for likely typos</Typography.Text>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Switch
          aria-label="Only business emails"
          checked={validation.blockFreeProviders === true}
          onChange={(checked) => set({ ...validation, blockFreeProviders: checked })}
        />
        <Typography.Text>Only business emails (block free providers)</Typography.Text>
      </div>

      <SettingRow label="Domain restriction" style={{ marginTop: 8 }}>
        <Segmented
          aria-label="Domain restriction"
          value={mode}
          onChange={(value) => changeMode(value as DomainMode)}
          options={[
            { value: 'none', label: 'None' },
            { value: 'allow', label: 'Allow list' },
            { value: 'block', label: 'Block list' },
          ]}
        />
      </SettingRow>

      {mode !== 'none' && (
        <SettingRow
          label={mode === 'allow' ? 'Allowed domains' : 'Blocked domains'}
          style={{ marginTop: 8 }}
        >
          <Input.TextArea
            aria-label={mode === 'allow' ? 'Allowed domains' : 'Blocked domains'}
            rows={3}
            placeholder={'example.com\nacme.co.in'}
            value={domainText}
            onChange={(e) => setDomains(e.target.value)}
          />
          <Typography.Text
            type="secondary"
            style={{ display: 'block', marginTop: 4, fontSize: 12 }}
          >
            One bare domain per line (or comma-separated). Sub-domains match too. Up to{' '}
            {EMAIL_MAX_DOMAIN_LIST}.
          </Typography.Text>
        </SettingRow>
      )}
    </>
  );
}
