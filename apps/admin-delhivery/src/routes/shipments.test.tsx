import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingOrder, ShipmentRow } from '@/hooks/useShipments';
import { api, apiBlob } from '@/lib/api';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { renderWithProviders } from '../test-utils';
import { ShipmentsPage } from './shipments';

vi.mock('@/lib/api');

const mockedApi = vi.mocked(api);
const mockedApiBlob = vi.mocked(apiBlob);

function makeShipment(overrides: Partial<ShipmentRow> = {}): ShipmentRow {
  return {
    id: 'shp_1',
    merchantId: 'mer_1',
    orderId: 'ordr_1',
    orderNumber: '1001',
    awb: 'AWB123',
    carrier: 'DELHIVERY',
    status: 'awaiting_pickup',
    paymentMode: 'Prepaid',
    codAmount: 0,
    weightGrams: 500,
    labelUrl: null,
    estimatedDelivery: null,
    active: true,
    pickupRequestedAt: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

function makePendingOrder(overrides: Partial<PendingOrder> = {}): PendingOrder {
  return {
    orderId: 'ordr_42',
    orderNumber: '2002',
    customerName: 'Asha K',
    amountRupees: 1499,
    city: 'Bengaluru',
    createdAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

function routeShipments(items: ShipmentRow[]) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path.startsWith('/api/shipments')) {
      return Promise.resolve({ items, page: 1, pageSize: 20 });
    }
    return Promise.resolve({});
  });
}

/**
 * Manual mode: awbTrigger=manual config + the pending-orders worklist. Pending
 * is checked before the list path since both start with `/api/shipments`.
 * `pagesByNumber` serves per-page worklists; page 1 defaults to `pending`.
 */
function routeManual(
  pending: PendingOrder[],
  opts: {
    shipments?: ShipmentRow[];
    hasNext?: boolean;
    pagesByNumber?: Record<number, { items: PendingOrder[]; hasNext: boolean; hasPrev: boolean }>;
  } = {},
) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path === '/api/delhivery-config') {
      return Promise.resolve({ awbTrigger: 'manual', enabled: true, hasApiToken: true });
    }
    if (method === 'GET' && path.startsWith('/api/shipments/pending')) {
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page') ?? '1');
      const override = opts.pagesByNumber?.[page];
      if (override) return Promise.resolve({ page, ...override });
      return Promise.resolve({ items: pending, page, hasNext: opts.hasNext ?? false, hasPrev: page > 1 });
    }
    if (method === 'GET' && path.startsWith('/api/shipments')) {
      return Promise.resolve({ items: opts.shipments ?? [], page: 1, pageSize: 20 });
    }
    if (method === 'POST' && path === '/api/shipments') {
      return Promise.resolve(makeShipment());
    }
    return Promise.resolve({});
  });
}

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
  mockedApi.mockReset();
  mockedApiBlob.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ShipmentsPage', () => {
  // list.rendersStatuses, each unified status renders a readable tag.
  it('renders shipments with their statuses', async () => {
    routeShipments([
      makeShipment({ id: 's1', orderNumber: '1001', status: 'awaiting_pickup' }),
      makeShipment({ id: 's2', orderNumber: '1002', awb: 'AWB124', status: 'in_transit' }),
      makeShipment({ id: 's3', orderNumber: '1003', awb: 'AWB125', status: 'delivered' }),
      makeShipment({ id: 's4', orderNumber: '1004', awb: 'AWB126', status: 'shipment_cancelled' }),
    ]);
    renderWithProviders(<ShipmentsPage />);

    await waitFor(() => expect(screen.getByText('1001')).toBeInTheDocument());
    expect(screen.getByText('Awaiting pickup')).toBeInTheDocument();
    expect(screen.getByText('In transit')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('AWB123')).toBeInTheDocument();
  });

  // list.printLabelButton, the label is fetched through the authed proxy.
  it('print label fetches the PDF through the backend proxy', async () => {
    routeShipments([makeShipment({ awb: 'AWB123' })]);
    mockedApiBlob.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    vi.stubGlobal('open', vi.fn());
    URL.createObjectURL = vi.fn(() => 'blob:label');

    renderWithProviders(<ShipmentsPage />);
    const button = await screen.findByRole('button', { name: /Print label/ });
    fireEvent.click(button);

    await waitFor(() => expect(mockedApiBlob).toHaveBeenCalledWith('/api/shipments/AWB123/label'));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('blob:label', '_blank'));
  });

  it('print label is disabled while the AWB is still pending', async () => {
    routeShipments([makeShipment({ awb: null })]);
    renderWithProviders(<ShipmentsPage />);
    const button = await screen.findByRole('button', { name: /Print label/ });
    expect(button).toBeDisabled();
  });

  // list.ndrReadOnlyWithManageLink, NDR is display-only + an external manage link.
  it('shows NDR shipments read-only with a Manage in Delhivery link', async () => {
    routeShipments([makeShipment({ status: 'delivery_failed', awb: 'AWB999' })]);
    renderWithProviders(<ShipmentsPage />);

    await waitFor(() => expect(screen.getByText('Delivery failed (NDR)')).toBeInTheDocument());
    const link = screen.getByRole('link', { name: /Manage in Delhivery/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('delhivery.com'));
    expect(link).toHaveAttribute('target', '_blank');
    // Read-only: no NDR resolution actions in the admin.
    expect(
      screen.queryByRole('button', { name: /Re-?attempt|Resolve|Update address/i }),
    ).toBeNull();
    // The read-only hint is shown.
    expect(screen.getByText(/resolved in the Delhivery dashboard/)).toBeInTheDocument();
  });

  // list.apiBinding, loading state.
  it('shows a loading state while shipments are being fetched', async () => {
    mockedApi.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<ShipmentsPage />);
    expect(await screen.findByText(/Loading shipments/)).toBeInTheDocument();
  });

  // list.apiBinding, empty state.
  it('shows an empty state when there are no shipments', async () => {
    routeShipments([]);
    renderWithProviders(<ShipmentsPage />);
    expect(await screen.findByText('No shipments yet')).toBeInTheDocument();
  });

  // list.apiBinding, error state.
  it('shows an error state when the shipments API fails', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/api/shipments')) {
        // A 4xx is not retried by the hook, so the error state surfaces at once.
        return Promise.reject(
          Object.assign(new Error('shipments backend unavailable'), { status: 403 }),
        );
      }
      return Promise.resolve({});
    });
    renderWithProviders(<ShipmentsPage />);
    expect(await screen.findByText(/shipments backend unavailable/)).toBeInTheDocument();
  });

  // Manual mode, the pending-orders worklist surfaces paid+unfulfilled orders.
  it('renders the "Orders awaiting AWB" list in manual mode', async () => {
    routeManual([makePendingOrder({ orderNumber: '2002', customerName: 'Asha K' })]);
    renderWithProviders(<ShipmentsPage />);

    expect(await screen.findByText('Orders awaiting AWB')).toBeInTheDocument();
    expect(await screen.findByText('2002')).toBeInTheDocument();
    expect(screen.getByText('Asha K')).toBeInTheDocument();
    expect(screen.getByText('₹1499')).toBeInTheDocument();
    expect(screen.getByText('Bengaluru')).toBeInTheDocument();
  });

  // Manual mode, "Create AWB" reuses POST /api/shipments {order_id}.
  it('creates an AWB via POST /api/shipments {order_id}', async () => {
    routeManual([makePendingOrder({ orderId: 'ordr_42' })]);
    renderWithProviders(<ShipmentsPage />);

    const button = await screen.findByRole('button', { name: /Create AWB/ });
    fireEvent.click(button);

    await waitFor(() => {
      const post = mockedApi.mock.calls.find((c) => c[0] === 'POST' && c[1] === '/api/shipments');
      expect(post).toBeDefined();
      expect(post?.[2]).toEqual({ order_id: 'ordr_42' });
    });
  });

  // Manual mode, a successful create refetches the pending list.
  it('refetches the pending list after a successful create', async () => {
    routeManual([makePendingOrder({ orderId: 'ordr_42' })]);
    renderWithProviders(<ShipmentsPage />);

    const button = await screen.findByRole('button', { name: /Create AWB/ });
    fireEvent.click(button);

    await waitFor(() => {
      const gets = mockedApi.mock.calls.filter(
        (c) => c[0] === 'GET' && c[1] === '/api/shipments/pending?page=1',
      );
      expect(gets.length).toBeGreaterThanOrEqual(2);
    });
  });

  // Manual mode, hasNext/hasPrev-driven pagination (no usable upstream total).
  it('paginates the pending worklist via hasNext/hasPrev', async () => {
    routeManual([makePendingOrder({ orderNumber: '2002' })], {
      hasNext: true,
      pagesByNumber: {
        2: {
          items: [makePendingOrder({ orderId: 'ordr_43', orderNumber: '3003' })],
          hasNext: false,
          hasPrev: true,
        },
      },
    });
    renderWithProviders(<ShipmentsPage />);
    expect(await screen.findByText('2002')).toBeInTheDocument();

    // The shipments card renders its own pager first; the worklist's is last.
    const pendingPager = () => ({
      prev: screen.getAllByRole('button', { name: 'Previous' }).at(-1) as HTMLElement,
      next: screen.getAllByRole('button', { name: 'Next' }).at(-1) as HTMLElement,
    });
    expect(pendingPager().prev).toBeDisabled();
    expect(pendingPager().next).toBeEnabled();

    fireEvent.click(pendingPager().next);
    expect(await screen.findByText('3003')).toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledWith('GET', '/api/shipments/pending?page=2');
    expect(pendingPager().prev).toBeEnabled();
    expect(pendingPager().next).toBeDisabled();
  });

  it('disables Next on the pending worklist when hasNext is false', async () => {
    routeManual([makePendingOrder({ orderNumber: '2002' })]);
    renderWithProviders(<ShipmentsPage />);
    expect(await screen.findByText('2002')).toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: 'Next' }).at(-1)).toBeDisabled();
  });

  // Manual mode, empty worklist shows the empty state.
  it('shows the empty state when no orders await an AWB', async () => {
    routeManual([]);
    renderWithProviders(<ShipmentsPage />);

    expect(await screen.findByText('No orders awaiting AWB')).toBeInTheDocument();
  });

  // Manual mode, the pending fetch is loading.
  it('shows a loading state while pending orders are fetched', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/api/delhivery-config') {
        return Promise.resolve({ awbTrigger: 'manual', enabled: true, hasApiToken: true });
      }
      if (method === 'GET' && path.startsWith('/api/shipments/pending')) {
        return new Promise(() => {});
      }
      if (method === 'GET' && path.startsWith('/api/shipments')) {
        return Promise.resolve({ items: [], page: 1, pageSize: 20 });
      }
      return Promise.resolve({});
    });
    renderWithProviders(<ShipmentsPage />);

    expect(await screen.findByText(/Loading orders/)).toBeInTheDocument();
  });

  // Manual mode, a failed pending fetch surfaces an error with a working Retry.
  // A 4xx is not retried, so exactly one fetch happens per attempt.
  it('shows an error with a working Retry when the pending fetch fails', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/api/delhivery-config') {
        return Promise.resolve({ awbTrigger: 'manual', enabled: true, hasApiToken: true });
      }
      if (method === 'GET' && path.startsWith('/api/shipments/pending')) {
        return Promise.reject(Object.assign(new Error('pending unavailable'), { status: 403 }));
      }
      if (method === 'GET' && path.startsWith('/api/shipments')) {
        return Promise.resolve({ items: [], page: 1, pageSize: 20 });
      }
      return Promise.resolve({});
    });
    renderWithProviders(<ShipmentsPage />);

    expect(await screen.findByText('Could not load orders')).toBeInTheDocument();
    const pendingGets = () =>
      mockedApi.mock.calls.filter((c) => c[0] === 'GET' && c[1] === '/api/shipments/pending?page=1');
    expect(pendingGets()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(pendingGets().length).toBeGreaterThanOrEqual(2));
  });

  // usePendingOrders retry predicate: a 5xx is retried up to the count-2 cap.
  it('retries the pending fetch on a 5xx', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/api/delhivery-config') {
        return Promise.resolve({ awbTrigger: 'manual', enabled: true, hasApiToken: true });
      }
      if (method === 'GET' && path.startsWith('/api/shipments/pending')) {
        return Promise.reject(Object.assign(new Error('pending upstream'), { status: 502 }));
      }
      if (method === 'GET' && path.startsWith('/api/shipments')) {
        return Promise.resolve({ items: [], page: 1, pageSize: 20 });
      }
      return Promise.resolve({});
    });
    renderWithProviders(<ShipmentsPage />);

    expect(await screen.findByText('Could not load orders')).toBeInTheDocument();
    await waitFor(() => {
      const gets = mockedApi.mock.calls.filter(
        (c) => c[0] === 'GET' && c[1] === '/api/shipments/pending?page=1',
      );
      // initial + 2 retries (predicate caps at count < 2).
      expect(gets).toHaveLength(3);
    });
  });

  // Auto mode, the worklist is not rendered.
  it('does not render the pending-orders list in auto mode', async () => {
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/api/delhivery-config') {
        return Promise.resolve({ awbTrigger: 'auto', enabled: true, hasApiToken: true });
      }
      if (method === 'GET' && path.startsWith('/api/shipments')) {
        return Promise.resolve({ items: [], page: 1, pageSize: 20 });
      }
      return Promise.resolve({});
    });
    renderWithProviders(<ShipmentsPage />);

    await waitFor(() => expect(screen.getByText('No shipments yet')).toBeInTheDocument());
    expect(screen.queryByText('Orders awaiting AWB')).toBeNull();
  });
});
