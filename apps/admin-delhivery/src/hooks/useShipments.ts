import type { DelhiveryShipmentStatus } from '@shared/constants/delhivery-events';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

/**
 * A `delhivery_shipments` row as the JSON API returns it (dates serialized,
 * MySQL booleans may arrive as 0/1).
 */
export interface ShipmentRow {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string;
  awb: string | null;
  carrier: string;
  status: DelhiveryShipmentStatus | (string & {});
  paymentMode: 'COD' | 'Prepaid';
  codAmount: number;
  weightGrams: number;
  labelUrl: string | null;
  estimatedDelivery: string | null;
  active: boolean | number;
  pickupRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentListResponse {
  items: ShipmentRow[];
  page: number;
  pageSize: number;
}

/** A paid + unfulfilled order with no shipment yet, awaiting a manual AWB. */
export interface PendingOrder {
  orderId: string;
  orderNumber: string;
  customerName: string;
  amountRupees: number;
  city: string;
  createdAt: string;
}

export function useShipments(page: number, status?: string) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.shipments(page, status ?? 'ALL'),
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set('status', status);
      return api<ShipmentListResponse>('GET', `/api/shipments?${qs.toString()}`);
    },
    enabled: !!token,
    // Retry only transient (network / 5xx) failures, and only a couple of
    // times, a retry FUNCTION overrides any `retry: false` client default,
    // so it must terminate on its own.
    retry: (count, err) => {
      const s = (err as { status?: number }).status;
      return count < 2 && (!s || s >= 500);
    },
    refetchOnWindowFocus: false,
  });
}

/** Paid + unfulfilled orders awaiting a manual AWB, GET /api/shipments/pending. */
export function usePendingOrders() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.pendingOrders(),
    queryFn: () => api<{ items: PendingOrder[] }>('GET', '/api/shipments/pending'),
    enabled: !!token,
    retry: (count, err) => {
      const s = (err as { status?: number }).status;
      return count < 2 && (!s || s >= 500);
    },
    refetchOnWindowFocus: false,
  });
}

/** Manual AWB creation (awbTrigger=manual), POST /api/shipments {order_id}. */
export function useCreateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { order_id: string; order_number?: string }) =>
      api<ShipmentRow>('POST', '/api/shipments', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.shipmentsRoot() });
    },
  });
}

/** Manual "Request Pickup", files a pickup for all pending shipments. */
export function useRequestPickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { date?: string } = {}) =>
      api<{ scheduled: boolean; count: number }>('POST', '/api/pickup', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.shipmentsRoot() });
    },
  });
}
