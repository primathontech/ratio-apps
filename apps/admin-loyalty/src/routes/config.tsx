import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Card, Input, PrimaryButton, Space, Typography } from '@primathonos/orion';
import { loyaltyConfigInputSchema } from '@shared/schemas/loyalty-config';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FieldRow } from '@/components/FieldRow';
import {
  useClaimSecret,
  useConfig,
  useRotateClaimSecret,
  useUpdateConfig,
} from '@/hooks/useConfig';

// Zod separates input vs output types for schemas with `.default()`:
//   - z.input  → fields-with-default are OPTIONAL (what the user types)
//   - z.output → those fields are REQUIRED (what zod returns after parse)
// useForm needs the input shape so optional defaults don't trip the validator;
// the third type param tells RHF the post-parse output shape `handleSubmit` delivers.
type ConfigInput = z.input<typeof loyaltyConfigInputSchema>;
type ConfigOutput = z.output<typeof loyaltyConfigInputSchema>;

export const Route = createFileRoute('/config')({ component: ConfigPage });

export function ConfigPage() {
  const { data, isLoading } = useConfig();
  const update = useUpdateConfig();

  const form = useForm<ConfigInput, unknown, ConfigOutput>({
    resolver: zodResolver(loyaltyConfigInputSchema),
    defaultValues: {
      storefrontBaseUrl: '',
      exportEmail: '',
    },
  });

  useEffect(() => {
    if (!data) return;
    form.reset({
      storefrontBaseUrl: data.storefrontBaseUrl ?? '',
      exportEmail: data.exportEmail ?? '',
    });
  }, [data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <FormProvider {...form}>
        <Card title="Loyalty program settings">
          <form
            onSubmit={form.handleSubmit(
              (values) =>
                update.mutate({
                  ...values,
                  // Empty optionals must be OMITTED, not sent as '' (zod .url()/
                  // .email() reject empty strings).
                  storefrontBaseUrl: values.storefrontBaseUrl || undefined,
                  exportEmail: values.exportEmail || undefined,
                }),
              (errors) => {
                console.warn('Loyalty config form validation failed:', errors);
                form.setError('root', {
                  type: 'validation',
                  message: 'Form has invalid fields — check the highlighted inputs.',
                });
              },
            )}
          >
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <FieldRow
                label="Storefront base URL"
                error={form.formState.errors.storefrontBaseUrl?.message}
                hint="QR claim links are minted against this — e.g. https://wellversed.in (required before creating QR codes)"
              >
                <Controller
                  control={form.control}
                  name="storefrontBaseUrl"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      placeholder="https://wellversed.in"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Export email"
                error={form.formState.errors.exportEmail?.message}
                hint="Default recipient for large-export download links (over 10,000 rows)"
              >
                <Controller
                  control={form.control}
                  name="exportEmail"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      placeholder="ops@example.com"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              {form.formState.errors.root && (
                <Alert type="warning" message={form.formState.errors.root.message} showIcon />
              )}
              {update.error && (
                <Alert type="error" message={(update.error as Error).message} showIcon />
              )}
              {update.isSuccess && <Alert type="success" message="Saved." showIcon />}

              <div style={{ textAlign: 'right' }}>
                <PrimaryButton htmlType="submit" loading={update.isPending}>
                  Save settings
                </PrimaryButton>
              </div>
            </Space>
          </form>
        </Card>
      </FormProvider>
      <ClaimSecretCard />
    </Space>
  );
}

function ClaimSecretCard() {
  const reveal = useClaimSecret();
  const rotate = useRotateClaimSecret();

  const secret = rotate.data?.secret ?? reveal.data?.secret;
  const envLine = secret ? `LOYALTY_CLAIM_SECRET=${secret}` : '';

  return (
    <Card title="Storefront claim secret">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <Typography.Text type="secondary">
          Paste this into your storefront server&apos;s environment so it can sign QR claim
          requests. Rotating invalidates the previous secret immediately — update the storefront env
          right after.
        </Typography.Text>

        {secret ? (
          <Typography.Paragraph copyable={{ text: envLine }} style={{ marginBottom: 0 }}>
            <Typography.Text code style={{ wordBreak: 'break-all' }}>
              {envLine}
            </Typography.Text>
          </Typography.Paragraph>
        ) : (
          <Button loading={reveal.isPending} onClick={() => reveal.mutate()}>
            Reveal secret
          </Button>
        )}

        {reveal.isError && (
          <Alert
            type="error"
            showIcon
            message={(reveal.error as Error).message || 'Failed to load the claim secret.'}
          />
        )}

        <div>
          <Button danger loading={rotate.isPending} onClick={() => rotate.mutate()}>
            Rotate secret
          </Button>
        </div>

        {rotate.isError && (
          <Alert
            type="error"
            showIcon
            message={(rotate.error as Error).message || 'Failed to rotate the claim secret.'}
          />
        )}
        {rotate.isSuccess && (
          <Alert
            type="warning"
            showIcon
            message="Secret rotated — update your storefront env now, the old secret no longer verifies."
          />
        )}
      </Space>
    </Card>
  );
}
