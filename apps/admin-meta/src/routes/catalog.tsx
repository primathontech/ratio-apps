import {
  Alert,
  Button,
  Card,
  Dropdown,
  Input,
  MoreOutlined,
  Popover,
  PrimaryButton,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@primathonos/orion';
import type { ComponentProps } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  type CatalogSyncRun,
  type WebhookDelivery,
  useCatalogConfig,
  useCatalogStatus,
  useSaveCatalogConfig,
  useStopSync,
  useSyncNow,
  useWebhookDeliveries,
} from '@/hooks/useCatalog';
import { useMerchant } from '@/hooks/useMerchant';

export const Route = createFileRoute('/catalog')({ component: CatalogPage });

const STATUS_COLOR: Record<string, string> = {
  running: 'processing',
  success: 'success',
  partial: 'warning',
  failed: 'error',
  cancelled: 'default',
  interrupted: 'default',
};

// Orion's Table erases the row generic — `render`/`rowKey` hand back `unknown`.
// Narrow to the real row type once, here, instead of casting field-by-field.
const asRun = (record: unknown): CatalogSyncRun => record as CatalogSyncRun;
const asDelivery = (record: unknown): WebhookDelivery => record as WebhookDelivery;

const DELIVERY_STATUS_COLOR: Record<string, string> = {
  sent: 'success',
  partial: 'warning',
  skipped: 'default',
  ignored: 'default',
  failed: 'error',
};

const EVENT_LABEL: Record<string, string> = {
  'product.created': 'Created',
  'product.updated': 'Updated',
  'product.deleted': 'Deleted',
};

const DELIVERY_COLUMNS: ComponentProps<typeof Table>['columns'] = [
  {
    key: 'createdAt',
    title: 'Time',
    dataIndex: 'createdAt',
    render: (_value, record) => {
      const { createdAt } = asDelivery(record);
      return createdAt ? new Date(createdAt).toLocaleString() : '—';
    },
  },
  {
    key: 'eventType',
    title: 'Event',
    dataIndex: 'eventType',
    render: (_value, record) => {
      const { eventType } = asDelivery(record);
      return <Tag>{EVENT_LABEL[eventType ?? ''] ?? eventType ?? '—'}</Tag>;
    },
  },
  {
    key: 'productTitle',
    title: 'Product',
    dataIndex: 'productTitle',
    render: (_value, record) => {
      const { productTitle, productId } = asDelivery(record);
      return productTitle ?? <Typography.Text type="secondary">{productId}</Typography.Text>;
    },
  },
  {
    key: 'status',
    title: 'Status',
    dataIndex: 'status',
    render: (_value, record) => {
      const { status, reason } = asDelivery(record);
      const tag = <Tag color={DELIVERY_STATUS_COLOR[status ?? ''] ?? 'default'}>{status}</Tag>;
      return reason ? <Tooltip title={reason}>{tag}</Tooltip> : tag;
    },
  },
  {
    key: 'sentCount',
    title: 'Sent',
    dataIndex: 'sentCount',
  },
  {
    key: 'failedCount',
    title: 'Failed',
    dataIndex: 'failedCount',
    render: (_value, record) => {
      const { failedCount } = asDelivery(record);
      return failedCount ? <Typography.Text type="danger">{failedCount}</Typography.Text> : 0;
    },
  },
];

const SYNC_COLUMNS: ComponentProps<typeof Table>['columns'] = [
  { key: 'trigger', title: 'Trigger', dataIndex: 'trigger' },
  {
    key: 'status',
    title: 'Status',
    dataIndex: 'status',
    render: (_value, record) => {
      const status = asRun(record).status ?? '';
      return <Tag color={STATUS_COLOR[status] ?? 'default'}>{status}</Tag>;
    },
  },
  { key: 'totalProducts', title: 'Active', dataIndex: 'totalProducts' },
  { key: 'successCount', title: 'Synced', dataIndex: 'successCount' },
  {
    key: 'errorCount',
    title: 'Errors',
    dataIndex: 'errorCount',
    render: (_value, record) => {
      const r = asRun(record);
      const n = r.errorCount ?? 0;
      if (!n) return 0;
      const errs = r.errors ?? [];
      if (!errs.length) return n; // count only (e.g. older runs with no detail)
      return (
        <Popover
          title={`${n} failed`}
          content={
            <div style={{ maxWidth: 440, maxHeight: 300, overflow: 'auto' }}>
              {errs.map((e) => (
                <div key={e.retailerId} style={{ marginBottom: 6, fontSize: 12 }}>
                  <Typography.Text code>{e.retailerId}</Typography.Text>
                  <div style={{ color: '#d93025' }}>{e.error}</div>
                </div>
              ))}
            </div>
          }
        >
          <Typography.Link>{n}</Typography.Link>
        </Popover>
      );
    },
  },
  {
    key: 'startedAt',
    title: 'Started',
    dataIndex: 'startedAt',
    render: (_value, record) => {
      const { startedAt } = asRun(record);
      return startedAt ? new Date(startedAt).toLocaleString() : '—';
    },
  },
];

function CatalogPage() {
  const { data: config, isLoading } = useCatalogConfig();
  const { data: merchant } = useMerchant();
  const save = useSaveCatalogConfig();
  const syncNow = useSyncNow();
  const stopSync = useStopSync();

  const { data: deliveries } = useWebhookDeliveries();

  const [catalogId, setCatalogId] = useState('');
  const [catalogAccessToken, setCatalogAccessToken] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!config) return;
    setCatalogId(config.catalogId ?? '');
    setSyncEnabled(config.syncEnabled);
  }, [config]);

  // Poll sync runs only while catalog is configured.
  const { data: status } = useCatalogStatus(Boolean(config?.catalogId));
  const isRunning = status?.runs?.[0]?.status === 'running';
  const runs = status?.runs ?? [];
  const visibleRuns = showAll ? runs.slice(0, 10) : runs.slice(0, 5);

  if (isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const onSave = () => {
    const input: { catalogId?: string; catalogAccessToken?: string; syncEnabled?: boolean } = {
      catalogId,
      syncEnabled,
    };
    // Only send the token when the user actually typed one (avoid wiping it).
    if (catalogAccessToken) input.catalogAccessToken = catalogAccessToken;
    save.mutate(input, { onSuccess: () => setCatalogAccessToken('') });
  };

  const feedUrl =
    merchant?.id && config?.feedToken
      ? `${apiRoot()}/meta/feed/${merchant.id}.xml?token=${config.feedToken}`
      : null;
  // Static receiver URL — merchant pastes this into the Ratio marketplace app
  // config so product create/update/delete events reach us (merchant id comes
  // via the gk-merchant-id header / payload, so no id in the URL).
  const webhookUrl = `${apiRoot()}/meta/api/v1/webhooks/products`;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <Card
        title="Catalog sync"
        extra={
          <Typography.Text type="secondary">
            Commerce Manager → Catalog → Settings → Catalog ID + system-user token
          </Typography.Text>
        }
      >
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <Field
            label="Catalog ID"
            hint="The numeric ID of your Meta product catalog (Commerce Manager)."
          >
            <Input
              value={catalogId}
              onChange={(e) => setCatalogId(e.target.value)}
              placeholder="1234567890"
            />
          </Field>

          <Field
            label="Catalog access token"
            hint={
              config?.hasCatalogToken
                ? 'A token is already saved. Leave blank to keep it, or paste a new one to replace.'
                : 'System-user token with catalog_management scope (separate from the CAPI token).'
            }
          >
            <Input.Password
              value={catalogAccessToken}
              onChange={(e) => setCatalogAccessToken(e.target.value)}
              placeholder={config?.hasCatalogToken ? '•••••••• (saved)' : 'EAA…'}
            />
          </Field>

          <Field label="Enable sync" hint="Turning this on runs the first full sync automatically.">
            <Switch checked={syncEnabled} onChange={setSyncEnabled} />
          </Field>

          {save.error && <Alert type="error" message={(save.error as Error).message} showIcon />}
          {save.isSuccess && (
            <Alert
              type="success"
              message={
                save.data?.initialSyncStarted
                  ? 'Saved. Initial full sync started.'
                  : 'Saved.'
              }
              showIcon
            />
          )}

          <div style={{ textAlign: 'right' }}>
            <Space>
              {isRunning ? (
                <PrimaryButton
                  onClick={() => stopSync.mutate()}
                  loading={stopSync.isPending}
                  danger
                  ghost
                >
                  Stop Sync
                </PrimaryButton>
              ) : (
                <Space.Compact>
                  <PrimaryButton
                    onClick={() => syncNow.mutate(false)}
                    loading={syncNow.isPending}
                    disabled={!config?.catalogId || !config?.hasCatalogToken}
                    ghost
                  >
                    Sync Now
                  </PrimaryButton>
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'force', label: 'Force resync (re-send all products)' },
                      ],
                      onClick: ({ key }: { key: string }) => {
                        if (key === 'force') syncNow.mutate(true);
                      },
                    }}
                  >
                    <PrimaryButton
                      ghost
                      icon={<MoreOutlined />}
                      disabled={!config?.catalogId || !config?.hasCatalogToken}
                      aria-label="more sync options"
                    />
                  </Dropdown>
                </Space.Compact>
              )}
              <PrimaryButton onClick={onSave} loading={save.isPending} disabled={!catalogId}>
                Save
              </PrimaryButton>
            </Space>
          </div>
          {syncNow.isSuccess && !isRunning && (
            <Alert type="info" message="Sync started in background." showIcon />
          )}
          {stopSync.isSuccess && (
            <Alert type="warning" message="Stop requested — sync will halt after the current page." showIcon />
          )}
        </Space>
      </Card>

      {feedUrl && (
        <Card title="Data feed URL" size="small">
          <Typography.Paragraph
            copyable
            code
            style={{ wordBreak: 'break-all', marginBottom: 0 }}
          >
            {feedUrl}
          </Typography.Paragraph>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Add this as a scheduled data feed in Commerce Manager (Meta pulls it).
          </Typography.Text>
        </Card>
      )}

      <Card title="Product webhook URL" size="small">
        <Typography.Paragraph copyable code style={{ wordBreak: 'break-all', marginBottom: 0 }}>
          {webhookUrl}
        </Typography.Paragraph>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Paste this into your Ratio marketplace app config (product created / updated /
          deleted events) for real-time catalog updates. Optional — the scheduled feed
          above keeps the catalog in sync on its own.
        </Typography.Text>
      </Card>

      <Card title="Recent syncs" size="small">
        <Table
          rowKey={(record) => String(asRun(record).id)}
          dataSource={visibleRuns}
          pagination={false}
          size="small"
          locale={{ emptyText: 'No syncs yet' }}
          columns={SYNC_COLUMNS}
        />
        {runs.length > 5 && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <Button type="link" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show less' : `Show more (${Math.min(runs.length, 10) - 5})`}
            </Button>
          </div>
        )}
      </Card>

      <Card
        title="Webhook deliveries"
        size="small"
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Last 50 product webhook events pushed to Facebook
          </Typography.Text>
        }
      >
        <Table
          rowKey={(record) => String(asDelivery(record).id)}
          dataSource={deliveries ?? []}
          pagination={false}
          size="small"
          locale={{ emptyText: 'No webhook events received yet' }}
          columns={DELIVERY_COLUMNS}
          scroll={{ x: true }}
        />
      </Card>
    </Space>
  );
}

// The feed is served by the backend root, not the /meta API subpath, so derive
// the origin from VITE_API_BASE_URL directly.
function apiRoot(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
        {label}
      </Typography.Text>
      {children}
      {hint && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {hint}
        </Typography.Text>
      )}
    </div>
  );
}
