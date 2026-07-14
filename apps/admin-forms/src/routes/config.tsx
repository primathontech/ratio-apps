import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Card,
  Input,
  Modal,
  PrimaryButton,
  Space,
  Switch,
  Typography,
} from '@primathonos/orion';
import { formsConfigInputSchema, formsNotificationEmailSchema } from '@shared/schemas/forms-config';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';

// The FORM schema: the shared input schema, loosened so text inputs may sit
// at '' (blank = "not set" / "keep stored secret"). Blank values are stripped
// before the PUT so the wire payload parses with `formsConfigInputSchema`.
const configFormSchema = formsConfigInputSchema.extend({
  defaultNotificationEmail: formsNotificationEmailSchema.or(z.literal('')).optional(),
});

type ConfigFormInput = z.input<typeof configFormSchema>;
type ConfigFormOutput = z.output<typeof configFormSchema>;

export const Route = createFileRoute('/config')({ component: ConfigPage });

export function ConfigPage() {
  const { data, isLoading } = useConfig();
  const update = useUpdateConfig();
  const [confirmDisable, setConfirmDisable] = useState(false);

  const form = useForm<ConfigFormInput, unknown, ConfigFormOutput>({
    resolver: zodResolver(configFormSchema),
    defaultValues: {
      recaptchaSiteKey: '',
      recaptchaSecret: '',
      recaptchaThreshold: 0.3,
      defaultNotificationEmail: '',
      formsEnabled: true,
    },
  });

  useEffect(() => {
    if (!data) return;
    form.reset({
      recaptchaSiteKey: data.recaptchaSiteKey ?? '',
      // WRITE-ONLY: the secret is never echoed back by the GET — the field
      // always resets to blank ("keep the stored value").
      recaptchaSecret: '',
      recaptchaThreshold: data.recaptchaThreshold,
      defaultNotificationEmail: data.defaultNotificationEmail ?? '',
      formsEnabled: data.formsEnabled,
    });
  }, [data, form]);

  const onSubmit = form.handleSubmit(
    (values) => {
      update.mutate({
        // Blank optionals are OMITTED from the payload: a blank secret keeps
        // the stored one; blank site key / email clear to "unset".
        ...(values.recaptchaSiteKey?.trim()
          ? { recaptchaSiteKey: values.recaptchaSiteKey.trim() }
          : {}),
        ...(values.recaptchaSecret?.trim()
          ? { recaptchaSecret: values.recaptchaSecret.trim() }
          : {}),
        recaptchaThreshold: values.recaptchaThreshold,
        ...(values.defaultNotificationEmail?.trim()
          ? { defaultNotificationEmail: values.defaultNotificationEmail.trim() }
          : {}),
        formsEnabled: values.formsEnabled,
      });
    },
    () => {
      form.setError('root', {
        type: 'validation',
        message: 'Some fields are invalid — check the highlighted inputs.',
      });
    },
  );

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  return (
    /* noValidate: validation is Zod's job — native number/step constraint
       checks would otherwise block submit (happy-dom's float step check is
       buggy: 0.3 % 0.05 !== 0 in float arithmetic). */
    <form onSubmit={onSubmit} noValidate>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 0 }}>
            Forms settings
          </Typography.Title>
          <Typography.Text type="secondary">
            Store-wide defaults — individual forms can override the notification recipient.
          </Typography.Text>
        </div>

        <Card
          title="reCAPTCHA v3"
          extra={
            <Typography.Text type="secondary">
              Leave blank to use the shared Ratio key
            </Typography.Text>
          }
        >
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <FieldRow label="Site key" error={form.formState.errors.recaptchaSiteKey?.message}>
              <Controller
                control={form.control}
                name="recaptchaSiteKey"
                render={({ field, fieldState }) => (
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    placeholder="6L…"
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>

            <FieldRow
              label="Secret key"
              error={form.formState.errors.recaptchaSecret?.message}
              hint={
                data?.hasRecaptchaSecret
                  ? 'A secret is saved. Enter a new value to replace it — leaving this blank keeps it.'
                  : 'Write-only: the secret is stored encrypted and never shown again.'
              }
            >
              <Controller
                control={form.control}
                name="recaptchaSecret"
                render={({ field, fieldState }) => (
                  <Input.Password
                    {...field}
                    value={field.value ?? ''}
                    autoComplete="new-password"
                    placeholder={data?.hasRecaptchaSecret ? '••••• saved' : 'reCAPTCHA secret'}
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>

            <FieldRow
              label="Score threshold"
              error={form.formState.errors.recaptchaThreshold?.message}
              hint="0–1. Submissions scoring below this are silently rejected as spam (default 0.30)."
            >
              <Controller
                control={form.control}
                name="recaptchaThreshold"
                render={({ field, fieldState }) => (
                  <Input
                    type="number"
                    role="spinbutton"
                    aria-label="Score threshold"
                    min={0}
                    max={1}
                    step={0.05}
                    style={{ maxWidth: 160 }}
                    value={field.value ?? ''}
                    onChange={(e) =>
                      field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                    }
                    onBlur={field.onBlur}
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>
          </Space>
        </Card>

        <Card title="Notifications">
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            {data?.emailBounced && (
              <Alert
                type="warning"
                showIcon
                message="Notification emails are bouncing"
                description="The default notification address bounced recently — check the mailbox or set a different address."
              />
            )}
            <FieldRow
              label="Default notification email"
              error={form.formState.errors.defaultNotificationEmail?.message}
              hint="Used when a form has no recipient of its own."
            >
              <Controller
                control={form.control}
                name="defaultNotificationEmail"
                render={({ field, fieldState }) => (
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    placeholder="leads@yourstore.in"
                    {...(fieldState.invalid ? { status: 'error' as const } : {})}
                  />
                )}
              />
            </FieldRow>
          </Space>
        </Card>

        <Card title="Kill switch">
          <Controller
            control={form.control}
            name="formsEnabled"
            render={({ field }) => (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Switch
                    aria-label="Forms enabled"
                    checked={field.value ?? true}
                    onChange={(checked) => {
                      if (!checked) {
                        // Disabling takes every form offline — confirm first.
                        setConfirmDisable(true);
                        return;
                      }
                      field.onChange(true);
                    }}
                  />
                  <Typography.Text>
                    {(field.value ?? true) ? 'Forms are enabled' : 'Forms are disabled'}
                  </Typography.Text>
                </div>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, display: 'block', marginTop: 8 }}
                >
                  Disabling makes every form show "temporarily unavailable" on your storefront and
                  pauses webhook deliveries until re-enabled.
                </Typography.Text>
                <Modal
                  open={confirmDisable}
                  title="Disable all forms?"
                  okText="Disable forms"
                  okButtonProps={{ danger: true }}
                  onOk={() => {
                    field.onChange(false);
                    setConfirmDisable(false);
                  }}
                  onCancel={() => setConfirmDisable(false)}
                >
                  <Typography.Paragraph>
                    Every form on your storefront will show "temporarily unavailable" and webhook
                    deliveries will pause. Submissions in flight are rejected. You can re-enable at
                    any time. Remember to Save after confirming.
                  </Typography.Paragraph>
                </Modal>
              </>
            )}
          />
        </Card>

        {form.formState.errors.root && (
          <Alert type="warning" message={form.formState.errors.root.message} showIcon />
        )}
        {update.error && <Alert type="error" message={(update.error as Error).message} showIcon />}
        {update.isSuccess && <Alert type="success" message="Saved." showIcon />}

        <div style={{ textAlign: 'right' }}>
          <PrimaryButton htmlType="submit" loading={update.isPending}>
            Save settings
          </PrimaryButton>
        </div>
      </Space>
    </form>
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
