import { useState } from 'react';
import { Alert, Button, Empty, Space, Table, Tag, Tooltip, Typography } from '@primathonos/orion';
import {
  type SyncActivityRow,
  type SyncResult,
  useRetrySyncActivity,
  useSyncActivity,
} from '@/hooks/useUnicommerce';

const PAGE_SIZE = 5;

const RESULT_COLOR: Record<string, string> = {
  success: 'green',
  failed: 'red',
  partial: 'orange',
};

// Human-readable label per flow — paired with an arrow showing which
// direction the call actually went, since "order_push" / "outbound" on their
// own don't tell a merchant anything actionable.
const FLOW_LABELS: Record<SyncActivityRow['flow'], string> = {
  auth: 'Unicommerce authentication',
  order_push: 'Order pushed to Unicommerce',
  inventory: 'Inventory update',
  dispatch: 'Order dispatch',
  cancel: 'Order cancellation',
  status: 'Order status update',
  catalog: 'Catalog pull',
  webhook: 'Ratio webhook received',
};

function describeEvent(row: SyncActivityRow): string {
  // A webhook row is Ratio calling US, not a call to/from Unicommerce — the
  // "→/← Unicommerce" arrow used for every other flow would be misleading
  // here (the Reference column already shows which topic it was).
  if (row.flow === 'webhook') return FLOW_LABELS.webhook;
  const label = FLOW_LABELS[row.flow] ?? row.flow;
  const arrow = row.direction === 'outbound' ? '→ Unicommerce' : '← Unicommerce';
  return `${label} ${arrow}`;
}

/**
 * Best-effort extraction of a human-readable summary from whatever shape
 * `response` happens to carry — this varies by flow (a raw error string from
 * the DLQ path, a per-item errorMessage array from a controller response, a
 * saleOrderCode on a successful order push, etc). Falls back to a truncated
 * JSON dump rather than showing nothing when the shape isn't one of the
 * known cases, so a merchant/support engineer always has SOMETHING to go on.
 */
function describeDetails(row: SyncActivityRow): string | null {
  const { response } = row;
  if (response == null) return null;
  if (typeof response === 'string') return response;

  if (typeof response === 'object') {
    const r = response as Record<string, unknown>;

    if (typeof r.message === 'string') return r.message;

    if (Array.isArray(r.orderItems)) {
      const errors = (r.orderItems as Array<Record<string, unknown>>)
        .map((item) => (typeof item.errorMessage === 'string' ? item.errorMessage : null))
        .filter((m): m is string => Boolean(m));
      if (errors.length > 0) return errors.join('; ');
    }

    if (Array.isArray(r.failedProductList) && r.failedProductList.length > 0) {
      const errors = (r.failedProductList as Array<Record<string, unknown>>)
        .map((item) => (typeof item.message === 'string' ? item.message : null))
        .filter((m): m is string => Boolean(m));
      if (errors.length > 0) return errors.join('; ');
    }

    if (typeof r.saleOrderCode === 'string') return `Sale order code: ${r.saleOrderCode}`;
    if (r.alreadyDispatched === true) {
      return 'Unicommerce reports this order was already dispatched — cancel not applied';
    }
    if (typeof r.queuedJobId === 'string') return null;
    if (r.status === 'SUCCESS' || r.successful === true) return null;
  }

  const json = JSON.stringify(response);
  return json.length > 140 ? `${json.slice(0, 140)}…` : json;
}

export interface SyncActivityTableProps {
  merchantId: string | undefined;
  result?: SyncResult;
  emptyDescription: string;
}

/**
 * Shared table used by both the "All Activity" (`/sync`) and "Failed Syncs"
 * (`/failed-syncs`) pages — each is its own top-level nav item (matching the
 * flat-route convention every sibling admin-* app uses; nesting these as
 * sub-tabs inside one page duplicated the top nav's job with a second tab
 * strip).
 */
export function SyncActivityTable({ merchantId, result, emptyDescription }: SyncActivityTableProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const activity = useSyncActivity(merchantId, { limit, result });
  const retry = useRetrySyncActivity(merchantId);

  const columns = [
    {
      title: 'Timestamp',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: unknown) => new Date(value as string).toLocaleString(),
    },
    {
      title: 'Event',
      key: 'event',
      dataIndex: 'flow',
      render: (_value: unknown, record: unknown) => describeEvent(record as SyncActivityRow),
    },
    { title: 'Reference', dataIndex: 'reference', key: 'reference' },
    {
      title: 'Result',
      dataIndex: 'result',
      key: 'result',
      render: (value: unknown) => (
        <Tag color={RESULT_COLOR[value as string] ?? 'default'}>{value as string}</Tag>
      ),
    },
    {
      title: 'Details',
      key: 'details',
      dataIndex: 'response',
      render: (_value: unknown, record: unknown) => {
        const detail = describeDetails(record as SyncActivityRow);
        if (!detail) return <Typography.Text type="secondary">—</Typography.Text>;
        return (
          <Tooltip title={detail}>
            <Typography.Text
              style={{
                display: 'inline-block',
                maxWidth: 320,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'bottom',
              }}
            >
              {detail}
            </Typography.Text>
          </Tooltip>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      dataIndex: 'id',
      render: (_value: unknown, record: unknown) => {
        const row = record as SyncActivityRow;
        // Only failed rows with a `jobId` correspond to an actual
        // `uc_sync_jobs` row that can be retried — event-log rows from flows
        // with no job (auth/catalog/inventory/status/dispatch/cancel/webhook)
        // have `jobId: null` and would silently no-op if sent to the retry
        // endpoint, so the button must not render for them at all.
        if (row.result !== 'failed' || !row.jobId) return null;
        const jobId = row.jobId;
        return (
          <Button
            size="small"
            loading={retry.isPending && retry.variables === jobId}
            onClick={() => retry.mutate(jobId)}
          >
            Retry
          </Button>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
      {retry.isError && (
        <Alert
          type="error"
          showIcon
          message="Retry failed"
          description={(retry.error as Error).message}
        />
      )}

      {activity.isError ? (
        <Alert
          type="error"
          showIcon
          message="Couldn't load sync activity"
          description={(activity.error as Error).message}
        />
      ) : (
        <>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={activity.data?.rows ?? []}
            loading={activity.isLoading}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description={emptyDescription} /> }}
          />
          {activity.data?.hasMore && (
            <Button
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
              loading={activity.isFetching && !activity.isLoading}
            >
              Show more
            </Button>
          )}
        </>
      )}
    </Space>
  );
}
