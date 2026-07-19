import type { DelhiveryConfig, DelhiveryConfigInput } from '@shared/schemas/delhivery-config';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

/**
 * The masked shape the backend returns, the Delhivery API token NEVER leaves
 * the backend in plaintext. `apiTokenMasked` is `''` or `••••` + last 4 chars.
 */
export type MaskedDelhiveryConfig = Omit<DelhiveryConfig, 'apiToken'> & {
  apiTokenMasked: string;
  hasApiToken: boolean;
};

/**
 * `created` = new warehouse; `exists` = already registered, unchanged;
 * `updated` = existing warehouse's address synced via edit; `failed` = couldn't register/update.
 */
export type WarehouseStatus = 'created' | 'exists' | 'updated' | 'failed';

/** POST /api/delhivery-config/warehouse response. */
export interface WarehouseRegistration {
  warehouseStatus: WarehouseStatus;
  /** Delhivery's own message for the outcome, displayed verbatim, not hardcoded. */
  warehouseMessage: string;
}

/** POST /api/delhivery-config/test response. */
export interface TestConnectionResult {
  ok: boolean;
  status: number;
}

export function useConfig() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: () => api<MaskedDelhiveryConfig>('GET', '/api/delhivery-config'),
    // Skip when no session token (was causing an infinite 401 retry loop).
    enabled: !!token,
    // Don't retry on any 4xx, neither 401 (no session), 403 (forbidden),
    // nor 404 (no config yet) is recoverable by retrying.
    retry: (_count, err) => {
      const status = (err as { status?: number }).status;
      return !status || status >= 500;
    },
    // Cache the config row for the navigation session. Mutations call
    // `qc.setQueryData(...)` after a successful save so we never serve a
    // stale view of the user's own edits.
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** PUT the config. Persists only; never talks to Delhivery. */
export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DelhiveryConfigInput) =>
      api<MaskedDelhiveryConfig>('PUT', '/api/delhivery-config', input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.config(), data);
    },
  });
}

/**
 * Register the SAVED pickup location as a Delhivery warehouse. The only
 * mutation that reaches the carrier; save the config first, then register.
 */
export function useRegisterWarehouse() {
  return useMutation({
    mutationFn: () => api<WarehouseRegistration>('POST', '/api/delhivery-config/warehouse'),
  });
}

/**
 * Validate the SAVED Delhivery token against the live API. The backend tests
 * the stored (encrypted) token, save the config first, then test.
 */
export function useTestConnection() {
  return useMutation({
    mutationFn: () => api<TestConnectionResult>('POST', '/api/delhivery-config/test'),
  });
}
