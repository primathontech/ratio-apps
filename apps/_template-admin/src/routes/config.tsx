import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Card, Checkbox, Input, PrimaryButton, Space, Typography } from '@primathonos/orion';
import { DEFAULT_TEMPLATE_HOSTS } from '@shared/constants/_template-events';
import { _templateConfigInputSchema } from '@shared/schemas/_template-config';
import { buildDefaultEventMap } from '@shared/schemas/event-map';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';

// Zod 4 separates input vs output types for schemas with `.default()`:
//   - z.input  → fields-with-default are OPTIONAL (what the user types)
//   - z.output → those fields are REQUIRED (what zod returns after parse)
// useForm needs the input shape so optional defaults don't trip the validator;
// the third type param tells RHF the post-parse output shape `handleSubmit` delivers.
//
// We resolve against `_templateConfigInputSchema` (not the strict schema)
// because the backend already accepts that lenient shape — `events` / `debug`
// are optional on PUT and backfilled server-side. The strict schema was
// silently rejecting saves whenever the form's `events` initial value
// failed `eventMapSchema` validation, with no visible feedback.
type ConfigInput = z.input<typeof _templateConfigInputSchema>;
type ConfigOutput = z.output<typeof _templateConfigInputSchema>;

export const Route = createFileRoute('/config')({ component: ConfigPage });

function ConfigPage() {
  const { data, isLoading } = useConfig();
  const update = useUpdateConfig();

  const form = useForm<ConfigInput, unknown, ConfigOutput>({
    resolver: zodResolver(_templateConfigInputSchema),
    defaultValues: {
      apiKey: '',
      host: DEFAULT_TEMPLATE_HOSTS[0],
      debug: false,
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
      events: { ...buildDefaultEventMap(), ...(data.events ?? {}) },
    });
  }, [data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  return (
    <FormProvider {...form}>
      <Card
        title="Template credentials"
        extra={
          <Typography.Text type="secondary">
            Template → Project Settings → Project API Key (starts with <code>phc_</code>)
          </Typography.Text>
        }
      >
        <form
          onSubmit={form.handleSubmit(
            (values) => update.mutate(values),
            // Surface validation errors visibly instead of `handleSubmit`
            // silently swallowing them. Without this, a bad event-map shape
            // (or any other rule the user can't see) makes the Save button
            // look broken with no console output.
            (errors) => {
              // eslint-disable-next-line no-console
              console.warn('Template config form validation failed:', errors);
              form.setError('root', {
                type: 'validation',
                message:
                  'Form has invalid fields — check the highlighted inputs (or open DevTools console for details).',
              });
            },
          )}
        >
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <FieldRow label="Project API Key" error={form.formState.errors.apiKey?.message}>
              <Controller
                control={form.control}
                name="apiKey"
                render={({ field, fieldState }) => (
                  <Input
                    {...field}
                    placeholder="phc_xxxxxxxxxxxxxxxxxxxxxxxx"
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>

            <FieldRow
              label="Host"
              error={form.formState.errors.host?.message}
              hint="US: https://us.i._template.com · EU: https://eu.i._template.com · or your self-hosted https URL"
            >
              <Controller
                control={form.control}
                name="host"
                render={({ field, fieldState }) => (
                  <Input
                    {...field}
                    placeholder="https://us.i._template.com"
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
