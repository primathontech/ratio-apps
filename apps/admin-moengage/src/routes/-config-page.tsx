import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Card,
  Checkbox,
  Input,
  PrimaryButton,
  Select,
  Space,
  Typography,
} from '@primathonos/orion';
import { MOENGAGE_DATA_CENTERS } from '@shared/constants/moengage-events';
import { buildDefaultEventMap } from '@shared/schemas/event-map';
import { moengageConfigInputSchema } from '@shared/schemas/moengage-config';
import { useEffect } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';

const DATA_CENTER_OPTIONS = (
  Object.keys(MOENGAGE_DATA_CENTERS) as Array<keyof typeof MOENGAGE_DATA_CENTERS>
).map((k) => ({ value: k, label: MOENGAGE_DATA_CENTERS[k].label }));

// Zod 4: input has `.default()` fields optional, output has them required. See
// admin-posthog/src/routes/config.tsx for the full rationale on the three-param
// useForm typing.
type ConfigInput = z.input<typeof moengageConfigInputSchema>;
type ConfigOutput = z.output<typeof moengageConfigInputSchema>;

export function ConfigPage() {
  const { data, isLoading } = useConfig();
  const update = useUpdateConfig();

  const form = useForm<ConfigInput, unknown, ConfigOutput>({
    resolver: zodResolver(moengageConfigInputSchema),
    defaultValues: {
      appId: '',
      dataCenter: 'DC_1',
      debug: false,
      swPath: '',
      events: buildDefaultEventMap(),
    },
  });

  useEffect(() => {
    if (!data) return;
    // Defensive merge: an older row in the DB may have an incomplete `events`
    // object (e.g. seed data, or pre-migration rows). Fill any missing event
    // keys with defaults so the form passes `eventMapSchema` validation on
    // save. Real per-event customizations from the row still win.
    form.reset({
      ...data,
      events: { ...buildDefaultEventMap('moengage'), ...(data.events ?? {}) },
    });
  }, [data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const selectedCenter = form.watch('dataCenter');
  const dashboardUrl = selectedCenter
    ? MOENGAGE_DATA_CENTERS[selectedCenter as keyof typeof MOENGAGE_DATA_CENTERS]?.dashboard
    : '';

  return (
    <FormProvider {...form}>
      <Card
        title="MoEngage credentials"
        extra={
          <Typography.Text type="secondary">
            MoEngage → Settings → APIs → APP ID (uppercase identifier)
          </Typography.Text>
        }
      >
        <form
          onSubmit={form.handleSubmit(
            (values) => update.mutate(values),
            // Surface validation errors instead of silently swallowing them.
            (errors) => {
              // eslint-disable-next-line no-console
              console.warn('MoEngage config form validation failed:', errors);
              form.setError('root', {
                type: 'validation',
                message:
                  'Form has invalid fields — check the highlighted inputs (or open DevTools console for details).',
              });
            },
          )}
        >
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <FieldRow label="App ID" error={form.formState.errors.appId?.message}>
              <Controller
                control={form.control}
                name="appId"
                render={({ field, fieldState }) => (
                  <Input
                    {...field}
                    placeholder="APP_ID_HERE"
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>

            <FieldRow
              label="Data centre"
              error={form.formState.errors.dataCenter?.message}
              hint={dashboardUrl ? `Dashboard: ${dashboardUrl}` : undefined}
            >
              <Controller
                control={form.control}
                name="dataCenter"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onChange={field.onChange}
                    options={DATA_CENTER_OPTIONS}
                    style={{ width: '100%' }}
                  />
                )}
              />
            </FieldRow>

            <FieldRow
              label="Service worker path (optional)"
              error={form.formState.errors.swPath?.message}
              hint="Leave blank to disable web push. If set, you must host moe-service-worker.js at this path on your storefront origin."
            >
              <Controller
                control={form.control}
                name="swPath"
                render={({ field, fieldState }) => (
                  <Input
                    {...field}
                    placeholder="/moe-service-worker.js"
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>

            {form.watch('swPath') && (
              <Alert
                type="warning"
                showIcon
                message="Web push also requires VAPID keys configured in your MoEngage dashboard — the SDK will fail silently otherwise."
              />
            )}

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
