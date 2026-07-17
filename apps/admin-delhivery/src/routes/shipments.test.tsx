import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentRow } from '@/hooks/useShipments';
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

function routeShipments(items: ShipmentRow[]) {
  mockedApi.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path.startsWith('/api/shipments')) {
      return Promise.resolve({ items, page: 1, pageSize: 20 });
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

  // Manual mode support, create a shipment for an order from the screen.
  it('creates a shipment manually via POST /api/shipments', async () => {
    routeShipments([]);
    mockedApi.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/api/shipments')) {
        return Promise.resolve({ items: [], page: 1, pageSize: 20 });
      }
      if (method === 'POST' && path === '/api/shipments') {
        return Promise.resolve(makeShipment());
      }
      return Promise.resolve({});
    });
    renderWithProviders(<ShipmentsPage />);

    const input = await screen.findByPlaceholderText(/ordr_/);
    fireEvent.change(input, { target: { value: 'ordr_42' } });
    fireEvent.click(screen.getByRole('button', { name: /Create shipment/ }));

    await waitFor(() => {
      const post = mockedApi.mock.calls.find((c) => c[0] === 'POST' && c[1] === '/api/shipments');
      expect(post).toBeDefined();
      expect(post?.[2]).toEqual({ order_id: 'ordr_42' });
    });
  });
});
