import { Card, Space, Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { SyncActivityTable } from '@/components/SyncActivityTable';
import { useMerchant } from '@/hooks/useMerchant';

export const Route = createFileRoute('/sync')({ component: SyncActivityPage });

export function SyncActivityPage() {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          All Activity
        </Typography.Title>
        <Typography.Text type="secondary">
          Inbound and outbound Unicommerce sync events for this merchant, including Ratio webhook
          deliveries.
        </Typography.Text>
      </div>

      <Card>
        <SyncActivityTable
          merchantId={merchantId}
          emptyDescription="No sync activity yet. Connect Unicommerce to begin."
        />
      </Card>
    </Space>
  );
}
