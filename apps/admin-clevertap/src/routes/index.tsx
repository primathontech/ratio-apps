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
import { useConfig } from '@/hooks/useConfig';
import { useDeliveryHealth } from '@/hooks/useDeliveryHealth';
import { useStatus } from '@/hooks/useStatus';

export const Route = createFileRoute('/')({ component: Overview });

function formatTs(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function Overview() {
  const config = useConfig();
  const status = useStatus();
  const health = useDeliveryHealth();

  if (config.isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const data = config.data;
  const s = status.data;
  const h = health.data;
  const paused = data?.clevertapEnabled === false;
  const configComplete = !!data?.accountId?.length;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          CleverTap for Ratio
        </Typography.Title>
        <Typography.Text type="secondary">
          Storefront behaviour and purchases forwarded to your CleverTap project, at a glance.
        </Typography.Text>
      </div>

      {paused && (
        <Alert
          type="warning"
          showIcon
          message="CleverTap is paused for this merchant"
          description="The kill switch is off. Pixel and webhooks are not sending. Re-enable it on the Config page."
        />
      )}

      {s?.lastError && (
        <Alert
          type="error"
          showIcon
          message="The most recent forward failed"
          description={s.lastError}
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card title="Connection" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <div>
                <Typography.Text type="secondary">Account ID</Typography.Text>
                <div>
                  <Typography.Text code>{data?.accountId || 'Not set'}</Typography.Text>
                </div>
              </div>
              <div>
                <Typography.Text type="secondary">Region: </Typography.Text>
                <Typography.Text code>{data?.region || 'Not set'}</Typography.Text>
              </div>
              <Space wrap size={4}>
                {paused ? (
                  <Tag color="orange">Paused</Tag>
                ) : configComplete ? (
                  <Tag color="green">Connected</Tag>
                ) : (
                  <Tag>Not configured</Tag>
                )}
                <Tag color={data?.serverEventsEnabled ? 'green' : 'default'}>
                  Server events {data?.serverEventsEnabled ? 'on' : 'off'}
                </Tag>
              </Space>
              <Link to="/config">
                <PrimaryButton>Configure</PrimaryButton>
              </Link>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card title="Server-side delivery (24h)" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Server-forwarded webhooks only. Client/pixel events fire browser→CleverTap and
                aren't counted here.
              </Typography.Text>
              <Row gutter={8}>
                <Col span={8}>
                  <Statistic title="Sent" value={h?.sent ?? 0} />
                </Col>
                <Col span={8}>
                  <Statistic title="Failed" value={h?.failed ?? 0} />
                </Col>
                <Col span={8}>
                  <Statistic title="Skipped" value={h?.skipped ?? 0} />
                </Col>
              </Row>
              <div>
                <Typography.Text type="secondary">Success rate: </Typography.Text>
                <Typography.Text>
                  {h?.successRate == null ? 'n/a' : `${h.successRate}%`}
                </Typography.Text>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Last event: {formatTs(s?.lastEventAt)}
                {s?.lastEventTopic ? ` (${s.lastEventTopic})` : ''}
              </Typography.Text>
              <Link to="/health">
                <PrimaryButton ghost>View Health</PrimaryButton>
              </Link>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card title="Catalog" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <div>
                <Typography.Text type="secondary">Catalog name</Typography.Text>
                <div>
                  <Typography.Text code>{data?.catalogName || 'Not set'}</Typography.Text>
                </div>
              </div>
              <div>
                <Tag color={data?.catalogSyncEnabled ? 'green' : 'default'}>
                  {data?.catalogSyncEnabled ? 'Sync on' : 'Sync off'}
                </Tag>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Products full-sync to CleverTap on change.
              </Typography.Text>
              <Link to="/config">
                <PrimaryButton ghost>Configure</PrimaryButton>
              </Link>
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
