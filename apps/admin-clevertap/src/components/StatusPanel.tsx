import { Alert, Card, Descriptions, Empty, Space, Tag, Typography } from '@primathonos/orion';
import type { ClevertapStatus } from '@/hooks/useStatus';

interface Props {
  status: ClevertapStatus | undefined;
  isLoading?: boolean;
  error?: Error | null;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function StatusPanel({ status, isLoading, error }: Props) {
  if (isLoading) {
    return (
      <Card title="Readiness">
        <Typography.Text>Loading…</Typography.Text>
      </Card>
    );
  }

  if (error || !status) {
    return (
      <Card title="Readiness">
        <Alert
          type="warning"
          showIcon
          message="Couldn't load the delivery status."
          description={error?.message}
        />
      </Card>
    );
  }

  const noEventsYet = !status.lastEventAt;

  return (
    <Card title="Readiness">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Configuration">
            {status.configComplete ? (
              <Tag color="green">Complete</Tag>
            ) : (
              <Tag color="orange">Account ID missing</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Server-side order events">
            {status.serverEventsEnabled ? <Tag color="green">On</Tag> : <Tag>Off</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Last event forwarded">
            {noEventsYet ? (
              <Typography.Text type="secondary">Never</Typography.Text>
            ) : (
              <>
                {formatTimestamp(status.lastEventAt as string)}
                {status.lastEventTopic ? (
                  <Typography.Text type="secondary"> · {status.lastEventTopic}</Typography.Text>
                ) : null}
              </>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Forwarded (last 24h)">
            {status.forwardedCount24h}
          </Descriptions.Item>
        </Descriptions>

        {noEventsYet && (
          <Empty description="No events forwarded to CleverTap yet. Place a test order (or load a storefront page with the script installed) and this panel will fill in." />
        )}

        {status.lastError && (
          <Alert
            type="error"
            showIcon
            message="The most recent forward failed"
            description={status.lastError}
          />
        )}
      </Space>
    </Card>
  );
}
