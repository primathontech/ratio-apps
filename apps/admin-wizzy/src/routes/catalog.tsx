import {
  Card,
  Empty,
  List,
  Pagination,
  PrimaryButton,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from '@primathonos/orion';
import type { WizzyCatalogStatus } from '@shared/schemas/wizzy-config';
import { createFileRoute } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { queryKeys } from '@/lib/queryKeys';
import {
  type CatalogItem,
  useCatalogHistory,
  useCatalogItems,
  useCatalogSummary,
  useForceSync,
} from '@/hooks/useCatalog';

export const Route = createFileRoute('/catalog')({ component: CatalogPage });

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'SYNCED', label: 'Synced' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ERROR', label: 'Error' },
  { value: 'DELETED', label: 'Deleted' },
];

const STATUS_COLOR: Record<WizzyCatalogStatus, string> = {
  SYNCED: 'green',
  PENDING: 'blue',
  ERROR: 'red',
  DELETED: 'default',
};

export function CatalogPage() {
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // queryKey includes limit — CORRECT: changing pageSize triggers a new fetch
  const items = useCatalogItems(status, page, pageSize);
  const history = useCatalogHistory();
  const summary = useCatalogSummary();
  const forceSync = useForceSync();
  const qc = useQueryClient();

  // A sync is in flight if the POST is pending OR the backend reports `syncing`.
  // The button stays disabled the whole time, so repeated clicks can't start a
  // second run; it re-enables the moment the sync finishes OR errors (the
  // backend clears the lock in either case).
  const syncing = forceSync.isPending || !!summary.data?.syncing;

  // When a running sync finishes (syncing: true → false), refresh the table +
  // history so the new statuses/counts show without a manual reload.
  const wasSyncing = useRef(false);
  useEffect(() => {
    const now = !!summary.data?.syncing;
    if (wasSyncing.current && !now) {
      qc.invalidateQueries({ queryKey: queryKeys.catalogItems(status, page, pageSize) });
      qc.invalidateQueries({ queryKey: queryKeys.catalogHistory() });
    }
    wasSyncing.current = now;
  }, [summary.data?.syncing, qc, status, page, pageSize]);

  const columns = [
    {
      title: 'Product',
      dataIndex: 'title',
      key: 'title',
      render: (_value: unknown, record: unknown) => {
        const row = record as CatalogItem;
        return <Typography.Text>{row.title || row.productId}</Typography.Text>;
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (value: unknown) => {
        const s = value as WizzyCatalogStatus;
        return <Tag color={STATUS_COLOR[s]}>{s}</Tag>;
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
      title: 'Last Synced',
      dataIndex: 'lastSyncedAt',
      key: 'lastSyncedAt',
      render: (value: unknown) => (value ? new Date(value as string).toLocaleString() : '—'),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <Typography.Title level={3} style={{ marginBottom: 0 }}>
            Catalog Details
          </Typography.Title>
          <Typography.Text type="secondary">
            Per-product Wizzy sync status and history.
          </Typography.Text>
        </div>
        <PrimaryButton
          loading={syncing}
          disabled={syncing}
          onClick={() => forceSync.mutate()}
        >
          {syncing ? 'Syncing…' : 'Force Sync Now'}
        </PrimaryButton>
      </div>

      <Card
        title="Catalog items"
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
            rowKey="id"
            columns={columns}
            dataSource={items.data?.items ?? []}
            loading={items.isLoading}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description="No catalog items" /> }}
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
                    synced {row.productsSynced} · errored {row.productsErrored}
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
