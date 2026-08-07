import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  PrimaryButton,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from '@primathonos/orion';
import {
  CLEVERTAP_REGIONS,
  type ClevertapRegion,
  DEFAULT_CLEVERTAP_REGION,
} from '@shared/constants/clevertap-events';
import type { ClevertapConfigInput } from '@shared/schemas/clevertap-config';
import { clevertapConfigInputSchema } from '@shared/schemas/clevertap-config';
import { buildDefaultEventMap } from '@shared/schemas/event-map';
import { useEffect, useState } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useConfig, useSyncCatalog, useUpdateConfig } from '@/hooks/useConfig';

function formatSyncTs(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const SYNC_TAG_COLOR = { sent: 'green', skipped: 'default', failed: 'red' } as const;
const SYNC_ALERT_TYPE = { sent: 'success', skipped: 'info', failed: 'error' } as const;

function syncResultMessage(r: {
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  itemCount?: number;
}): string {
  if (r.status === 'sent') return `Synced ${r.itemCount ?? 0} products to CleverTap.`;
  if (r.status === 'skipped') return `Sync skipped${r.reason ? `: ${r.reason}` : ''}.`;
  return `Sync failed${r.reason ? `: ${r.reason}` : ''}.`;
}

export const REGION_OPTIONS = (Object.keys(CLEVERTAP_REGIONS) as ClevertapRegion[]).map((k) => ({
  value: k,
  label: CLEVERTAP_REGIONS[k].label,
}));

type ConfigInput = z.input<typeof clevertapConfigInputSchema>;
type ConfigOutput = z.output<typeof clevertapConfigInputSchema>;

const PASSCODE_PLACEHOLDER = 'Enter CleverTap Passcode';

export function ConfigPage() {
  const { data, isLoading } = useConfig();
  const update = useUpdateConfig();
  const syncCatalog = useSyncCatalog();
  const [confirmPause, setConfirmPause] = useState(false);

  const form = useForm<ConfigInput, unknown, ConfigOutput>({
    resolver: zodResolver(clevertapConfigInputSchema),
    defaultValues: {
      accountId: '',
      passcode: undefined,
      region: DEFAULT_CLEVERTAP_REGION,
      debug: false,
      serverEventsEnabled: false,
      clevertapEnabled: true,
      catalogName: '',
      catalogEmail: '',
      catalogSyncEnabled: false,
      chargedSource: 'server',
      events: buildDefaultEventMap('clevertap'),
    },
  });

  useEffect(() => {
    if (!data) return;
    form.reset({
      accountId: data.accountId,
      passcode: undefined,
      region: data.region,
      debug: data.debug,
      serverEventsEnabled: data.serverEventsEnabled,
      clevertapEnabled: data.clevertapEnabled,
      catalogName: data.catalogName ?? '',
      catalogEmail: data.catalogEmail ?? '',
      catalogSyncEnabled: data.catalogSyncEnabled ?? false,
      chargedSource: data.chargedSource ?? 'server',
      events: { ...buildDefaultEventMap('clevertap'), ...(data.events ?? {}) },
    });
  }, [data, form]);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const passcodeSet = !!data?.passcodeSet;
  const selectedRegion = (form.watch('region') ?? DEFAULT_CLEVERTAP_REGION) as ClevertapRegion;
  const dashboardUrl = CLEVERTAP_REGIONS[selectedRegion]?.dashboard ?? '';
  const killEnabled = (form.watch('clevertapEnabled') ?? true) as boolean;
  const serverOn = (form.watch('serverEventsEnabled') ?? false) as boolean;
  const chargedSourceVal = (form.watch('chargedSource') ?? 'server') as 'server' | 'client';
  const chargedServerButOff = chargedSourceVal === 'server' && !serverOn;
  const catalogSyncReady = Boolean(
    data?.catalogSyncEnabled && data?.accountId && data?.catalogName && data?.catalogEmail,
  );
  const lastSyncStatus = data?.lastCatalogSyncStatus ?? null;

  const onSubmit = form.handleSubmit(
    (values) => {
      const payload: ClevertapConfigInput = { ...values };
      if (!payload.passcode) {
        delete payload.passcode;
      }
      update.mutate(payload);
    },
    (errors) => {
      // eslint-disable-next-line no-console
      console.warn('CleverTap config form validation failed:', errors);
      form.setError('root', {
        type: 'validation',
        message:
          'Form has invalid fields. Check the highlighted inputs (or open DevTools console for details).',
      });
    },
  );

  const clearPasscode = () => {
    if (!data) return;
    update.mutate({
      accountId: data.accountId,
      region: data.region,
      debug: data.debug,
      serverEventsEnabled: false,
      events: data.events,
      passcode: '',
    });
  };

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit}>
        <Space direction="vertical" size="large" style={{ display: 'flex' }}>
          <Card
            title="CleverTap credentials"
            extra={
              <Typography.Text type="secondary">
                CleverTap → Settings → Project → Account ID &amp; Passcode
              </Typography.Text>
            }
          >
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <FieldRow
                label="Account ID"
                error={form.formState.errors.accountId?.message}
                hint="Not a secret. It ships to the browser in the storefront pixel."
              >
                <Controller
                  control={form.control}
                  name="accountId"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="ACCOUNT-ID-HERE"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Passcode"
                error={form.formState.errors.passcode?.message}
                hint={
                  passcodeSet
                    ? 'Stored encrypted and never displayed back. Type a value only to rotate it.'
                    : 'Stored encrypted, never displayed back, and never sent to the storefront. Required for server-side events.'
                }
              >
                <Controller
                  control={form.control}
                  name="passcode"
                  render={({ field }) => (
                    <Input.Password
                      {...field}
                      value={field.value ?? ''}
                      placeholder={PASSCODE_PLACEHOLDER}
                      autoComplete="new-password"
                    />
                  )}
                />
                {passcodeSet && (
                  <div style={{ marginTop: 8 }}>
                    <Alert
                      type="success"
                      showIcon
                      message="Passcode saved. Leave blank to keep."
                      description="Saving this form without typing a passcode leaves the stored credential untouched."
                      action={
                        <Button
                          danger
                          size="small"
                          onClick={clearPasscode}
                          loading={update.isPending}
                        >
                          Clear passcode
                        </Button>
                      }
                    />
                  </div>
                )}
              </FieldRow>

              <FieldRow
                label="Region"
                error={form.formState.errors.region?.message}
                hint={
                  dashboardUrl
                    ? `Dashboard: ${dashboardUrl}. Confirm this is where your CleverTap account lives.`
                    : undefined
                }
              >
                <Controller
                  control={form.control}
                  name="region"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onChange={field.onChange}
                      options={REGION_OPTIONS}
                      aria-label="Region"
                      style={{ width: '100%' }}
                    />
                  )}
                />
              </FieldRow>
            </Space>
          </Card>

          <Card title="Server-side events">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <div>
                <Controller
                  control={form.control}
                  name="serverEventsEnabled"
                  render={({ field }) => (
                    <Checkbox
                      checked={(field.value ?? false) && passcodeSet}
                      disabled={!passcodeSet}
                      onChange={(e) => field.onChange(e.target.checked)}
                    >
                      Enable server-side events
                    </Checkbox>
                  )}
                />
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, display: 'block', marginTop: 4 }}
                >
                  {passcodeSet
                    ? 'Forwards events from the server, so they survive ad blockers and closed tabs.'
                    : 'Save a Passcode first. Server-side forwarding needs the Events API credential.'}
                </Typography.Text>
              </div>

              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                  Send Purchase (Charged) from
                </Typography.Text>
                <Controller
                  control={form.control}
                  name="chargedSource"
                  render={({ field }) => (
                    <Segmented
                      value={field.value ?? 'server'}
                      onChange={(v) => field.onChange(v)}
                      options={[
                        {
                          label: 'Server-side (orders/paid)',
                          value: 'server',
                          disabled: !serverOn,
                        },
                        { label: 'Client-side (pixel)', value: 'client' },
                      ]}
                    />
                  )}
                />
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, display: 'block', marginTop: 4 }}
                >
                  Charged is sent by only one path, so revenue is never counted twice. Server-side
                  survives ad blockers and closed tabs; client-side fires from the storefront pixel.
                  {!serverOn && ' Enable server-side events above to choose Server-side.'}
                </Typography.Text>
                {chargedServerButOff && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type="warning"
                    showIcon
                    message="Charged is not being sent"
                    description="Charged source is Server-side but server-side events are off, so neither path sends it. Enable server-side events above, or switch to Client-side."
                  />
                )}
              </div>
            </Space>
          </Card>

          <Card title="Product catalog">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <FieldRow label="Catalog name" error={form.formState.errors.catalogName?.message}>
                <Controller
                  control={form.control}
                  name="catalogName"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="products"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <FieldRow
                label="Catalog admin email"
                error={form.formState.errors.catalogEmail?.message}
                hint="Must be a user with access to your CleverTap dashboard. CleverTap rejects the upload if the email isn't a known project user."
              >
                <Controller
                  control={form.control}
                  name="catalogEmail"
                  render={({ field, fieldState }) => (
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="admin@example.com"
                      {...(fieldState.invalid ? { status: 'error' as const } : {})}
                    />
                  )}
                />
              </FieldRow>

              <Controller
                control={form.control}
                name="catalogSyncEnabled"
                render={({ field }) => (
                  <Checkbox
                    checked={field.value ?? false}
                    onChange={(e) => field.onChange(e.target.checked)}
                  >
                    Enable catalog sync
                  </Checkbox>
                )}
              />

              <div>
                <Space wrap size="small" style={{ alignItems: 'center' }}>
                  <Button
                    onClick={() => syncCatalog.mutate()}
                    loading={syncCatalog.isPending}
                    disabled={!catalogSyncReady || syncCatalog.isPending}
                  >
                    Sync now
                  </Button>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {lastSyncStatus ? (
                      <>
                        Last synced: {formatSyncTs(data?.lastCatalogSyncAt)}
                        {typeof data?.lastCatalogSyncCount === 'number'
                          ? ` · ${data.lastCatalogSyncCount} items`
                          : ''}{' '}
                        <Tag color={SYNC_TAG_COLOR[lastSyncStatus]}>{lastSyncStatus}</Tag>
                      </>
                    ) : (
                      'Never synced.'
                    )}
                  </Typography.Text>
                </Space>
                {!catalogSyncReady && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, display: 'block', marginTop: 4 }}
                  >
                    Fill in the catalog name and email, enable sync, and Save before syncing.
                  </Typography.Text>
                )}
                {syncCatalog.data && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type={SYNC_ALERT_TYPE[syncCatalog.data.status]}
                    showIcon
                    message={syncResultMessage(syncCatalog.data)}
                  />
                )}
                {syncCatalog.error && (
                  <Alert
                    style={{ marginTop: 8 }}
                    type="error"
                    showIcon
                    message={(syncCatalog.error as Error).message}
                  />
                )}
              </div>
            </Space>
          </Card>

          <Card
            title="Kill switch"
            style={{ borderColor: killEnabled ? '#ffccc7' : '#ff4d4f', borderWidth: 2 }}
            extra={
              <Tag color={killEnabled ? 'green' : 'red'}>{killEnabled ? 'Active' : 'Paused'}</Tag>
            }
          >
            <Controller
              control={form.control}
              name="clevertapEnabled"
              render={({ field }) => (
                <>
                  <Checkbox
                    checked={field.value ?? true}
                    onChange={(e) => {
                      if (e.target.checked) field.onChange(true);
                      else setConfirmPause(true);
                    }}
                  >
                    Enable CleverTap for this merchant
                  </Checkbox>
                  <Modal
                    open={confirmPause}
                    title="Pause CleverTap for this merchant?"
                    okText="Pause CleverTap"
                    okButtonProps={{ danger: true }}
                    cancelText="Keep enabled"
                    onOk={() => {
                      field.onChange(false);
                      setConfirmPause(false);
                    }}
                    onCancel={() => setConfirmPause(false)}
                  >
                    This stops the pixel and all server webhooks from sending to CleverTap. Only do
                    this to pause a rollout or during an incident. You can re-enable it anytime,
                    then Save.
                  </Modal>
                </>
              )}
            />
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, display: 'block', marginTop: 4 }}
            >
              Rollout kill switch. Turn off to pause CleverTap for this merchant: pixel and webhooks
              stop, but settings stay editable.
            </Typography.Text>
          </Card>

          <Card title="Debugging">
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
              Save credentials
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
