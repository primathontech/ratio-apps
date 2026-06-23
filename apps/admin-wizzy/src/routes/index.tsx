import {
  Alert,
  Card,
  Col,
  PrimaryButton,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from '@primathonos/orion';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCatalogSummary, useForceSync } from '@/hooks/useCatalog';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';

export const Route = createFileRoute('/')({ component: Overview });

const SCRIPT_TAG_STATUS_COLOR: Record<string, string> = {
  active: 'green',
  pending_api: 'blue',
  error: 'red',
  disabled: 'default',
};

const SCRIPT_TAG_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  pending_api: 'Pending API',
  error: 'Error',
  disabled: 'Disabled',
};

export function Overview() {
  const config = useConfig();
  const _update = useUpdateConfig();
  const summary = useCatalogSummary();
  const forceSync = useForceSync();

  if (config.isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const data = config.data;
  const scriptTagStatus = data?.scriptTagStatus ?? 'disabled';

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Wizzy AI Search for Ratio
        </Typography.Title>
        <Typography.Text type="secondary">
          Catalog sync status and storefront SDK — at a glance.
        </Typography.Text>
      </div>

      {data?.needsReconnect && (
        <Alert
          type="warning"
          showIcon
          message="Wizzy connection needs attention"
          description="Your Ratio OAuth authorization expired or was revoked. Reconnect from the Ratio dashboard."
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="Catalog Sync" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <Row gutter={8}>
                <Col span={8}>
                  <Statistic title="Synced" value={summary.data?.synced ?? 0} />
                </Col>
                <Col span={8}>
                  <Statistic title="Pending" value={summary.data?.pending ?? 0} />
                </Col>
                <Col span={8}>
                  <Statistic title="Errors" value={summary.data?.error ?? 0} />
                </Col>
              </Row>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Last bulk sync:{' '}
                {summary.data?.lastBulkSyncAt
                  ? new Date(summary.data.lastBulkSyncAt).toLocaleString()
                  : 'never'}
              </Typography.Text>
              <Space wrap>
                <PrimaryButton loading={forceSync.isPending} onClick={() => forceSync.mutate()}>
                  Force Sync Now
                </PrimaryButton>
                <Link to="/catalog">
                  <PrimaryButton ghost>View Catalog Details</PrimaryButton>
                </Link>
                <Link to="/config">
                  <PrimaryButton ghost>Settings</PrimaryButton>
                </Link>
              </Space>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title="Storefront SDK (ScriptTag)" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <div>
                <Tag color={SCRIPT_TAG_STATUS_COLOR[scriptTagStatus] ?? 'default'}>
                  {SCRIPT_TAG_STATUS_LABEL[scriptTagStatus] ?? scriptTagStatus}
                </Tag>
              </div>
              {data?.sdkUrl && (
                <div>
                  <Typography.Text type="secondary">SDK URL</Typography.Text>
                  <div>
                    <Typography.Text code style={{ wordBreak: 'break-all', fontSize: 11 }}>
                      {data.sdkUrl}
                    </Typography.Text>
                  </div>
                </div>
              )}
              {scriptTagStatus === 'pending_api' && (
                <Alert
                  type="info"
                  showIcon
                  message="ScriptTag API pending"
                  description="The Ratio ScriptTag API is not yet generally available. The SDK will be registered automatically once the API lands — no action needed."
                />
              )}
              {scriptTagStatus === 'error' && (
                <Alert
                  type="error"
                  showIcon
                  message="SDK registration failed"
                  description="Check your Wizzy Store ID and Secret, then re-save the configuration."
                />
              )}
              {scriptTagStatus === 'disabled' && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Enable the Wizzy integration on the <Link to="/config">Config page</Link> to
                  register the SDK.
                </Typography.Text>
              )}
              <Link to="/install">
                <PrimaryButton ghost>Installation guide</PrimaryButton>
              </Link>
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
