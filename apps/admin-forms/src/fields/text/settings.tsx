import { Divider, Input, Select, Typography } from '@primathonos/orion';
import {
  FORM_AUTOCOMPLETE_TOKENS,
  FORM_TEXT_FORMATS,
  FORM_TEXT_HARD_MAX_LENGTH,
  FORM_TEXT_TRANSFORMS,
  type FormAutocompleteToken,
  type FormTextFormat,
  type FormTextTransform,
} from '@shared/schemas/fields/text/constants';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseIntOr, SettingRow, SettingRowGroup } from '../_shared/controls';

type TextField = Extract<FormField, { type: 'text' }>;
type TextValidation = NonNullable<TextField['validation']>;

/** Human labels for each format preset (§ format library). */
const FORMAT_LABELS: Record<FormTextFormat, string> = {
  none: 'None',
  letters: 'Letters only',
  alphanumeric: 'Letters & numbers',
  slug: 'Slug (lowercase-with-hyphens)',
  no_emoji: 'No emoji',
  pin: 'PIN code (6 digits)',
  pan: 'PAN',
  gstin: 'GSTIN',
  ifsc: 'IFSC code',
  custom: 'Custom pattern…',
};

const TRANSFORM_LABELS: Record<FormTextTransform, string> = {
  none: 'No change',
  trim: 'Trim spaces',
  trim_upper: 'Trim + UPPERCASE',
  trim_lower: 'Trim + lowercase',
  trim_title: 'Trim + Title Case',
};

const AUTOCOMPLETE_LABELS: Record<FormAutocompleteToken, string> = {
  off: 'Off (no autofill)',
  on: 'On',
  name: 'Full name',
  'given-name': 'First name',
  'additional-name': 'Middle name',
  'family-name': 'Last name',
  nickname: 'Nickname',
  'honorific-prefix': 'Title (Mr/Ms/Dr)',
  'honorific-suffix': 'Suffix (Jr/Sr)',
  username: 'Username',
  email: 'Email',
  organization: 'Company',
  'organization-title': 'Job title',
  'street-address': 'Street address',
  'address-line1': 'Address line 1',
  'address-line2': 'Address line 2',
  'address-level1': 'State / region',
  'address-level2': 'City',
  country: 'Country code',
  'country-name': 'Country name',
  'postal-code': 'Postal / PIN code',
  tel: 'Phone',
  'tel-national': 'Phone (national)',
  url: 'Website',
  bday: 'Birthday',
  sex: 'Gender',
  language: 'Language',
};

export function TextValidationSettings({
  field,
  dispatch,
}: {
  field: TextField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation: TextValidation = field.validation ?? {};
  const set = (v: TextValidation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  const format: FormTextFormat = validation.format ?? 'none';
  const showFormatMessage = format !== 'none';

  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <SettingRowGroup>
        <SettingRow label="Min length" style={{ flex: 1 }}>
          <Input
            aria-label="Min length"
            type="number"
            min={0}
            value={validation.minLength ?? ''}
            onChange={(e) => set({ ...validation, minLength: parseIntOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label={`Max length (≤ ${FORM_TEXT_HARD_MAX_LENGTH})`} style={{ flex: 1 }}>
          <Input
            aria-label="Max length"
            type="number"
            min={1}
            max={FORM_TEXT_HARD_MAX_LENGTH}
            value={validation.maxLength ?? ''}
            onChange={(e) => set({ ...validation, maxLength: parseIntOr(e.target.value) })}
          />
        </SettingRow>
      </SettingRowGroup>

      <SettingRow label="Format">
        <Select
          aria-label="Format"
          style={{ width: '100%' }}
          value={format}
          onChange={(value: FormTextFormat) =>
            set({ ...validation, format: value === 'none' ? undefined : value })
          }
          options={FORM_TEXT_FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f] }))}
        />
      </SettingRow>

      {format === 'custom' && (
        <SettingRow label="Pattern (regex)">
          <Input
            aria-label="Pattern"
            placeholder="e.g. ^[A-Z]{2}[0-9]{4}$"
            value={validation.pattern ?? ''}
            onChange={(e) =>
              set({ ...validation, pattern: e.target.value ? e.target.value : undefined })
            }
          />
        </SettingRow>
      )}

      {showFormatMessage && (
        <SettingRow label="Error message when the format doesn’t match">
          <Input
            aria-label="Format error message"
            maxLength={120}
            placeholder="Please enter a valid value."
            value={validation.patternMessage ?? ''}
            onChange={(e) => set({ ...validation, patternMessage: e.target.value || undefined })}
          />
        </SettingRow>
      )}

      <SettingRow label="Clean up input" style={{ marginTop: 8 }}>
        <Select
          aria-label="Clean up input"
          style={{ width: '100%' }}
          value={validation.transform ?? 'trim'}
          onChange={(value: FormTextTransform) => set({ ...validation, transform: value })}
          options={FORM_TEXT_TRANSFORMS.map((t) => ({ value: t, label: TRANSFORM_LABELS[t] }))}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          Applied on the server before validation — the stored value is always the cleaned one.
        </Typography.Text>
      </SettingRow>

      <SettingRow label="Autofill" style={{ marginTop: 8 }}>
        <Select
          aria-label="Autofill"
          style={{ width: '100%' }}
          allowClear
          placeholder="Let the browser decide"
          value={field.autocomplete}
          onChange={(value: FormAutocompleteToken | undefined) =>
            dispatch({
              type: 'updateField',
              key: field.key,
              patch: { autocomplete: value ?? undefined },
            })
          }
          options={FORM_AUTOCOMPLETE_TOKENS.map((t) => ({
            value: t,
            label: AUTOCOMPLETE_LABELS[t],
          }))}
        />
      </SettingRow>
    </>
  );
}
