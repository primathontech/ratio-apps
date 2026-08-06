import { Card, Space, Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { SyncActivityTable } from '@/components/SyncActivityTable';
import { useMerchant } from '@/hooks/useMerchant';

export const Route = createFileRoute('/failed-syncs')({ component: FailedSyncsPage });

export function FailedSyncsPage() {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Failed Syncs
        </Typography.Title>
        <Typography.Text type="secondary">
          Unicommerce sync events that failed — hover Details for the reason, retry where possible.
        </Typography.Text>
      </div>

      <Card>
        <SyncActivityTable
          merchantId={merchantId}
          result="failed"
          emptyDescription="No failed syncs — everything's healthy."
        />
      </Card>
    </Space>
  );
}
