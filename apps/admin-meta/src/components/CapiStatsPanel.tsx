import { Card, Space, Statistic, Table, Tag, Typography } from '@primathonos/orion';
import type { ComponentProps } from 'react';
import { type FailureBreakdown, useCapiStats } from '@/hooks/useCapiStats';

// Friendly labels + colors for the bounded reason codes from the backend.
const REASON_META: Record<string, { label: string; color: string }> = {
  rate_limited: { label: 'Rate limited', color: 'orange' },
  invalid_request: { label: 'Invalid request', color: 'red' },
  auth: { label: 'Auth / token', color: 'volcano' },
  timeout: { label: 'Timeout', color: 'gold' },
  server_error: { label: 'Meta server error', color: 'magenta' },
  unknown: { label: 'Unknown', color: 'default' },
};

function reasonMeta(reason: string): { label: string; color: string } {
  return REASON_META[reason] ?? { label: reason || 'Unknown', color: 'default' };
}

const asFailure = (r: unknown): FailureBreakdown => r as FailureBreakdown;

const FAILURE_COLUMNS: ComponentProps<typeof Table>['columns'] = [
  {
    key: 'reason',
    title: 'Reason',
    dataIndex: 'reason',
    render: (_v, record) => {
      const meta = reasonMeta(asFailure(record).reason);
      return <Tag color={meta.color}>{meta.label}</Tag>;
    },
  },
  {
    key: 'events',
    title: 'Events',
    dataIndex: 'events',
    render: (_v, record) => asFailure(record).events.toLocaleString(),
  },
  {
    key: 'lastMessage',
    title: 'Example message',
    dataIndex: 'lastMessage',
    render: (_v, record) => (
      <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: asFailure(record).lastMessage }}>
        {asFailure(record).lastMessage}
      </Typography.Text>
    ),
  },
];

export function CapiStatsPanel({ days = 30 }: { days?: number }) {
  const { data, isLoading, error } = useCapiStats(days);

  if (isLoading) return <Card title="Event delivery"><Typography.Text>Loading…</Typography.Text></Card>;
  if (error || !data) {
    return (
      <Card title="Event delivery">
        <Typography.Text type="secondary">No delivery data yet.</Typography.Text>
      </Card>
    );
  }

  const ratePct = data.successRate === null ? '—' : `${(data.successRate * 100).toFixed(1)}%`;
  const rateColor = data.successRate === null ? undefined : data.successRate >= 0.99 ? '#34a853' : data.successRate >= 0.9 ? '#f6a609' : '#d93025';

  return (
    <Card title="Event delivery" extra={<Typography.Text type="secondary">last {days} days</Typography.Text>}>
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        <Space size="large" wrap>
          <Statistic title="Success rate" value={ratePct} {...(rateColor ? { valueStyle: { color: rateColor } } : {})} />
          <Statistic title="Dispatched" value={data.totals.dispatched} />
          <Statistic title="Failed (retried)" value={data.totals.failed} />
          <Statistic title="Batches" value={data.totals.batches} />
        </Space>

        {data.failures.length > 0 ? (
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
              Why events failed
            </Typography.Text>
            <Table
              rowKey={(r: unknown) => asFailure(r).reason}
              dataSource={data.failures}
              columns={FAILURE_COLUMNS}
              pagination={false}
              size="small"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
              Failed batches are retried automatically (Meta dedupes on event&nbsp;ID), so these are an error signal, not lost events.
            </Typography.Text>
          </div>
        ) : (
          <Typography.Text type="secondary">No failures in this period. 🎉</Typography.Text>
        )}
      </Space>
    </Card>
  );
}
