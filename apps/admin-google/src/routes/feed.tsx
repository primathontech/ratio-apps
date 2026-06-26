import {
  Card,
  Empty,
  List,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from '@primathonos/orion';
import type { FeedItemStatus } from '@shared/schemas/google-config';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  type FeedEventRow,
  type FeedItem,
  useFeedEvents,
  useFeedHistory,
  useFeedItems,
} from '@/hooks/useFeed';

export const Route = createFileRoute('/feed')({ component: FeedPage });

const PAGE_SIZE = 20;

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'SYNCED', label: 'Synced' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'ERROR', label: 'Error' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'DELETED', label: 'Deleted' },
];

const STATUS_COLOR: Record<FeedItemStatus, string> = {
  SYNCED: 'green',
  WARNING: 'gold',
  ERROR: 'red',
  PENDING: 'blue',
  DELETED: 'default',
};

export function FeedPage() {
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [eventsPage, setEventsPage] = useState(1);
  const items = useFeedItems(status, page, pageSize);
  const history = useFeedHistory();
  const events = useFeedEvents('', eventsPage, PAGE_SIZE);

  const eventColumns = [
    {
      title: 'Product',
      dataIndex: 'title',
      key: 'product',
      render: (_value: unknown, record: unknown) => {
        const row = record as FeedEventRow;
        return <Typography.Text>{row.title || row.offerId}</Typography.Text>;
      },
    },
    {
      title: 'Change',
      dataIndex: 'status',
      key: 'change',
      render: (_value: unknown, record: unknown) => {
        const row = record as FeedEventRow;
        return (
          <Space size={4}>
            {row.previousStatus ? (
              <Tag color={STATUS_COLOR[row.previousStatus]}>{row.previousStatus}</Tag>
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
            <Typography.Text type="secondary">→</Typography.Text>
            <Tag color={STATUS_COLOR[row.status]}>{row.status}</Tag>
          </Space>
        );
      },
    },
    {
      title: 'Issue',
      dataIndex: 'issue',
      key: 'issue',
      render: (value: unknown) =>
        value ? <Typography.Text type="danger">{value as string}</Typography.Text> : '—',
    },
    {
      title: 'When',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: unknown) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(value as string).toLocaleString()}
        </Typography.Text>
      ),
    },
  ];

  const columns = [
    {
      title: 'Product',
      dataIndex: 'title',
      key: 'title',
      render: (_value: unknown, record: unknown) => {
        const row = record as FeedItem;
        return <Typography.Text>{row.title || row.offerId}</Typography.Text>;
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (value: unknown) => {
        const status = value as FeedItemStatus;
        return <Tag color={STATUS_COLOR[status]}>{status}</Tag>;
      },
    },
    {
      title: 'GTIN',
      dataIndex: 'hasGtin',
      key: 'hasGtin',
      render: (value: unknown) => ((value as boolean) ? 'Yes' : 'No'),
    },
    {
      title: 'Issue',
      dataIndex: 'issue',
      key: 'issue',
      render: (value: unknown) =>
        value ? <Typography.Text type="danger">{value as string}</Typography.Text> : '—',
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          Product Feed
        </Typography.Title>
        <Typography.Text type="secondary">
          Per-product Merchant Center sync status and history.
        </Typography.Text>
      </div>

      <Card
        title="Feed items"
        extra={
          <Select
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={STATUS_FILTERS}
            style={{ width: '100%', maxWidth: 220, minWidth: 140 }}
          />
        }
      >
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <Table
            rowKey="offerId"
            columns={columns}
            dataSource={items.data?.items ?? []}
            loading={items.isLoading}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description="No feed items" /> }}
          />
          <div style={{ textAlign: 'right' }}>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={items.data?.total ?? 0}
              showSizeChanger
              pageSizeOptions={['20', '50', '100']}
              onChange={(p, ps) => {
                // Changing page size resets to page 1 (backend caps limit at 100).
                if (ps !== pageSize) {
                  setPageSize(ps);
                  setPage(1);
                } else {
                  setPage(p);
                }
              }}
            />
          </div>
        </Space>
      </Card>

      <Card title="Status change history">
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <Table
            rowKey={(r) => `${(r as FeedEventRow).offerId}-${(r as FeedEventRow).createdAt}`}
            columns={eventColumns}
            dataSource={events.data?.items ?? []}
            loading={events.isLoading}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description="No status changes yet" /> }}
          />
          <div style={{ textAlign: 'right' }}>
            <Pagination
              current={eventsPage}
              pageSize={PAGE_SIZE}
              total={events.data?.total ?? 0}
              onChange={(p) => setEventsPage(p)}
            />
          </div>
        </Space>
      </Card>

      <Card title="Sync history">
        {history.data && history.data.length === 0 ? (
          <Empty description="No sync runs yet" />
        ) : (
          <List
            loading={history.isLoading}
            dataSource={history.data ?? []}
            renderItem={(row) => (
              <List.Item>
                <Space direction="vertical" size={2} style={{ display: 'flex' }}>
                  <Typography.Text strong>{row.syncType}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(row.createdAt).toLocaleString()} · checked {row.productsChecked} ·
                    updated {row.productsUpdated} · errored {row.productsErrored}
                  </Typography.Text>
                  {row.detail && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {row.detail}
                    </Typography.Text>
                  )}
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>
    </Space>
  );
}
