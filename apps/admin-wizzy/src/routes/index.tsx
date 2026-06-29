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

export function Overview() {
  const config = useConfig();
  const _update = useUpdateConfig();
  const summary = useCatalogSummary();
  const forceSync = useForceSync();

  if (config.isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const data = config.data;

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
          Catalog sync status and storefront search — at a glance.
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
          <Card title="Storefront Search" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <div>
                <Tag color={data?.searchEnabled ? 'green' : 'default'}>
                  {data?.searchEnabled ? 'Enabled' : 'Disabled'}
                </Tag>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                The Wizzy search loader powers autocomplete and the faceted results page on your
                storefront. Configure the install snippet, selectors, and theme on the Storefront
                Search page.
              </Typography.Text>
              <Link to="/storefront">
                <PrimaryButton ghost>Manage Storefront Search</PrimaryButton>
              </Link>
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
