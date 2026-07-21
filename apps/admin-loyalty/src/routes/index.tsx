import {
  Button,
  Card,
  Empty,
  PrimaryButton,
  Space,
  Table,
  Tag,
  Typography,
} from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  type QrPerfRow,
  type RulePerfRow,
  type TrendPoint,
  useDashboardBulk,
  useDashboardQr,
  useDashboardRules,
  useDashboardSummary,
  useDashboardTrend,
} from '@/hooks/useLoyalty';

export const Route = createFileRoute('/')({ component: DashboardPage });

const DAY_MS = 24 * 3600 * 1000;
const PERIODS = [7, 30, 90] as const;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

export function DashboardPage() {
  const [periodDays, setPeriodDays] = useState<number | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(isoDaysAgo(29));
  const [customTo, setCustomTo] = useState(isoDaysAgo(0));
  const [applied, setApplied] = useState<{ from: string; to: string }>({
    from: isoDaysAgo(29),
    to: isoDaysAgo(0),
  });

  const { from, to } = applied;
  const summary = useDashboardSummary(from, to);
  const trend = useDashboardTrend(from, to);
  const rules = useDashboardRules();
  const qr = useDashboardQr();
  const bulk = useDashboardBulk(from, to);

  const pickPeriod = (days: number) => {
    setPeriodDays(days);
    setApplied({ from: isoDaysAgo(days - 1), to: isoDaysAgo(0) });
  };

  const s = summary.data;
  const series = trend.data ?? [];
  const hasActivity = series.some((p) => p.pointsIssued > 0 || p.pointsRedeemed > 0);

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Typography.Title level={2} style={{ marginBottom: 0 }}>
            Loyalty dashboard
          </Typography.Title>
          <Typography.Text type="secondary">
            Coins economy at a glance — daily snapshot granularity.
          </Typography.Text>
        </div>
        <Space wrap>
          {PERIODS.map((days) => (
            <Button
              key={days}
              type={periodDays === days ? 'primary' : 'default'}
              onClick={() => pickPeriod(days)}
            >
              {days} days
            </Button>
          ))}
          <Button
            type={periodDays === 'custom' ? 'primary' : 'default'}
            onClick={() => setPeriodDays('custom')}
          >
            Custom
          </Button>
        </Space>
      </div>

      {periodDays === 'custom' && (
        <Card size="small">
          <Space wrap align="center">
            <label>
              From{' '}
              <input
                type="date"
                aria-label="Custom from date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label>
              To{' '}
              <input
                type="date"
                aria-label="Custom to date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
            <PrimaryButton
              onClick={() => setApplied({ from: customFrom, to: customTo })}
              disabled={!customFrom || !customTo || customFrom > customTo}
            >
              Apply
            </PrimaryButton>
          </Space>
        </Card>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        <StatTile title="Coins issued" value={s?.pointsIssued} loading={summary.isLoading} />
        <StatTile title="Coins redeemed" value={s?.pointsRedeemed} loading={summary.isLoading} />
        <StatTile
          title="Redemption rate"
          value={s ? `${s.redemptionRate}%` : undefined}
          loading={summary.isLoading}
        />
        <StatTile title="Coins expired" value={s?.pointsExpired} loading={summary.isLoading} />
        <StatTile
          title="Outstanding liability"
          value={s ? `₹${s.liabilityInr.toLocaleString('en-IN')}` : undefined}
          loading={summary.isLoading}
        />
        <StatTile
          title="Customers with coins"
          value={s?.customersWithBalance}
          loading={summary.isLoading}
        />
      </div>

      <Card title="Issued vs redeemed" loading={trend.isLoading}>
        {hasActivity ? (
          <TrendChart series={series} />
        ) : (
          <Empty description="No coin activity in this period" />
        )}
      </Card>

      <Card title="Rule performance" loading={rules.isLoading}>
        <Table
          rowKey="id"
          columns={ruleColumns}
          dataSource={rules.data ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="No earning rules yet" /> }}
        />
      </Card>

      <Card title="QR performance" loading={qr.isLoading}>
        <Table
          rowKey="id"
          columns={qrColumns}
          dataSource={qr.data ?? []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="No QR campaigns yet" /> }}
        />
      </Card>

      <Card title="Bulk operations" loading={bulk.isLoading}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          <StatTile title="Coins bulk-credited" value={bulk.data?.bulkCredited} flat />
          <StatTile title="Coins bulk-debited" value={bulk.data?.bulkDebited} flat />
          <StatTile title="Operations run" value={bulk.data?.operations} flat />
        </div>
      </Card>
    </Space>
  );
}

function StatTile({
  title,
  value,
  loading,
  flat,
}: {
  title: string;
  value: number | string | undefined;
  loading?: boolean;
  flat?: boolean;
}) {
  const body = (
    <>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
        {title}
      </Typography.Text>
      <Typography.Text strong style={{ fontSize: 22 }}>
        {value === undefined
          ? '—'
          : typeof value === 'number'
            ? value.toLocaleString('en-IN')
            : value}
      </Typography.Text>
    </>
  );
  if (flat) return <div>{body}</div>;
  return (
    <Card size="small" {...(loading !== undefined ? { loading } : {})}>
      {body}
    </Card>
  );
}

/** Lightweight inline SVG bar chart — no chart dependency. */
function TrendChart({ series }: { series: TrendPoint[] }) {
  const max = Math.max(1, ...series.map((p) => Math.max(p.pointsIssued, p.pointsRedeemed)));
  const barWidth = 8;
  const groupWidth = barWidth * 2 + 8;
  const height = 160;
  const width = Math.max(series.length * groupWidth, groupWidth);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        data-testid="trend-chart"
        role="img"
        aria-label="Issued vs redeemed trend"
        width="100%"
        height={height + 8}
        viewBox={`0 0 ${width} ${height + 8}`}
        preserveAspectRatio="none"
      >
        {series.map((point, index) => {
          const x = index * groupWidth;
          const issuedH = Math.round((point.pointsIssued / max) * height);
          const redeemedH = Math.round((point.pointsRedeemed / max) * height);
          return (
            <g key={point.date} data-testid="trend-day">
              <rect x={x} y={height - issuedH} width={barWidth} height={issuedH} fill="#1677ff">
                <title>{`${point.date}: ${point.pointsIssued} issued`}</title>
              </rect>
              <rect
                x={x + barWidth + 2}
                y={height - redeemedH}
                width={barWidth}
                height={redeemedH}
                fill="#52c41a"
              >
                <title>{`${point.date}: ${point.pointsRedeemed} redeemed`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <Space size="large">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <span style={{ color: '#1677ff' }}>■</span> Issued
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <span style={{ color: '#52c41a' }}>■</span> Redeemed
        </Typography.Text>
      </Space>
    </div>
  );
}

const ruleColumns = [
  { title: 'Rule', dataIndex: 'name', key: 'name' },
  { title: 'Type', dataIndex: 'ruleType', key: 'ruleType' },
  {
    title: 'Status',
    dataIndex: 'active',
    key: 'active',
    render: (value: unknown) =>
      value ? <Tag color="green">Active</Tag> : <Tag color="default">Paused</Tag>,
  },
  {
    title: 'Matches',
    dataIndex: 'matches',
    key: 'matches',
    render: (value: unknown) => Number(value).toLocaleString('en-IN'),
  },
  {
    title: 'Extra coins',
    dataIndex: 'extraCoins',
    key: 'extraCoins',
    render: (value: unknown) => Number(value).toLocaleString('en-IN'),
  },
  {
    title: 'Unique customers',
    dataIndex: 'uniqueCustomers',
    key: 'uniqueCustomers',
    render: (_value: unknown, record: unknown) =>
      (record as RulePerfRow).uniqueCustomers.toLocaleString('en-IN'),
  },
];

const qrColumns = [
  { title: 'Event', dataIndex: 'eventName', key: 'eventName' },
  {
    title: 'State',
    dataIndex: 'state',
    key: 'state',
    render: (value: unknown) => <Tag>{String(value)}</Tag>,
  },
  { title: 'Scans', dataIndex: 'scanCount', key: 'scanCount' },
  { title: 'New phones', dataIndex: 'newPhoneCount', key: 'newPhoneCount' },
  { title: 'Orders converted', dataIndex: 'converted', key: 'converted' },
  {
    title: 'Conversion',
    dataIndex: 'conversionRate',
    key: 'conversionRate',
    render: (_value: unknown, record: unknown) => `${(record as QrPerfRow).conversionRate}%`,
  },
];
