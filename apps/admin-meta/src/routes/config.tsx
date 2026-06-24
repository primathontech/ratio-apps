import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Card, Checkbox, Input, PrimaryButton, Space, Typography } from '@primathonos/orion';
import { DATA_SHARING_LEVELS, PRODUCT_ID_TYPES } from '@shared/constants/meta-events';
import { buildDefaultEventMap } from '@shared/schemas/event-map';
import { metaConfigInputSchema } from '@shared/schemas/meta-config';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';

// Zod 4 input vs output: fields with `.default()` are optional on input
// (what the user types) and required on output (post-parse). RHF needs the
// input shape; the third type param is the post-parse output `handleSubmit`
// delivers. We resolve against the lenient input schema the backend accepts.
type ConfigInput = z.input<typeof metaConfigInputSchema>;
type ConfigOutput = z.output<typeof metaConfigInputSchema>;

const LEVEL_HINT: Record<string, string> = {
  standard: 'Pixel only (browser) — no server-side CAPI.',
  enhanced: 'Pixel + CAPI for Purchase only.',
  maximum: 'Pixel + CAPI for all events + full PII. Recommended.',
};

export const Route = createFileRoute('/config')({ component: ConfigPage });

function ConfigPage() {
  const { data, isLoading } = useConfig();
  const update = useUpdateConfig();

  const form = useForm<ConfigInput, unknown, ConfigOutput>({
    resolver: zodResolver(metaConfigInputSchema),
    defaultValues: {
      pixelId: '',
      capiAccessToken: '',
      dataSharingLevel: 'maximum',
      productIdType: 'product_id',
      debug: false,
      storefrontUrl: '',
      events: buildDefaultEventMap('meta'),
    },
  });

  useEffect(() => {
    if (!data) return;
    // Defensive merge: an older row may have an incomplete `events` object.
    // Fill missing keys with defaults so the form passes validation on save.
    form.reset({
      ...data,
      events: { ...buildDefaultEventMap('meta'), ...(data.events ?? {}) },
    });
  }, [data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  return (
    <FormProvider {...form}>
      <Card
        title="Meta credentials"
        extra={
          <Typography.Text type="secondary">
            Events Manager → Data Sources → your Pixel → Conversions API token
          </Typography.Text>
        }
      >
        <form
          onSubmit={form.handleSubmit(
            (values) => update.mutate(values),
            (errors) => {
              // eslint-disable-next-line no-console
              console.warn('Meta config form validation failed:', errors);
              form.setError('root', {
                type: 'validation',
                message:
                  'Form has invalid fields — check the highlighted inputs (or open DevTools console for details).',
              });
            },
          )}
        >
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <FieldRow
              label="Meta Pixel ID"
              error={form.formState.errors.pixelId?.message}
              hint="Numeric. Comma-separate to send to multiple pixels."
            >
              <Controller
                control={form.control}
                name="pixelId"
                render={({ field, fieldState }) => (
                  <Input
                    {...field}
                    placeholder="123456789012345"
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>

            <FieldRow
              label="Conversions API access token"
              error={form.formState.errors.capiAccessToken?.message}
              hint="System User token (starts with EAA…). Stored server-side, never exposed to the storefront."
            >
              <Controller
                control={form.control}
                name="capiAccessToken"
                render={({ field, fieldState }) => (
                  <Input.Password
                    {...field}
                    placeholder="EAA…"
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>

            <FieldRow
              label="Data sharing level"
              error={form.formState.errors.dataSharingLevel?.message}
              hint={LEVEL_HINT[form.watch('dataSharingLevel') ?? 'maximum']}
            >
              <Controller
                control={form.control}
                name="dataSharingLevel"
                render={({ field }) => (
                  <select {...field} value={field.value ?? 'maximum'} style={selectStyle}>
                    {DATA_SHARING_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                )}
              />
            </FieldRow>

            <FieldRow
              label="Product identifier"
              error={form.formState.errors.productIdType?.message}
              hint="Must match your catalog feed id and Meta Ads → Product Identifier (or Dynamic Ads break)."
            >
              <Controller
                control={form.control}
                name="productIdType"
                render={({ field }) => (
                  <select {...field} value={field.value ?? 'product_id'} style={selectStyle}>
                    {PRODUCT_ID_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                )}
              />
            </FieldRow>

            <FieldRow
              label="Storefront URL"
              error={form.formState.errors.storefrontUrl?.message}
              hint="Your store's base URL (e.g. https://yourstore.com) — used for catalog/feed product links. Must be a domain verified in your Meta Business. Leave blank to use the server default."
            >
              <Controller
                control={form.control}
                name="storefrontUrl"
                render={({ field, fieldState }) => (
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    placeholder="https://yourstore.com"
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>

            <Controller
              control={form.control}
              name="debug"
              render={({ field }) => (
                <Checkbox
                  checked={field.value ?? false}
                  onChange={(e) => field.onChange(e.target.checked)}
                >
                  Enable debug logging in the browser console
                </Checkbox>
              )}
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
                Save credentials
              </PrimaryButton>
            </div>
          </Space>
        </form>
      </Card>
    </FormProvider>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 11px',
  borderRadius: 6,
  border: '1px solid #d9d9d9',
  fontSize: 14,
};

function FieldRow({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
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
