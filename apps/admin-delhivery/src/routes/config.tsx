import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Card,
  Input,
  PrimaryButton,
  RadioButton,
  RadioGroup,
  Space,
  Switch,
  Typography,
} from '@primathonos/orion';
import { delhiveryConfigInputSchema } from '@shared/schemas/delhivery-config';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useConfig, useTestConnection, useUpdateConfig } from '@/hooks/useConfig';
import { useDefaults } from '@/hooks/useDefaults';

// Zod separates input vs output types for schemas with `.default()`:
//   - z.input  → fields-with-default are OPTIONAL (what the user types)
//   - z.output → those fields are REQUIRED (what zod returns after parse)
// useForm needs the input shape so optional defaults don't trip the validator;
// the third type param tells RHF the post-parse output shape `handleSubmit`
// delivers. We resolve against `delhiveryConfigInputSchema` (the lenient PUT
// shape), the backend backfills `pickupCutoff` / `awbTrigger` / `enabled`.
type ConfigInput = z.input<typeof delhiveryConfigInputSchema>;
type ConfigOutput = z.output<typeof delhiveryConfigInputSchema>;

export const Route = createFileRoute('/config')({ component: ConfigPage });

const EMPTY_FORM: ConfigInput = {
  apiToken: '',
  pickupLocationName: '',
  pickupPincode: '',
  pickupPhone: '',
  pickupAddress: '',
  pickupCity: '',
  gstin: '',
  pickupCutoff: '10:00',
  awbTrigger: 'auto',
  defaultBox: { l: 10, b: 10, h: 10 },
  enabled: true,
};

export function ConfigPage() {
  const { data, isLoading } = useConfig();
  const defaults = useDefaults();
  const update = useUpdateConfig();
  const test = useTestConnection();

  // Token is required only on first-time setup. Once one is stored the field
  // may stay blank (keeps the stored token), so we can't bake this into the
  // static schema. A ref keeps the current value inside the resolver closure.
  const hasSavedToken = !!data?.hasApiToken;
  const hasSavedTokenRef = useRef(hasSavedToken);
  hasSavedTokenRef.current = hasSavedToken;

  const form = useForm<ConfigInput, unknown, ConfigOutput>({
    resolver: async (values, ctx, opts) => {
      const result = await zodResolver(delhiveryConfigInputSchema)(values, ctx, opts);
      if (!hasSavedTokenRef.current && !(values.apiToken ?? '').trim()) {
        result.errors = {
          ...result.errors,
          apiToken: { type: 'required', message: 'API token is required' },
        };
      }
      return result;
    },
    defaultValues: EMPTY_FORM,
  });

  // Load the saved config into the form. The token is write-only, the
  // backend only returns a masked hint, so the field always resets to ''.
  useEffect(() => {
    if (!data) return;
    form.reset({
      apiToken: '',
      pickupLocationName: data.pickupLocationName,
      pickupPincode: data.pickupPincode,
      pickupPhone: data.pickupPhone,
      pickupAddress: data.pickupAddress,
      pickupCity: data.pickupCity,
      gstin: data.gstin,
      pickupCutoff: data.pickupCutoff,
      awbTrigger: data.awbTrigger,
      defaultBox: data.defaultBox,
      enabled: data.enabled,
    });
  }, [data, form]);

  // No saved config yet (e.g. a 404 before the bootstrap seed), pre-fill the
  // operational fields from the public defaults endpoint.
  useEffect(() => {
    if (data || !defaults.data || form.formState.isDirty) return;
    form.reset({
      ...EMPTY_FORM,
      pickupCutoff: defaults.data.pickupCutoff,
      awbTrigger: defaults.data.awbTrigger,
      defaultBox: defaults.data.defaultBox,
    });
  }, [defaults.data, data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const onSubmit = form.handleSubmit(
    (values) => update.mutate(values),
    // Surface validation errors visibly instead of `handleSubmit` silently
    // swallowing them, a hidden rule would make Save look broken.
    (errors) => {
      // eslint-disable-next-line no-console
      console.warn('Delhivery config form validation failed:', errors);
      form.setError('root', {
        type: 'validation',
        message: 'Form has invalid fields. Check the highlighted inputs.',
      });
    },
  );

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit}>
        <Space direction="vertical" size="large" style={{ display: 'flex' }}>
          <Card
            title="Delhivery credentials"
            extra={
              <Typography.Text type="secondary">
                Your own Delhivery Express B2C account (One Delhivery → Settings → API)
              </Typography.Text>
            }
          >
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <FieldRow
                label="API token"
                error={form.formState.errors.apiToken?.message}
                hint={
                  data?.hasApiToken
                    ? `A token ending ${data.apiTokenMasked} is saved (encrypted, never displayed). Leave blank to keep it, or paste a new token to replace it.`
                    : 'Stored encrypted at rest; never displayed back.'
                }
              >
                <Controller
                  control={form.control}
                  name="apiToken"
                  render={({ field, fieldState }) => (
                    <Input.Password
                      {...field}
                      placeholder="Delhivery Express B2C token"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <Space direction="vertical" size={4} style={{ display: 'flex' }}>
                <Space>
                  <Button
                    loading={test.isPending}
                    disabled={!data?.hasApiToken}
                    onClick={() => test.mutate()}
                  >
                    Test connection
                  </Button>
                  {!data?.hasApiToken && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Save a token first. The test runs against the saved token.
                    </Typography.Text>
                  )}
                </Space>
                {test.data?.ok && (
                  <Alert
                    type="success"
                    message="Connection OK. Token accepted by Delhivery."
                    showIcon
                  />
                )}
                {test.data && !test.data.ok && (
                  <Alert
                    type="error"
                    message={`Delhivery rejected the token (HTTP ${test.data.status}). Check the token and save again.`}
                    showIcon
                  />
                )}
                {test.error && (
                  <Alert type="error" message={(test.error as Error).message} showIcon />
                )}
              </Space>
            </Space>
          </Card>

          <Card title="Pickup & manifest">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <FieldRow
                label="Pickup location name"
                error={form.formState.errors.pickupLocationName?.message}
                hint="The Delhivery-registered warehouse name, also used as the RTO destination. Registered with Delhivery on save."
              >
                <Controller
                  control={form.control}
                  name="pickupLocationName"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      placeholder="Main Warehouse"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Pickup pincode"
                error={form.formState.errors.pickupPincode?.message}
                hint="6-digit pincode of the pickup warehouse. Registered with Delhivery and used as the origin for delivery-time estimates."
              >
                <Controller
                  control={form.control}
                  name="pickupPincode"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      aria-label="Pickup pincode"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="122001"
                      style={{ maxWidth: 160 }}
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Pickup phone"
                error={form.formState.errors.pickupPhone?.message}
                hint="10-digit contact number for the pickup warehouse."
              >
                <Controller
                  control={form.control}
                  name="pickupPhone"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      aria-label="Pickup phone"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="9876543210"
                      style={{ maxWidth: 200 }}
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Pickup address"
                error={form.formState.errors.pickupAddress?.message}
                hint="Full pickup-warehouse address. Also used as the return (RTO) address."
              >
                <Controller
                  control={form.control}
                  name="pickupAddress"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      aria-label="Pickup address"
                      placeholder="Plot 5, Industrial Area, Phase 1"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Pickup city"
                error={form.formState.errors.pickupCity?.message}
                hint="City of the pickup warehouse (optional)."
              >
                <Controller
                  control={form.control}
                  name="pickupCity"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      aria-label="Pickup city"
                      placeholder="Gurgaon"
                      style={{ maxWidth: 240 }}
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="GSTIN"
                error={form.formState.errors.gstin?.message}
                hint="Seller GSTIN, sent to Delhivery as seller_gst_tin on every shipment."
              >
                <Controller
                  control={form.control}
                  name="gstin"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      aria-label="GSTIN"
                      placeholder="22AAAAA0000A1Z5"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Pickup cutoff (IST)"
                error={form.formState.errors.pickupCutoff?.message}
                hint="Daily manifest cutoff, 24h HH:mm. Pending shipments are manifested for pickup at this time."
              >
                <Controller
                  control={form.control}
                  name="pickupCutoff"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="10:00"
                      style={{ maxWidth: 120 }}
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>
            </Space>
          </Card>

          <Card title="Shipment creation">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <FieldRow
                label="AWB trigger"
                error={form.formState.errors.awbTrigger?.message}
                hint="Auto creates the AWB as soon as an order is paid; Manual leaves creation to you on the Shipments screen."
              >
                <Controller
                  control={form.control}
                  name="awbTrigger"
                  render={({ field }) => (
                    <RadioGroup
                      value={field.value ?? 'auto'}
                      onChange={(e) => field.onChange(e.target.value as 'auto' | 'manual')}
                    >
                      <RadioButton value="auto">Auto: AWB on paid order</RadioButton>
                      <RadioButton value="manual">Manual: create from Shipments</RadioButton>
                    </RadioGroup>
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Default box size (cm)"
                error={
                  form.formState.errors.defaultBox?.l?.message ??
                  form.formState.errors.defaultBox?.b?.message ??
                  form.formState.errors.defaultBox?.h?.message ??
                  form.formState.errors.defaultBox?.message
                }
                hint="Fallback package dimensions when a product has no dimension metafields."
              >
                <Space>
                  <BoxDimInput name="defaultBox.l" label="Length (cm)" form={form} />
                  <Typography.Text type="secondary">×</Typography.Text>
                  <BoxDimInput name="defaultBox.b" label="Breadth (cm)" form={form} />
                  <Typography.Text type="secondary">×</Typography.Text>
                  <BoxDimInput name="defaultBox.h" label="Height (cm)" form={form} />
                </Space>
              </FieldRow>

              <Controller
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Switch
                      checked={field.value ?? true}
                      onChange={(checked) => field.onChange(checked)}
                      aria-label="Enabled"
                    />
                    <Typography.Text>
                      Enabled: create shipments for this store (kill switch)
                    </Typography.Text>
                  </div>
                )}
              />
            </Space>
          </Card>

          {form.formState.errors.root && (
            <Alert type="warning" message={form.formState.errors.root.message} showIcon />
          )}
          {update.error && (
            <Alert type="error" message={(update.error as Error).message} showIcon />
          )}
          {update.isSuccess && (
            <Alert
              type={
                update.data.warehouseStatus === 'failed'
                  ? 'warning'
                  : update.data.warehouseStatus === 'exists'
                    ? 'info'
                    : 'success'
              }
              message={warehouseAlert(update.data.warehouseStatus, update.data.warehouseMessage)}
              showIcon
            />
          )}

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

function BoxDimInput({
  name,
  label,
  form,
}: {
  name: 'defaultBox.l' | 'defaultBox.b' | 'defaultBox.h';
  label: string;
  form: FormType;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Input
          type="number"
          min={1}
          aria-label={label}
          value={field.value ?? ''}
          onChange={(e) =>
            field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
          }
          onBlur={field.onBlur}
          style={{ width: 90 }}
          {...(fieldState.invalid ? { status: 'error' as const } : {})}
        />
      )}
    />
  );
}

// The config is always saved locally; the warehouse outcome message is
// Delhivery's OWN (surfaced verbatim). Static text is only a fallback for the
// rare case where Delhivery returned no message at all.
function warehouseAlert(
  status: 'created' | 'exists' | 'updated' | 'failed',
  message: string,
): string {
  if (message) {
    return status === 'failed' ? `Saved locally. Delhivery: ${message}` : `Saved. ${message}`;
  }
  const fallback: Record<'created' | 'exists' | 'updated' | 'failed', string> = {
    created: 'Pickup location registered with Delhivery.',
    exists: 'Pickup location already registered with Delhivery.',
    updated: 'Pickup address updated on Delhivery.',
    failed: 'Delhivery could not register the pickup location. Check the details and save again.',
  };
  return `Saved. ${fallback[status]}`;
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
