import { Divider, Input, Select, Switch, Typography } from '@primathonos/orion';
import {
  FORM_NUMBER_CURRENCIES,
  FORM_NUMBER_LOCALES,
  FORM_NUMBER_MAX_DECIMALS,
  FORM_NUMBER_STYLES,
  type FormField,
  type FormNumberFormat,
} from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { parseFloatOr, parseIntOr, SettingRow, SettingRowGroup } from '../_shared/controls';

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Defaults mirror the Zod `numberFormatSchema` defaults so the panel and the
 * stored value never drift when a merchant first enables formatting. */
const DEFAULT_FORMAT: FormNumberFormat = {
  style: 'decimal',
  currency: 'INR',
  locale: 'en-IN',
  grouping: true,
};

/** Live preview of the current formatting config against a sample number,
 * rendered with the exact `Intl` call the SDK uses. */
function previewNumber(format: FormNumberFormat): string {
  const sample = 1234.5;
  try {
    const opts: Intl.NumberFormatOptions = { useGrouping: format.grouping };
    if (format.style === 'currency') {
      opts.style = 'currency';
      opts.currency = format.currency;
    } else if (format.style === 'percent') {
      opts.style = 'percent';
    } else {
      opts.style = 'decimal';
    }
    if (format.decimalPlaces !== undefined) {
      opts.minimumFractionDigits = format.decimalPlaces;
      opts.maximumFractionDigits = format.decimalPlaces;
    }
    const value = format.style === 'percent' ? sample / 100 : sample;
    return new Intl.NumberFormat(format.locale, opts).format(value);
  } catch {
    return String(sample);
  }
}

export function NumberValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'number' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? { integer: false };
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });

  const format = field.format;
  const setFormat = (f: FormNumberFormat | undefined) =>
    dispatch({ type: 'updateField', key: field.key, patch: { format: f } });
  const patchFormat = (p: Partial<FormNumberFormat>) =>
    setFormat({ ...DEFAULT_FORMAT, ...format, ...p });

  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <SettingRowGroup>
        <SettingRow label="Min" style={{ flex: 1 }}>
          <Input
            aria-label="Min"
            type="number"
            value={validation.min ?? ''}
            onChange={(e) => set({ ...validation, min: parseFloatOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Max" style={{ flex: 1 }}>
          <Input
            aria-label="Max"
            type="number"
            value={validation.max ?? ''}
            onChange={(e) => set({ ...validation, max: parseFloatOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Step" style={{ flex: 1 }}>
          <Input
            aria-label="Step"
            type="number"
            min={0}
            value={validation.step ?? ''}
            onChange={(e) => set({ ...validation, step: parseFloatOr(e.target.value) })}
          />
        </SettingRow>
      </SettingRowGroup>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch
          aria-label="Integer only"
          checked={validation.integer}
          onChange={(checked) => set({ ...validation, integer: checked })}
        />
        <Typography.Text>Integer only</Typography.Text>
      </div>

      <Divider style={{ margin: '4px 0' }}>Display formatting</Divider>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Switch
          aria-label="Format the displayed value"
          checked={format !== undefined}
          onChange={(checked) => setFormat(checked ? DEFAULT_FORMAT : undefined)}
        />
        <Typography.Text>Format the displayed value</Typography.Text>
      </div>
      {format !== undefined && (
        <>
          <SettingRowGroup>
            <SettingRow label="Style" style={{ flex: 1 }}>
              <Select
                aria-label="Number style"
                style={{ width: '100%' }}
                value={format.style}
                onChange={(value) => patchFormat({ style: value as FormNumberFormat['style'] })}
                options={FORM_NUMBER_STYLES.map((s) => ({ value: s, label: titleCase(s) }))}
              />
            </SettingRow>
            <SettingRow label="Locale" style={{ flex: 1 }}>
              <Select
                aria-label="Number locale"
                style={{ width: '100%' }}
                value={format.locale}
                onChange={(value) => patchFormat({ locale: value as FormNumberFormat['locale'] })}
                options={FORM_NUMBER_LOCALES.map((l) => ({ value: l, label: l }))}
              />
            </SettingRow>
          </SettingRowGroup>
          {format.style === 'currency' && (
            <SettingRow label="Currency" style={{ marginTop: 8 }}>
              <Select
                aria-label="Currency"
                style={{ width: '100%' }}
                value={format.currency}
                onChange={(value) =>
                  patchFormat({ currency: value as FormNumberFormat['currency'] })
                }
                options={FORM_NUMBER_CURRENCIES.map((c) => ({ value: c, label: c }))}
              />
            </SettingRow>
          )}
          <SettingRow label="Decimal places" style={{ marginTop: 8 }}>
            <Input
              aria-label="Decimal places"
              type="number"
              min={0}
              max={FORM_NUMBER_MAX_DECIMALS}
              placeholder="Auto"
              value={format.decimalPlaces ?? ''}
              onChange={(e) => {
                const parsed = parseIntOr(e.target.value);
                patchFormat({
                  decimalPlaces:
                    parsed === undefined
                      ? undefined
                      : Math.max(0, Math.min(parsed, FORM_NUMBER_MAX_DECIMALS)),
                });
              }}
            />
          </SettingRow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Switch
              aria-label="Group thousands"
              checked={format.grouping}
              onChange={(checked) => patchFormat({ grouping: checked })}
            />
            <Typography.Text>Group thousands</Typography.Text>
          </div>
          <Typography.Text
            type="secondary"
            style={{ display: 'block', marginTop: 8, fontSize: 12 }}
          >
            Preview: {previewNumber(format)} — the stored value stays a plain number.
          </Typography.Text>
        </>
      )}
    </>
  );
}
