import {
  Alert,
  Button,
  Card,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from '@primathonos/orion';
import {
  DELHIVERY_SHIPMENT_STATUSES,
  type DelhiveryShipmentStatus,
} from '@shared/constants/delhivery-events';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useConfig } from '@/hooks/useConfig';
import {
  type PendingOrder,
  type ShipmentRow,
  useCreateShipment,
  usePendingOrders,
  useRequestPickup,
  useShipments,
} from '@/hooks/useShipments';
import { apiBlob } from '@/lib/api';

export const Route = createFileRoute('/shipments')({ component: ShipmentsPage });

/**
 * NDR resolution (re-attempt, address update, RTO initiation) is OUT OF SCOPE
 * for this app, it stays in the merchant's own Delhivery dashboard. We only
 * reflect the status and link out.
 */
const DELHIVERY_DASHBOARD_URL = 'https://one.delhivery.com';

const STATUS_LABEL: Record<DelhiveryShipmentStatus, string> = {
  awaiting_pickup: 'Awaiting pickup',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  delivery_failed: 'Delivery failed (NDR)',
  rto_completed: 'RTO completed',
  shipment_cancelled: 'Cancelled',
};

const STATUS_COLOR: Record<DelhiveryShipmentStatus, string> = {
  awaiting_pickup: 'blue',
  in_transit: 'geekblue',
  out_for_delivery: 'gold',
  delivered: 'green',
  delivery_failed: 'red',
  rto_completed: 'purple',
  shipment_cancelled: 'default',
};

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All statuses' },
  ...DELHIVERY_SHIPMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
];

function isKnownStatus(status: string): status is DelhiveryShipmentStatus {
  return (DELHIVERY_SHIPMENT_STATUSES as readonly string[]).includes(status);
}

export function ShipmentsPage() {
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const list = useShipments(page, status === 'ALL' ? undefined : status);
  const pickup = useRequestPickup();
  const trigger = useConfig().data?.awbTrigger;

  const items = list.data?.items ?? [];
  const pageSize = list.data?.pageSize ?? 20;
  const hasNdr = items.some((s) => s.status === 'delivery_failed');

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          Shipments
        </Typography.Title>
        <Typography.Text type="secondary">
          AWBs, live carrier status and labels for your Delhivery shipments.
        </Typography.Text>
      </div>

      {hasNdr && (
        <Alert
          type="warning"
          showIcon
          message="Some shipments have failed delivery (NDR)"
          description="NDR is shown read-only here. Re-attempts, address updates and RTO are resolved in the Delhivery dashboard."
        />
      )}

      <Card
        title="Shipments"
        extra={
          <Space wrap>
            <Select
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={STATUS_FILTERS}
              style={{ width: 180 }}
            />
            <Button loading={pickup.isPending} onClick={() => pickup.mutate({})}>
              Request pickup
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          {pickup.data && (
            <Alert
              type={pickup.data.scheduled ? 'success' : 'info'}
              showIcon
              message={
                pickup.data.scheduled
                  ? `Pickup requested for ${pickup.data.count} shipment(s).`
                  : 'No shipments are pending pickup.'
              }
            />
          )}
          {pickup.error && (
            <Alert type="error" message={(pickup.error as Error).message} showIcon />
          )}

          {list.isError ? (
            <Alert
              type="error"
              showIcon
              message="Could not load shipments"
              description={(list.error as Error).message}
              action={<Button onClick={() => void list.refetch()}>Retry</Button>}
            />
          ) : list.isLoading ? (
            <Typography.Text type="secondary">Loading shipments…</Typography.Text>
          ) : (
            <>
              <ShipmentsTable items={items} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <Typography.Text type="secondary" style={{ alignSelf: 'center' }}>
                  Page {page}
                </Typography.Text>
                {/* No total in the API; assume another page while a full page came back. */}
                <Button disabled={items.length < pageSize} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </>
          )}
        </Space>
      </Card>

      {trigger === 'manual' && <PendingOrdersCard />}
    </Space>
  );
}

function ShipmentsTable({ items }: { items: ShipmentRow[] }) {
  const [labelError, setLabelError] = useState<string | null>(null);
  const [printingAwb, setPrintingAwb] = useState<string | null>(null);

  async function printLabel(awb: string): Promise<void> {
    setLabelError(null);
    setPrintingAwb(awb);
    try {
      // Fetch through the backend proxy with the merchant Bearer token;
      // Delhivery credentials never reach the browser.
      const blob = await apiBlob(`/api/shipments/${awb}/label`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      setLabelError((err as Error).message);
    } finally {
      setPrintingAwb(null);
    }
  }

  const columns = [
    {
      title: 'Order',
      dataIndex: 'orderNumber',
      key: 'orderNumber',
      render: (_v: unknown, record: unknown) => {
        const row = record as ShipmentRow;
        return <Typography.Text strong>{row.orderNumber || row.orderId}</Typography.Text>;
      },
    },
    {
      title: 'AWB',
      dataIndex: 'awb',
      key: 'awb',
      render: (value: unknown) =>
        value ? (
          <Typography.Text code>{value as string}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">pending</Typography.Text>
        ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (value: unknown) => {
        const s = value as string;
        return isKnownStatus(s) ? (
          <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>
        ) : (
          <Tag>{s}</Tag>
        );
      },
    },
    {
      title: 'Payment',
      dataIndex: 'paymentMode',
      key: 'paymentMode',
      render: (_v: unknown, record: unknown) => {
        const row = record as ShipmentRow;
        return (
          <Tag color={row.paymentMode === 'COD' ? 'orange' : 'default'}>
            {row.paymentMode === 'COD' ? `COD ₹${row.codAmount}` : 'Prepaid'}
          </Tag>
        );
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: unknown) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(value as string).toLocaleString()}
        </Typography.Text>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'id',
      key: 'actions',
      render: (_v: unknown, record: unknown) => {
        const row = record as ShipmentRow;
        return (
          <Space wrap>
            <Button
              size="small"
              disabled={!row.awb}
              loading={printingAwb === row.awb && !!row.awb}
              onClick={() => row.awb && void printLabel(row.awb)}
            >
              Print label
            </Button>
            {row.status === 'delivery_failed' && (
              <a href={DELHIVERY_DASHBOARD_URL} target="_blank" rel="noreferrer">
                Manage in Delhivery
              </a>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="small" style={{ display: 'flex' }}>
      {labelError && (
        <Alert type="error" message={`Could not fetch the label: ${labelError}`} showIcon />
      )}
      <Table
        rowKey="id"
        columns={columns}
        dataSource={items}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: <Empty description="No shipments yet" /> }}
      />
    </Space>
  );
}

function PendingOrdersCard() {
  const [page, setPage] = useState(1);
  const pending = usePendingOrders(page);
  const create = useCreateShipment();
  const items = pending.data?.items ?? [];
  const hasNext = pending.data?.hasNext ?? false;
  const hasPrev = pending.data?.hasPrev ?? false;

  const columns = [
    {
      title: 'Order',
      dataIndex: 'orderNumber',
      key: 'orderNumber',
      render: (value: unknown) => <Typography.Text strong>{value as string}</Typography.Text>,
    },
    {
      title: 'Customer',
      dataIndex: 'customerName',
      key: 'customerName',
    },
    {
      title: 'Amount',
      dataIndex: 'amountRupees',
      key: 'amountRupees',
      render: (value: unknown) => <Typography.Text>{`₹${value as number}`}</Typography.Text>,
    },
    {
      title: 'City',
      dataIndex: 'city',
      key: 'city',
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: unknown) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(value as string).toLocaleString()}
        </Typography.Text>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'orderId',
      key: 'actions',
      render: (_v: unknown, record: unknown) => {
        const row = record as PendingOrder;
        return (
          <Button
            size="small"
            loading={create.isPending && create.variables?.order_id === row.orderId}
            onClick={() => create.mutate({ order_id: row.orderId })}
          >
            Create AWB
          </Button>
        );
      },
    },
  ];

  return (
    <Card title="Orders awaiting AWB">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        {create.error && <Alert type="error" message={(create.error as Error).message} showIcon />}
        {pending.isError ? (
          <Alert
            type="error"
            showIcon
            message="Could not load orders"
            description={(pending.error as Error).message}
            action={<Button onClick={() => void pending.refetch()}>Retry</Button>}
          />
        ) : pending.isLoading ? (
          <Typography.Text type="secondary">Loading orders…</Typography.Text>
        ) : (
          <>
            <Table
              rowKey="orderId"
              columns={columns}
              dataSource={items}
              pagination={false}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: <Empty description="No orders awaiting AWB" /> }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button disabled={!hasPrev} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Typography.Text type="secondary" style={{ alignSelf: 'center' }}>
                Page {page}
              </Typography.Text>
              {/* No usable total upstream (it counts filtered-out orders); trust hasNext. */}
              <Button disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </>
        )}
      </Space>
    </Card>
  );
}
