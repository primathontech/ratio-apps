import { Divider, MultiSelect, SearchableSelect, Typography } from '@primathonos/orion';
import {
  PHONE_COUNTRY_CODES,
  PHONE_COUNTRY_META,
  type PhoneCountryCode,
} from '@shared/schemas/fields/phone/constants';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { SettingRow } from '../_shared/controls';

type PhoneField = Extract<FormField, { type: 'phone' }>;

const countryOption = (code: string) => {
  const meta = PHONE_COUNTRY_META[code as keyof typeof PHONE_COUNTRY_META];
  return { value: code, label: `${meta.flag} ${meta.name} (${meta.dial})` };
};

const ALL_OPTIONS = PHONE_COUNTRY_CODES.map(countryOption);

export function PhoneSettings({
  field,
  dispatch,
}: {
  field: PhoneField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const countries = field.countries ?? {};
  const allowed = countries.allowed;
  const defaultCode = countries.default;

  const setCountries = (next: PhoneField['countries']) =>
    dispatch({ type: 'updateField', key: field.key, patch: { countries: next } });

  const onAllowedChange = (vals: unknown) => {
    const list = (vals as PhoneCountryCode[]).filter(Boolean);
    const newAllowed = list.length > 0 ? list : undefined;
    // Keep the default only while it remains in the allow-list; otherwise fall
    // back to the first allowed country so the schema refine stays satisfied.
    let newDefault = defaultCode;
    if (newAllowed && newDefault && !newAllowed.includes(newDefault)) newDefault = newAllowed[0];
    setCountries(
      newAllowed || newDefault ? { allowed: newAllowed, default: newDefault } : undefined,
    );
  };

  const onDefaultChange = (val: unknown) => {
    const next = (val as PhoneCountryCode) || undefined;
    setCountries(allowed || next ? { allowed, default: next } : undefined);
  };

  // The default selector is constrained to the allow-list when one is set.
  const defaultOptions = allowed && allowed.length > 0 ? allowed.map(countryOption) : ALL_OPTIONS;

  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Countries</Divider>
      <SettingRow label="Allowed countries">
        <MultiSelect
          aria-label="Allowed countries"
          placeholder="India only (default)"
          value={allowed ?? []}
          onChange={onAllowedChange}
          options={ALL_OPTIONS}
          style={{ width: '100%' }}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
          Leave empty to accept Indian numbers only (+91). Add two or more to show a dial-code
          picker.
        </Typography.Text>
      </SettingRow>
      <SettingRow label="Default country" style={{ marginTop: 8 }}>
        <SearchableSelect
          aria-label="Default country"
          placeholder="India (+91)"
          value={defaultCode}
          onChange={onDefaultChange}
          options={defaultOptions}
          style={{ width: '100%' }}
          allowClear
        />
      </SettingRow>
    </>
  );
}
