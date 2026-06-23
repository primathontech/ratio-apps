import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  PrimaryButton,
  Space,
  Typography,
} from '@primathonos/orion';
import type { WizzyConfigInput } from '@shared/schemas/wizzy-config';
import { wizzyConfigInputSchema } from '@shared/schemas/wizzy-config';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';
import { type ValidateResult, validateWizzy } from '@/lib/validate';

// Zod separates input vs output types for schemas with `.default()`:
//   - z.input  → fields-with-default are OPTIONAL (what the user types)
//   - z.output → those fields are REQUIRED (what zod returns after parse)
type ConfigInput = z.input<typeof wizzyConfigInputSchema>;
type ConfigOutput = z.output<typeof wizzyConfigInputSchema>;

export const Route = createFileRoute('/config')({ component: ConfigPage });

// The optional/nullable string fields reject an empty string, but form inputs
// always emit '' when blank. Coerce blanks to null before validation.
const NULLABLE_STRING_FIELDS = ['storeId', 'storeSecret', 'apiKey', 'storeUrl'] as const;

const baseResolver = zodResolver(wizzyConfigInputSchema);
const resolver: typeof baseResolver = (values, context, options) => {
  const normalized = { ...(values as Record<string, unknown>) };
  for (const key of NULLABLE_STRING_FIELDS) {
    if (normalized[key] === '') normalized[key] = null;
  }
  return baseResolver(normalized as typeof values, context, options);
};

export function ConfigPage() {
  const { data, isLoading } = useConfig();
  const update = useUpdateConfig();
  // Write-only secrets: show a "configured / Replace" toggle when set.
  const [replacingSecret, setReplacingSecret] = useState(false);
  const [replacingApiKey, setReplacingApiKey] = useState(false);

  const form = useForm<ConfigInput, unknown, ConfigOutput>({
    resolver,
    defaultValues: {
      wizzyEnabled: false,
      storeId: '',
      storeSecret: '',
      apiKey: '',
      sdkUrl: 'https://cdn.wizzy.ai/sdk/v2/wizzy.min.js',
      storeUrl: '',
      autoSyncEnabled: true,
      includeOutOfStock: true,
      stripHtmlDescription: true,
    },
  });

  // Repopulate ALL saved fields on load — critical correctness fix.
  useEffect(() => {
    if (!data) return;
    form.reset({
      wizzyEnabled: data.wizzyEnabled,
      storeId: data.storeId ?? '',
      // storeSecret and apiKey are write-only: never returned, always leave empty
      storeSecret: '',
      apiKey: '',
      sdkUrl: data.sdkUrl,
      storeUrl: data.storeUrl ?? '',
      autoSyncEnabled: data.autoSyncEnabled,
      includeOutOfStock: data.includeOutOfStock,
      stripHtmlDescription: data.stripHtmlDescription,
    });
  }, [data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const onSubmit = form.handleSubmit(
    (values) => {
      // Write-only secrets: omit entirely when empty so a save never clears stored secrets.
      const payload: WizzyConfigInput = { ...values };
      if (!payload.storeSecret) {
        delete payload.storeSecret;
      }
      if (!payload.apiKey) {
        delete payload.apiKey;
      }
      update.mutate(payload);
    },
    (errors) => {
      console.warn('Wizzy config form validation failed:', errors);
      form.setError('root', {
        type: 'validation',
        message: 'Form has invalid fields — check the highlighted inputs.',
      });
    },
  );

  const hasStoreSecret = !!data?.hasStoreSecret;
  const hasApiKey = !!data?.hasApiKey;

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit}>
        <Space direction="vertical" size="large" style={{ display: 'flex' }}>
          <Card title="Wizzy Connection">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <Controller
                control={form.control}
                name="wizzyEnabled"
                render={({ field }) => (
                  <Checkbox
                    checked={field.value ?? false}
                    onChange={(e) => field.onChange(e.target.checked)}
                  >
                    Enable Wizzy AI Search
                  </Checkbox>
                )}
              />

              <FieldRow label="Wizzy Store ID" error={form.formState.errors.storeId?.message}>
                <Controller
                  control={form.control}
                  name="storeId"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="your-store-id"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Store Secret"
                {...(hasStoreSecret && !replacingSecret
                  ? {}
                  : { hint: 'Your Wizzy Store Secret. Stored encrypted; never displayed back.' })}
                error={form.formState.errors.storeSecret?.message}
              >
                {hasStoreSecret && !replacingSecret ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Alert
                      type="success"
                      showIcon
                      style={{ flex: 1 }}
                      message="Store secret configured ✓"
                      description="Stored encrypted and never displayed. Replace only to rotate the secret."
                    />
                    <Button onClick={() => setReplacingSecret(true)}>Replace secret</Button>
                  </div>
                ) : (
                  <>
                    <Controller
                      control={form.control}
                      name="storeSecret"
                      render={({ field }) => (
                        <Input.Password
                          {...field}
                          value={field.value ?? ''}
                          placeholder="Enter store secret"
                          autoComplete="new-password"
                        />
                      )}
                    />
                    {hasStoreSecret && (
                      <Button
                        type="link"
                        style={{ paddingLeft: 0 }}
                        onClick={() => {
                          form.setValue('storeSecret', '');
                          setReplacingSecret(false);
                        }}
                      >
                        Cancel — keep existing secret
                      </Button>
                    )}
                  </>
                )}
              </FieldRow>

              <FieldRow
                label="API Key"
                {...(hasApiKey && !replacingApiKey
                  ? {}
                  : { hint: 'Your Wizzy API Key. Stored encrypted; never displayed back.' })}
                error={form.formState.errors.apiKey?.message}
              >
                {hasApiKey && !replacingApiKey ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Alert
                      type="success"
                      showIcon
                      style={{ flex: 1 }}
                      message="API key configured ✓"
                      description="Stored encrypted and never displayed. Replace only to rotate the key."
                    />
                    <Button onClick={() => setReplacingApiKey(true)}>Replace key</Button>
                  </div>
                ) : (
                  <>
                    <Controller
                      control={form.control}
                      name="apiKey"
                      render={({ field }) => (
                        <Input.Password
                          {...field}
                          value={field.value ?? ''}
                          placeholder="Enter API key"
                          autoComplete="new-password"
                        />
                      )}
                    />
                    {hasApiKey && (
                      <Button
                        type="link"
                        style={{ paddingLeft: 0 }}
                        onClick={() => {
                          form.setValue('apiKey', '');
                          setReplacingApiKey(false);
                        }}
                      >
                        Cancel — keep existing key
                      </Button>
                    )}
                  </>
                )}
              </FieldRow>

              <FieldRow
                label="SDK URL"
                error={form.formState.errors.sdkUrl?.message}
                hint="The Wizzy JS SDK URL injected via ScriptTag. Change only for version upgrades."
              >
                <Controller
                  control={form.control}
                  name="sdkUrl"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="https://cdn.wizzy.ai/sdk/v2/wizzy.min.js"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Storefront URL"
                error={form.formState.errors.storeUrl?.message}
                hint="Your store domain (e.g. shop.example.com). Used to build product links in search results."
              >
                <Controller
                  control={form.control}
                  name="storeUrl"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="shop.example.com"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <ValidateButton
                onValidate={() =>
                  validateWizzy(
                    form.getValues('storeId') ?? '',
                    form.getValues('storeSecret') ?? '',
                    form.getValues('apiKey') ?? '',
                  )
                }
              >
                Test connection
              </ValidateButton>
            </Space>
          </Card>

          <Card title="Sync Settings">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <SyncCheckbox
                form={form}
                name="autoSyncEnabled"
                label="Auto-sync on product changes"
              />
              <SyncCheckbox
                form={form}
                name="includeOutOfStock"
                label="Include out-of-stock products"
              />
              <SyncCheckbox
                form={form}
                name="stripHtmlDescription"
                label="Strip HTML from product descriptions"
              />
            </Space>
          </Card>

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

function SyncCheckbox({
  form,
  name,
  label,
}: {
  form: FormType;
  name: 'autoSyncEnabled' | 'includeOutOfStock' | 'stripHtmlDescription';
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
