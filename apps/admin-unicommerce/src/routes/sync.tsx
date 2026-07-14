import { Card, Space, Tag, Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { useSyncStatus } from '@/hooks/useUnicommerce';

export const Route = createFileRoute('/sync')({ component: SyncQueue });

function SyncQueue() {
  const token = useMerchantStore((s) => s.token);
  const merchantId = token ?? undefined;
  const status = useSyncStatus(merchantId);

  if (status.isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const failedItems = status.data?.failedItems ?? [];

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <Typography.Title level={3}>Sync Queue</Typography.Title>

      <Card>
        {failedItems.length === 0 ? (
          <Typography.Text type="secondary">No failed items.</Typography.Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {failedItems.map((item) => (
              <Card key={item.id} size="small" style={{ padding: 12 }}>
                <Space direction="vertical" size="small" style={{ display: 'flex' }}>
                  <Typography.Text strong>Order: {item.orderId}</Typography.Text>
                  <Typography.Text>Type: {item.syncType}</Typography.Text>
                  <Typography.Text type="danger">Error: {item.lastError}</Typography.Text>
                  <Typography.Text>
                    Retries: <Tag color={item.retryCount > 3 ? 'red' : 'orange'}>{item.retryCount}</Tag>
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    Last: {new Date(item.updatedAt).toLocaleString()}
                  </Typography.Text>
                </Space>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </Space>
  );
}
