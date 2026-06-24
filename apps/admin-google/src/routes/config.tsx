import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  PrimaryButton,
  Select,
  Space,
  Typography,
} from '@primathonos/orion';
import type {
  GoogleConfig,
  GoogleConfigInput,
  GoogleDiscoverResponse,
} from '@shared/schemas/google-config';
import { googleConfigInputSchema } from '@shared/schemas/google-config';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';
import { useDefaults } from '@/hooks/useDefaults';
import { useDiscover } from '@/hooks/useDiscover';
import { disconnectGoogle, startGoogleConnect } from '@/lib/oauth';
import { type ValidateResult, validateAds, validateGa4, validateGmc } from '@/lib/validate';

// Zod separates input vs output types for schemas with `.default()`:
//   - z.input  → fields-with-default are OPTIONAL (what the user types)
//   - z.output → those fields are REQUIRED (what zod returns after parse)
// useForm needs the input shape so optional defaults don't trip the validator;
// the third type param tells RHF the post-parse output shape `handleSubmit` delivers.
type ConfigInput = z.input<typeof googleConfigInputSchema>;
type ConfigOutput = z.output<typeof googleConfigInputSchema>;

export const Route = createFileRoute('/config')({ component: ConfigPage });

// Map a saved config into the PUT input shape (omits the write-only
// `gmcServiceAccountKey` so an auto-save never clears a stored key). Used to
// build the auto-save payload when discovery detects an unambiguous ID.
function configToInput(c: GoogleConfig): GoogleConfigInput {
  return {
    connectionMethod: c.connectionMethod,
    ga4Enabled: c.ga4Enabled,
    ga4MeasurementId: c.ga4MeasurementId,
    adsEnabled: c.adsEnabled,
    adsConversionId: c.adsConversionId,
    adsConversionLabel: c.adsConversionLabel,
    enhancedConversionsEnabled: c.enhancedConversionsEnabled,
    gmcEnabled: c.gmcEnabled,
    gmcMerchantId: c.gmcMerchantId,
    gmcStoreUrl: c.gmcStoreUrl,
    gmcTargetCountry: c.gmcTargetCountry,
    gmcContentLanguage: c.gmcContentLanguage,
    gmcCurrency: c.gmcCurrency,
    gmcDefaultCondition: c.gmcDefaultCondition,
    gmcBrandOverride: c.gmcBrandOverride,
    gmcGoogleProductCategory: c.gmcGoogleProductCategory,
    gmcCategoryMode: c.gmcCategoryMode,
    autoSyncEnabled: c.autoSyncEnabled,
    hourlyReconcileEnabled: c.hourlyReconcileEnabled,
    syncVariantsEnabled: c.syncVariantsEnabled,
    includeOutOfStock: c.includeOutOfStock,
    freeListingsEnabled: c.freeListingsEnabled,
  };
}

// The optional/nullable string fields reject an empty string (their format
// regex / min(1) don't match ''), but the form's text inputs always emit ''
// when blank. Coerce those blanks to `null` ("leave unset") before validation
// so a partially-filled draft still saves — matching the schema's intent.
const NULLABLE_STRING_FIELDS = [
  'ga4MeasurementId',
  'adsConversionId',
  'adsConversionLabel',
  'gmcMerchantId',
  'gmcStoreUrl',
  'gmcBrandOverride',
  'gmcGoogleProductCategory',
] as const;

const baseResolver = zodResolver(googleConfigInputSchema);
const resolver: typeof baseResolver = (values, context, options) => {
  const normalized = { ...(values as Record<string, unknown>) };
  for (const key of NULLABLE_STRING_FIELDS) {
    if (normalized[key] === '') normalized[key] = null;
  }
  return baseResolver(normalized as typeof values, context, options);
};

const CONDITION_FALLBACK = ['new', 'refurbished', 'used'];
const CATEGORY_MODES = [
  { value: 'auto', label: 'Auto (infer per product)' },
  { value: 'default', label: 'Use one default category' },
  { value: 'per_type', label: 'Per product type' },
];

export function ConfigPage() {
  const { data, isLoading, refetch } = useConfig();
  const update = useUpdateConfig();
  const defaults = useDefaults();
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect(): Promise<void> {
    setDisconnecting(true);
    try {
      await disconnectGoogle();
      await refetch(); // flip the UI to the not-connected (manual) state
    } finally {
      setDisconnecting(false);
    }
  }

  // `justConnected` drives the post-connect discovery hints. It starts true if
  // we arrived via the legacy redirect (?connected=1), and is set when the
  // popup connect flow signals success (no navigation — see handleConnect).
  const [justConnected, setJustConnected] = useState(
    () => new URLSearchParams(window.location.search).get('connected') === '1',
  );
  const [connecting, setConnecting] = useState(false);

  async function handleConnect(): Promise<void> {
    setConnecting(true);
    try {
      const connected = await startGoogleConnect();
      if (connected) {
        setJustConnected(true);
        await refetch(); // flip the UI to connected + auto-fill discovered IDs
      }
    } finally {
      setConnecting(false);
    }
  }
  const discover = useDiscover(justConnected);

  const form = useForm<ConfigInput, unknown, ConfigOutput>({
    resolver,
    defaultValues: {
      connectionMethod: 'manual',
      ga4Enabled: false,
      ga4MeasurementId: '',
      adsEnabled: false,
      adsConversionId: '',
      adsConversionLabel: '',
      enhancedConversionsEnabled: true,
      gmcEnabled: false,
      gmcMerchantId: '',
      gmcStoreUrl: '',
      gmcServiceAccountKey: '',
      gmcTargetCountry: 'IN',
      gmcContentLanguage: 'en',
      gmcCurrency: 'INR',
      gmcDefaultCondition: 'new',
      gmcBrandOverride: '',
      gmcCategoryMode: 'default',
      autoSyncEnabled: true,
      hourlyReconcileEnabled: true,
      syncVariantsEnabled: true,
      includeOutOfStock: true,
      freeListingsEnabled: true,
    },
  });

  useEffect(() => {
    if (!data) return;
    // The service never returns the GMC key — leave the textarea empty so we
    // never display (or accidentally resubmit) a stored secret.
    form.reset({
      connectionMethod: data.connectionMethod,
      ga4Enabled: data.ga4Enabled,
      ga4MeasurementId: data.ga4MeasurementId ?? '',
      adsEnabled: data.adsEnabled,
      adsConversionId: data.adsConversionId ?? '',
      adsConversionLabel: data.adsConversionLabel ?? '',
      enhancedConversionsEnabled: data.enhancedConversionsEnabled,
      gmcEnabled: data.gmcEnabled,
      gmcMerchantId: data.gmcMerchantId ?? '',
      gmcStoreUrl: data.gmcStoreUrl ?? '',
      gmcServiceAccountKey: '',
      gmcTargetCountry: data.gmcTargetCountry,
      gmcContentLanguage: data.gmcContentLanguage,
      gmcCurrency: data.gmcCurrency,
      gmcDefaultCondition: data.gmcDefaultCondition,
      gmcBrandOverride: data.gmcBrandOverride ?? '',
      gmcGoogleProductCategory: data.gmcGoogleProductCategory ?? '',
      gmcCategoryMode: data.gmcCategoryMode,
      autoSyncEnabled: data.autoSyncEnabled,
      hourlyReconcileEnabled: data.hourlyReconcileEnabled,
      syncVariantsEnabled: data.syncVariantsEnabled,
      includeOutOfStock: data.includeOutOfStock,
      freeListingsEnabled: data.freeListingsEnabled,
    });
  }, [data, form]);

  // After returning from OAuth connect (?connected=1), discovery may surface
  // exactly one GA4 stream / GMC account. Pre-fill those empty fields AND persist
  // them (so the merchant doesn't have to click Save). Single, unambiguous matches
  // into empty fields only — multiple candidates use the picker below, and a value
  // already saved is never overwritten. Runs once per connect (autoSavedRef).
  const autoSavedRef = useRef(false);
  useEffect(() => {
    const d = discover.data;
    if (!d || !data || autoSavedRef.current) return;
    const [ga4Stream] = d.ga4.streams;
    const [gmcAccount] = d.gmc.accounts;
    const ga4Pick =
      d.ga4.streams.length === 1 && ga4Stream && !data.ga4MeasurementId
        ? ga4Stream.measurementId
        : undefined;
    const gmcPick =
      d.gmc.accounts.length === 1 && gmcAccount && !data.gmcMerchantId
        ? gmcAccount.merchantId
        : undefined;
    if (!ga4Pick && !gmcPick) return;
    if (ga4Pick) form.setValue('ga4MeasurementId', ga4Pick, { shouldDirty: true });
    if (gmcPick) form.setValue('gmcMerchantId', gmcPick, { shouldDirty: true });
    autoSavedRef.current = true;
    update.mutate({
      ...configToInput(data),
      ...(ga4Pick ? { ga4MeasurementId: ga4Pick } : {}),
      ...(gmcPick ? { gmcMerchantId: gmcPick } : {}),
    });
  }, [discover.data, data, form, update]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const onSubmit = form.handleSubmit(
    (values) => {
      // Write-only secret: omit the key entirely when the textarea is empty so
      // an empty save never clears the stored key. Only send a user-typed key.
      const payload = { ...values };
      if (!payload.gmcServiceAccountKey) {
        delete payload.gmcServiceAccountKey;
      }
      update.mutate(payload);
    },
    (errors) => {
      // eslint-disable-next-line no-console
      console.warn('Google config form validation failed:', errors);
      form.setError('root', {
        type: 'validation',
        message: 'Form has invalid fields — check the highlighted inputs.',
      });
    },
  );

  const conditionOptions = (defaults.data?.conditions ?? CONDITION_FALLBACK).map((c) => ({
    value: c,
    label: c,
  }));
  const countryOptions = (defaults.data?.targetCountries ?? ['IN']).map((c) => ({
    value: c,
    label: c,
  }));
  const languageOptions = (defaults.data?.languages ?? ['en']).map((c) => ({
    value: c,
    label: c,
  }));
  const currencyOptions = (defaults.data?.currencies ?? ['INR']).map((c) => ({
    value: c,
    label: c,
  }));

  return (
    <FormProvider {...form}>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Card title="Connect Google Account">
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            {data?.googleAccountEmail ? (
              <>
                <Typography.Text>
                  Connected as <Typography.Text strong>{data.googleAccountEmail}</Typography.Text>
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  GA4 Analytics and Merchant Center are filled automatically from this connection.
                </Typography.Text>
              </>
            ) : (
              <Typography.Text type="secondary">
                Not connected. Connecting links GA4, Google Ads, and Merchant Center in one step —
                and{' '}
                <Typography.Text strong>
                  auto-fills your GA4 Measurement ID and Merchant Center ID
                </Typography.Text>{' '}
                below. No service-account key needed.
              </Typography.Text>
            )}
            <Space>
              <PrimaryButton loading={connecting} onClick={() => void handleConnect()}>
                {data?.googleAccountEmail ? 'Reconnect Google Account' : 'Connect Google Account'}
              </PrimaryButton>
              {data?.googleAccountEmail && (
                <Button danger loading={disconnecting} onClick={() => void handleDisconnect()}>
                  Disconnect
                </Button>
              )}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Prefer manual setup? Configure each integration below — it's the fallback when OAuth
              isn't available.
            </Typography.Text>
          </Space>
        </Card>

        <form onSubmit={onSubmit}>
          <Space direction="vertical" size="large" style={{ display: 'flex' }}>
            <Ga4Section form={form} discovery={justConnected ? discover.data?.ga4 : undefined} />
            <AdsSection form={form} />
            <GmcSection
              form={form}
              hasGmcKey={!!data?.hasGmcKey}
              discovery={justConnected ? discover.data?.gmc : undefined}
              isOAuth={data?.connectionMethod === 'oauth'}
            />
            <GmcSettingsSection
              form={form}
              countryOptions={countryOptions}
              languageOptions={languageOptions}
              currencyOptions={currencyOptions}
              conditionOptions={conditionOptions}
            />

            {form.formState.errors.root && (
              <Alert type="warning" message={form.formState.errors.root.message} showIcon />
            )}
            {update.error && (
              <Alert type="error" message={(update.error as Error).message} showIcon />
            )}
            {update.isSuccess && <Alert type="success" message="Saved." showIcon />}

            <div style={{ textAlign: 'right' }}>
              <PrimaryButton htmlType="submit" loading={update.isPending}>
                Save configuration
              </PrimaryButton>
            </div>
          </Space>
        </form>
      </Space>
    </FormProvider>
  );
}

type FormType = ReturnType<typeof useForm<ConfigInput, unknown, ConfigOutput>>;

function ValidateButton({
  onValidate,
  children,
}: {
  onValidate: () => Promise<ValidateResult>;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<{ loading: boolean; result?: ValidateResult }>({
    loading: false,
  });
  return (
    <Space direction="vertical" size={4} style={{ display: 'flex' }}>
      <Button
        loading={state.loading}
        onClick={async () => {
          setState({ loading: true });
          try {
            const result = await onValidate();
            setState({ loading: false, result });
          } catch (err) {
            setState({ loading: false, result: { ok: false, error: (err as Error).message } });
          }
        }}
      >
        {children}
      </Button>
      {state.result?.ok && <Alert type="success" message="Valid ✓" showIcon />}
      {state.result && !state.result.ok && (
        <Alert type="error" message={state.result.error ?? 'Validation failed'} showIcon />
      )}
    </Space>
  );
}

function Ga4Section({
  form,
  discovery,
}: {
  form: FormType;
  discovery: GoogleDiscoverResponse['ga4'] | undefined;
}) {
  const candidates = discovery?.streams ?? [];
  return (
    <Card title="Google Analytics 4">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <Controller
          control={form.control}
          name="ga4Enabled"
          render={({ field }) => (
            <Checkbox
              checked={field.value ?? false}
              onChange={(e) => field.onChange(e.target.checked)}
            >
              Enable GA4
            </Checkbox>
          )}
        />
        {discovery?.error && (
          <Alert
            type="warning"
            showIcon
            message={`Couldn't read GA4 from Google: ${discovery.error}`}
          />
        )}
        {discovery && !discovery.error && candidates.length === 0 && (
          <Alert
            type="info"
            showIcon
            message="No GA4 property found on this Google account — enter the Measurement ID manually below."
          />
        )}
        {candidates.length > 1 && (
          <FieldRow label="Detected GA4 properties">
            <Select
              placeholder="Pick a Measurement ID"
              style={{ width: '100%', maxWidth: 320 }}
              options={candidates.map((s) => ({
                value: s.measurementId,
                label: `${s.displayName ?? s.property ?? 'Property'} — ${s.measurementId}`,
              }))}
              onChange={(v) => form.setValue('ga4MeasurementId', v, { shouldDirty: true })}
            />
          </FieldRow>
        )}
        <FieldRow label="Measurement ID" error={form.formState.errors.ga4MeasurementId?.message}>
          <Controller
            control={form.control}
            name="ga4MeasurementId"
            render={({ field, fieldState }) => (
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="G-XXXXXXXXXX"
                {...(fieldState.invalid ? { status: 'error' as const } : {})}
              />
            )}
          />
        </FieldRow>
        <ValidateButton onValidate={() => validateGa4(form.getValues('ga4MeasurementId') ?? '')}>
          Validate
        </ValidateButton>
      </Space>
    </Card>
  );
}

function AdsSection({ form }: { form: FormType }) {
  return (
    <Card title="Google Ads">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <Controller
          control={form.control}
          name="adsEnabled"
          render={({ field }) => (
            <Checkbox
              checked={field.value ?? false}
              onChange={(e) => field.onChange(e.target.checked)}
            >
              Enable Google Ads conversions
            </Checkbox>
          )}
        />
        <FieldRow label="Conversion ID" error={form.formState.errors.adsConversionId?.message}>
          <Controller
            control={form.control}
            name="adsConversionId"
            render={({ field, fieldState }) => (
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="AW-123456789"
                {...(fieldState.invalid ? { status: 'error' as const } : {})}
              />
            )}
          />
        </FieldRow>
        <FieldRow
          label="Conversion Label"
          error={form.formState.errors.adsConversionLabel?.message}
        >
          <Controller
            control={form.control}
            name="adsConversionLabel"
            render={({ field, fieldState }) => (
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="abcDEF123"
                {...(fieldState.invalid ? { status: 'error' as const } : {})}
              />
            )}
          />
        </FieldRow>
        <ValidateButton
          onValidate={() =>
            validateAds(
              form.getValues('adsConversionId') ?? '',
              form.getValues('adsConversionLabel') ?? '',
            )
          }
        >
          Validate
        </ValidateButton>
      </Space>
    </Card>
  );
}

function GmcSection({
  form,
  hasGmcKey,
  discovery,
  isOAuth,
}: {
  form: FormType;
  hasGmcKey: boolean;
  discovery: GoogleDiscoverResponse['gmc'] | undefined;
  isOAuth: boolean;
}) {
  const candidates = discovery?.accounts ?? [];
  // OAuth only authorizes Merchant Center when the connected Google account can
  // actually reach an MC account — represented by a resolved Merchant ID. When
  // OAuth is connected but no MC was found (no Merchant ID), fall back to the
  // service-account key path so the merchant can still connect a Merchant Center.
  const merchantId = form.watch('gmcMerchantId');
  const oauthGmcActive = isOAuth && !!merchantId;
  // When a key is already stored we never echo it back (it's a secret), so show
  // a clear "configured" state instead of an empty box that looks unset. The
  // textarea only appears when there's no key yet, or the user opts to replace.
  const [replacingKey, setReplacingKey] = useState(false);
  return (
    <Card title="Google Merchant Center">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <Controller
          control={form.control}
          name="gmcEnabled"
          render={({ field }) => (
            <Checkbox
              checked={field.value ?? false}
              onChange={(e) => field.onChange(e.target.checked)}
            >
              Enable Merchant Center product feed
            </Checkbox>
          )}
        />
        {discovery?.error && (
          <Alert
            type="warning"
            showIcon
            message={`Couldn't read Merchant Center from Google: ${discovery.error}`}
          />
        )}
        {discovery && !discovery.error && candidates.length === 0 && (
          <Alert
            type="info"
            showIcon
            message="No Merchant Center account found on this Google account — enter the Merchant ID manually, or create one at merchants.google.com."
          />
        )}
        {candidates.length > 1 && (
          <FieldRow label="Detected Merchant Center accounts">
            <Select
              placeholder="Pick a Merchant ID"
              style={{ width: '100%', maxWidth: 320 }}
              options={candidates.map((a) => ({ value: a.merchantId, label: a.merchantId }))}
              onChange={(v) => form.setValue('gmcMerchantId', v, { shouldDirty: true })}
            />
          </FieldRow>
        )}
        <FieldRow label="Merchant ID" error={form.formState.errors.gmcMerchantId?.message}>
          <Controller
            control={form.control}
            name="gmcMerchantId"
            render={({ field, fieldState }) => (
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="123456789"
                {...(fieldState.invalid ? { status: 'error' as const } : {})}
              />
            )}
          />
        </FieldRow>
        <FieldRow
          label="Store URL"
          error={form.formState.errors.gmcStoreUrl?.message}
          hint="Your verified storefront domain. Product links must use this domain or Google reports “Mismatched online store URL” and won't show your products."
        >
          <Controller
            control={form.control}
            name="gmcStoreUrl"
            render={({ field, fieldState }) => (
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="shop.yourstore.com"
                {...(fieldState.invalid ? { status: 'error' as const } : {})}
              />
            )}
          />
        </FieldRow>
        {oauthGmcActive ? (
          <Alert
            type="success"
            showIcon
            message="Authorized via your connected Google account"
            description="Merchant Center access uses your Google connection — no service-account key needed. The Merchant ID above was detected automatically."
          />
        ) : (
          <>
            <FieldRow
              label="Service Account Key (JSON)"
              error={form.formState.errors.gmcServiceAccountKey?.message}
              {...(hasGmcKey && !replacingKey
                ? {}
                : {
                    hint: 'Paste the service-account JSON. Stored encrypted; never displayed back. Not needed if you connect with Google above.',
                  })}
            >
              {hasGmcKey && !replacingKey ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Alert
                    type="success"
                    showIcon
                    style={{ flex: 1 }}
                    message="Service account key configured"
                    description="Stored encrypted and never displayed. Replace it only to rotate the key."
                  />
                  <Button onClick={() => setReplacingKey(true)}>Replace key</Button>
                </div>
              ) : (
                <>
                  <Controller
                    control={form.control}
                    name="gmcServiceAccountKey"
                    render={({ field }) => (
                      <Input.TextArea
                        {...field}
                        value={field.value ?? ''}
                        rows={4}
                        placeholder='{ "type": "service_account", ... }'
                      />
                    )}
                  />
                  {hasGmcKey && (
                    <Button
                      type="link"
                      style={{ paddingLeft: 0 }}
                      onClick={() => {
                        form.setValue('gmcServiceAccountKey', '');
                        setReplacingKey(false);
                      }}
                    >
                      Cancel — keep existing key
                    </Button>
                  )}
                </>
              )}
            </FieldRow>
            <ValidateButton
              onValidate={() =>
                validateGmc(
                  form.getValues('gmcMerchantId') ?? '',
                  form.getValues('gmcServiceAccountKey') ?? '',
                )
              }
            >
              Test connection
            </ValidateButton>
          </>
        )}
      </Space>
    </Card>
  );
}

type Option = { value: string; label: string };

function GmcSettingsSection({
  form,
  countryOptions,
  languageOptions,
  currencyOptions,
  conditionOptions,
}: {
  form: FormType;
  countryOptions: Option[];
  languageOptions: Option[];
  currencyOptions: Option[];
  conditionOptions: Option[];
}) {
  return (
    <Card title="Merchant Center Settings">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <FieldRow label="Target Country">
          <Controller
            control={form.control}
            name="gmcTargetCountry"
            render={({ field }) => (
              <Select
                value={field.value}
                onChange={field.onChange}
                options={countryOptions}
                style={{ width: '100%' }}
              />
            )}
          />
        </FieldRow>
        <FieldRow label="Content Language">
          <Controller
            control={form.control}
            name="gmcContentLanguage"
            render={({ field }) => (
              <Select
                value={field.value}
                onChange={field.onChange}
                options={languageOptions}
                style={{ width: '100%' }}
              />
            )}
          />
        </FieldRow>
        <FieldRow label="Currency">
          <Controller
            control={form.control}
            name="gmcCurrency"
            render={({ field }) => (
              <Select
                value={field.value}
                onChange={field.onChange}
                options={currencyOptions}
                style={{ width: '100%' }}
              />
            )}
          />
        </FieldRow>
        <FieldRow label="Default Condition">
          <Controller
            control={form.control}
            name="gmcDefaultCondition"
            render={({ field }) => (
              <Select
                value={field.value}
                onChange={field.onChange}
                options={conditionOptions}
                style={{ width: '100%' }}
              />
            )}
          />
        </FieldRow>
        <FieldRow label="Category Mode">
          <Controller
            control={form.control}
            name="gmcCategoryMode"
            render={({ field }) => (
              <Select
                value={field.value}
                onChange={field.onChange}
                options={CATEGORY_MODES}
                style={{ width: '100%' }}
              />
            )}
          />
        </FieldRow>
        <FieldRow label="Brand Override">
          <Controller
            control={form.control}
            name="gmcBrandOverride"
            render={({ field }) => (
              <Input {...field} value={field.value ?? ''} placeholder="Optional brand name" />
            )}
          />
        </FieldRow>

        <Typography.Text strong>Sync options</Typography.Text>
        <SyncCheckbox form={form} name="autoSyncEnabled" label="Auto-sync on product changes" />
        <SyncCheckbox
          form={form}
          name="hourlyReconcileEnabled"
          label="Hourly reconcile (fix drift)"
        />
        <SyncCheckbox form={form} name="syncVariantsEnabled" label="Sync variants as offers" />
        <SyncCheckbox form={form} name="includeOutOfStock" label="Include out-of-stock items" />
        <SyncCheckbox form={form} name="freeListingsEnabled" label="Enable free listings" />
      </Space>
    </Card>
  );
}

function SyncCheckbox({
  form,
  name,
  label,
}: {
  form: FormType;
  name:
    | 'autoSyncEnabled'
    | 'hourlyReconcileEnabled'
    | 'syncVariantsEnabled'
    | 'includeOutOfStock'
    | 'freeListingsEnabled';
  label: string;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Checkbox checked={field.value ?? false} onChange={(e) => field.onChange(e.target.checked)}>
          {label}
        </Checkbox>
      )}
    />
  );
}

function FieldRow({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
        {label}
      </Typography.Text>
      {children}
      {error && (
        <Typography.Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {error}
        </Typography.Text>
      )}
      {hint && !error && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {hint}
        </Typography.Text>
      )}
    </div>
  );
}
