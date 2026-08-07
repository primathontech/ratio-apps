import {
  Alert,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Table,
  Typography,
} from '@primathonos/orion';
import type { ClevertapDeliveryFailure, ClevertapDeliveryHealth } from '@/hooks/useDeliveryHealth';

interface Props {
  data: ClevertapDeliveryHealth | undefined;
  isLoading?: boolean;
  error?: Error | null;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const topicColumns = [
  { title: 'Topic', dataIndex: 'topic', key: 'topic' },
  { title: 'Sent', dataIndex: 'sent', key: 'sent' },
  { title: 'Failed', dataIndex: 'failed', key: 'failed' },
  { title: 'Skipped', dataIndex: 'skipped', key: 'skipped' },
  {
    title: 'Last',
    dataIndex: 'lastAt',
    key: 'lastAt',
    render: (v: unknown) => (v ? formatTimestamp(v as string) : '-'),
  },
];

const failureColumns = [
  {
    title: 'Time',
    dataIndex: 'sentAt',
    key: 'sentAt',
    render: (v: unknown) => formatTimestamp(v as string),
  },
  { title: 'Topic', dataIndex: 'topic', key: 'topic' },
  { title: 'Event', dataIndex: 'clevertapEvent', key: 'clevertapEvent' },
  {
    title: 'Error',
    dataIndex: 'error',
    key: 'error',
    render: (v: unknown) => (v as string | null) ?? '',
  },
];

export function DeliveryHealthPanel({ data, isLoading, error }: Props) {
  if (isLoading) {
    return (
      <Card title="Delivery health">
        <Typography.Text>Loading…</Typography.Text>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card title="Delivery health">
        <Alert
          type="warning"
          showIcon
          message="Couldn't load delivery health."
          description={error?.message}
        />
      </Card>
    );
  }

  if (data.total === 0) {
    return (
      <Card title="Delivery health">
        <Empty
          description={`No events forwarded to CleverTap in the last ${data.windowHours}h. Place a test order or load a storefront page with the script installed and this fills in.`}
        />
      </Card>
    );
  }

  return (
    <Card title={`Server-side delivery health (last ${data.windowHours}h)`}>
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Server-forwarded webhooks only. Client/pixel events fire browser→CleverTap and aren't
          counted here.
        </Typography.Text>
        <Row gutter={16}>
          <Col span={6}>
            <Statistic title="Sent" value={data.sent} />
          </Col>
          <Col span={6}>
            <Statistic title="Failed" value={data.failed} />
          </Col>
          <Col span={6}>
            <Statistic title="Skipped" value={data.skipped} />
          </Col>
          <Col span={6}>
            <Statistic
              title="Success rate"
              value={data.successRate === null ? '-' : `${data.successRate}%`}
            />
          </Col>
        </Row>

        <div>
          <Typography.Text strong>By topic</Typography.Text>
          <Table
            size="small"
            rowKey="topic"
            pagination={false}
            dataSource={data.perTopic}
            columns={topicColumns}
          />
        </div>

        {data.recentFailures.length > 0 && (
          <div>
            <Typography.Text strong>Recent failures</Typography.Text>
            <Table
              size="small"
              rowKey={(r) =>
                `${(r as ClevertapDeliveryFailure).topic}:${(r as ClevertapDeliveryFailure).sentAt}`
              }
              pagination={false}
              dataSource={data.recentFailures}
              columns={failureColumns}
            />
          </div>
        )}
      </Space>
    </Card>
  );
}
