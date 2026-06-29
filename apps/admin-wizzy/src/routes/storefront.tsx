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
import { useMerchant } from '@/hooks/useMerchant';

// Zod separates input vs output types for schemas with `.default()`:
//   - z.input  → fields-with-default are OPTIONAL (what the user types)
//   - z.output → those fields are REQUIRED (what zod returns after parse)
type ConfigInput = z.input<typeof wizzyConfigInputSchema>;
type ConfigOutput = z.output<typeof wizzyConfigInputSchema>;

export const Route = createFileRoute('/storefront')({ component: StorefrontPage });

// The optional/nullable string fields reject an empty string, but form inputs
// always emit '' when blank. Coerce blanks to null before validation. The
// storefront fields are NOT nullable (they have defaults) so they aren't here.
const NULLABLE_STRING_FIELDS = ['storeId', 'storeSecret', 'apiKey', 'storeUrl'] as const;

const baseResolver = zodResolver(wizzyConfigInputSchema);
const resolver: typeof baseResolver = (values, context, options) => {
  const normalized = { ...(values as Record<string, unknown>) };
  for (const key of NULLABLE_STRING_FIELDS) {
    if (normalized[key] === '') normalized[key] = null;
  }
  return baseResolver(normalized as typeof values, context, options);
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

// This storefront loads Wizzy via the `search-wizzy` integration module
// (wired in `src/app/layout.tsx` as `<WizzySearchScript/>`), which reads these
// public env vars and injects the loader. Match the storefront's convention:
// configure by env, not a hand-pasted <script>.
function buildEnvBlock(merchantId: string): string {
  const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return [
    'NEXT_PUBLIC_WIZZY_ENABLED=true',
    `NEXT_PUBLIC_WIZZY_BACKEND_URL=${base || 'https://<your-backend>'}`,
    `NEXT_PUBLIC_WIZZY_MERCHANT_ID=${merchantId}`,
  ].join('\n');
}

export function StorefrontPage() {
  const { data, isLoading } = useConfig();
  const merchant = useMerchant();
  const update = useUpdateConfig();
  const [copied, setCopied] = useState(false);

  const form = useForm<ConfigInput, unknown, ConfigOutput>({
    resolver,
    defaultValues: {
      wizzyEnabled: false,
      storeId: '',
      storeSecret: '',
      apiKey: '',
      storeUrl: '',
      autoSyncEnabled: true,
      includeOutOfStock: true,
      stripHtmlDescription: true,
      searchEnabled: false,
      inputSelector: '#search',
      resultsMountSelector: '#wizzy-results',
      resultsPagePath: '/search',
      themePrimary: '#0fb3a9',
    },
  });

  // Repopulate ALL saved fields on load so a save never wipes unrelated config.
  useEffect(() => {
    if (!data) return;
    form.reset({
      wizzyEnabled: data.wizzyEnabled,
      storeId: data.storeId ?? '',
      // storeSecret and apiKey are write-only: never returned, always leave empty
      storeSecret: '',
      apiKey: '',
      storeUrl: data.storeUrl ?? '',
      autoSyncEnabled: data.autoSyncEnabled,
      includeOutOfStock: data.includeOutOfStock,
      stripHtmlDescription: data.stripHtmlDescription,
      searchEnabled: data.searchEnabled,
      inputSelector: data.inputSelector,
      resultsMountSelector: data.resultsMountSelector,
      resultsPagePath: data.resultsPagePath,
      themePrimary: data.themePrimary,
    });
  }, [data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const onSubmit = form.handleSubmit(
    (values) => {
      // Send the FULL input so unrelated fields aren't wiped. Write-only secrets
      // are omitted when empty so a save never clears stored credentials.
      const payload: WizzyConfigInput = { ...values };
      if (!payload.storeSecret) delete payload.storeSecret;
      if (!payload.apiKey) delete payload.apiKey;
      update.mutate(payload);
    },
    (errors) => {
      console.warn('Wizzy storefront form validation failed:', errors);
      form.setError('root', {
        type: 'validation',
        message: 'Form has invalid fields — check the highlighted inputs.',
      });
    },
  );

  // Prefer the real Ratio merchant id; fall back to a clearly-labeled placeholder.
  const merchantId = merchant.data?.id ?? data?.storeId ?? '<MERCHANT_ID>';
  const envBlock = buildEnvBlock(merchantId);

  const onCopy = () => {
    void navigator.clipboard?.writeText(envBlock);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const storeUrl = data?.storeUrl;
  const resultsPath = form.watch('resultsPagePath') ?? '/search';
  const previewHref = storeUrl
    ? `${/^https?:\/\//.test(storeUrl) ? storeUrl : `https://${storeUrl}`}${resultsPath}`
    : undefined;

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit}>
        <Space direction="vertical" size="large" style={{ display: 'flex' }}>
          <Card title="Storefront Search">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <Typography.Paragraph>
                This storefront loads Wizzy through the <Typography.Text code>search-wizzy</Typography.Text>{' '}
                integration module — already wired in{' '}
                <Typography.Text code>src/app/layout.tsx</Typography.Text> as{' '}
                <Typography.Text code>&lt;WizzySearchScript/&gt;</Typography.Text>. Configure it by
                environment variables (matching the storefront's integration convention), then point
                it at the page elements below.
              </Typography.Paragraph>

              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                  Storefront environment variables
                </Typography.Text>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  Set these in your storefront (e.g. <Typography.Text code>.env.local</Typography.Text>),
                  then restart the dev server / redeploy so the values take effect.
                </Typography.Paragraph>
                <pre
                  style={{
                    background: '#f6f6f6',
                    border: '1px solid #f0f0f0',
                    borderRadius: 6,
                    padding: 12,
                    overflowX: 'auto',
                    margin: 0,
                    fontSize: 13,
                  }}
                >
                  <code>{envBlock}</code>
                </pre>
                <Button style={{ marginTop: 8 }} onClick={onCopy}>
                  {copied ? 'Copied ✓' : 'Copy'}
                </Button>
              </div>
            </Space>
          </Card>

          <Card title="Search Settings">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <Controller
                control={form.control}
                name="searchEnabled"
                render={({ field }) => (
                  <Checkbox
                    checked={field.value ?? false}
                    onChange={(e) => field.onChange(e.target.checked)}
                  >
                    Enable storefront search
                  </Checkbox>
                )}
              />

              <FieldRow
                label="Search input selector"
                error={form.formState.errors.inputSelector?.message}
                hint="CSS selector of your storefront search input."
              >
                <Controller
                  control={form.control}
                  name="inputSelector"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="#search"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Results mount selector"
                error={form.formState.errors.resultsMountSelector?.message}
                hint="CSS selector of the element where results render."
              >
                <Controller
                  control={form.control}
                  name="resultsMountSelector"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="#wizzy-results"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Results page path"
                error={form.formState.errors.resultsPagePath?.message}
                hint="Path of the dedicated search-results page."
              >
                <Controller
                  control={form.control}
                  name="resultsPagePath"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="/search"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Theme color"
                error={form.formState.errors.themePrimary?.message}
                hint="Primary accent color for the search widget."
              >
                <Controller
                  control={form.control}
                  name="themePrimary"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="#0fb3a9"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              {previewHref && (
                <Typography.Paragraph>
                  <a href={previewHref} target="_blank" rel="noreferrer">
                    Preview results page ↗
                  </a>
                </Typography.Paragraph>
              )}
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
              Save storefront settings
            </PrimaryButton>
          </div>
        </Space>
      </form>
    </FormProvider>
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
