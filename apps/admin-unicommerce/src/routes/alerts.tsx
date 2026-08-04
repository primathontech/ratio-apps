import { useState } from 'react';
import { Alert, Button, Card, Empty, Space, Table, Tag, Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useMerchant } from '@/hooks/useMerchant';
import { type AlertRow, useAcknowledgeAlert, useAlerts } from '@/hooks/useUnicommerce';

export const Route = createFileRoute('/alerts')({ component: AlertsPage });

const PAGE_SIZE = 5;

const TYPE_LABEL: Record<AlertRow['type'], string> = {
  INBOUND_SILENCE: 'Inbound channel silent',
  STALE_ORDER: 'Order stuck',
};

// No per-admin-user identity exists in this app (session is per-merchant
// only, see lib/session.ts) — acknowledged_by records that SOMEONE from the
// Ratio admin acted on it, not which specific person.
const ACKNOWLEDGED_BY = 'admin';

export function AlertsPage() {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id;
  const [limit, setLimit] = useState(PAGE_SIZE);

  const alerts = useAlerts(merchantId);
  const acknowledge = useAcknowledgeAlert(merchantId);

  const allRows = alerts.data?.alerts ?? [];
  const visibleRows = allRows.slice(0, limit);
  const hasMore = allRows.length > limit;

  const columns = [
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (value: unknown) => TYPE_LABEL[value as AlertRow['type']] ?? (value as string),
    },
    {
      title: 'Affected order',
      dataIndex: 'reference',
      key: 'reference',
      render: (value: unknown) => (value as string | null) ?? 'connector-wide',
    },
    {
      title: 'Detected',
      dataIndex: 'detectedAt',
      key: 'detectedAt',
      render: (value: unknown) => new Date(value as string).toLocaleString(),
    },
    {
      title: 'Status',
      key: 'status',
      dataIndex: 'acknowledgedAt',
      render: (value: unknown) =>
        value ? <Tag color="default">Acknowledged</Tag> : <Tag color="orange">Active</Tag>,
    },
    {
      title: '',
      key: 'actions',
      dataIndex: 'id',
      render: (_value: unknown, record: unknown) => {
        const row = record as AlertRow;
        if (row.acknowledgedAt) return null;
        return (
          <Button
            size="small"
            loading={acknowledge.isPending && acknowledge.variables?.alertId === row.id}
            onClick={() => acknowledge.mutate({ alertId: row.id, acknowledgedBy: ACKNOWLEDGED_BY })}
          >
            Acknowledge
          </Button>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Alerts
        </Typography.Title>
        <Typography.Text type="secondary">
          Proactive detections — an order stuck without a status update, or Unicommerce going quiet
          on status notifications entirely. See a "connector-wide" alert together with stuck orders
          around the same time to spot a likely outage window.
        </Typography.Text>
      </div>

      <Card>
        {acknowledge.isError && (
          <Alert
            type="error"
            showIcon
            message="Acknowledge failed"
            description={(acknowledge.error as Error).message}
            style={{ marginBottom: 16 }}
          />
        )}

        {alerts.isError ? (
          <Alert
            type="error"
            showIcon
            message="Couldn't load alerts"
            description={(alerts.error as Error).message}
          />
        ) : (
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <Table
              rowKey="id"
              columns={columns}
              dataSource={visibleRows}
              loading={alerts.isLoading}
              pagination={false}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: <Empty description="No alerts — everything's healthy." /> }}
            />
            {hasMore && (
              <Button onClick={() => setLimit((l) => l + PAGE_SIZE)}>Show more</Button>
            )}
          </Space>
        )}
      </Card>
    </Space>
  );
}
