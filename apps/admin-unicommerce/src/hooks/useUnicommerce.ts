import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiException, api } from '../lib/api';
import { useMerchantStore } from '../stores/useMerchantStore';

export type SyncDirection = 'inbound' | 'outbound';
export type SyncFlow =
  | 'auth'
  | 'order_push'
  | 'inventory'
  | 'dispatch'
  | 'cancel'
  | 'status'
  | 'catalog'
  | 'webhook';
export type SyncResult = 'success' | 'failed' | 'partial';

export interface SyncActivityRow {
  id: string;
  merchantId: string;
  direction: SyncDirection;
  flow: SyncFlow;
  reference: string;
  result: SyncResult;
  payload: unknown;
  response: unknown | null;
  createdAt: string;
  // Backs the Retry button: only order_push/cancel_push events raised from
  // `UcSyncQueueService` have a corresponding `uc_sync_jobs` row (migration
  // 0010 on the backend) — every other flow's rows have this null, meaning
  // there is nothing to retry.
  jobId: string | null;
}

export interface SyncActivityListResponse {
  rows: SyncActivityRow[];
  // Derived by the backend fetching limit+1 rows — powers the "Show more"
  // button without a separate COUNT(*) query.
  hasMore: boolean;
}

export interface GenerateCredentialsResponse {
  username: string;
  password: string;
  baseUrl: string;
}

export interface StoredCredentialsResponse {
  username: string;
  password: string;
  ucUsername: string;
  baseUrl: string;
  // Proof-of-life for the connection-status display (§7) — updated on ANY
  // inbound call from Unicommerce, null if none has ever arrived.
  lastInboundCallAt: string | null;
}

export type ReconciliationJobStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface ReconciliationJob {
  id: string;
  merchantId: string;
  requestedBy: 'system' | 'manual';
  timeRangeStart: string;
  timeRangeEnd: string;
  status: ReconciliationJobStatus;
  ordersCheckedCount: number;
  ordersPushedCount: number;
  ordersAlreadySyncedCount: number;
  ordersFailedCount: number;
  startedAt: string;
  completedAt: string | null;
}

export type AlertType = 'INBOUND_SILENCE' | 'STALE_ORDER';

export interface AlertRow {
  id: string;
  merchantId: string;
  type: AlertType;
  reference: string | null;
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface AlertListResponse {
  alerts: AlertRow[];
}

export interface UcConfig {
  productSyncEnabled: boolean;
  inventorySyncEnabled: boolean;
  orderPushEnabled: boolean;
  dispatchStatusSyncEnabled: boolean;
  cancelSyncEnabled: boolean;
  notificationsEnabled: boolean;
}

export type UcConfigInput = Partial<UcConfig>;

// Not added to lib/queryKeys.ts (out of scope for this task — that file is
// shared scaffolding); kept local to this hook module instead.
const syncActivityKey = (merchantId: string | undefined) =>
  ['unicommerce', 'sync-activity', merchantId] as const;
const credentialsKey = (merchantId: string | undefined) =>
  ['unicommerce', 'credentials', merchantId] as const;
const reconcileJobKey = (jobId: string | undefined) =>
  ['unicommerce', 'reconcile-job', jobId] as const;
const alertsKey = (merchantId: string | undefined) =>
  ['unicommerce', 'alerts', merchantId] as const;
const configKey = (merchantId: string | undefined) =>
  ['unicommerce', 'config', merchantId] as const;

/**
 * `limit` grows (5 → 10 → 15…) for "Show more" rather than using `offset` to
 * accumulate pages client-side — simpler and self-correcting: a retry (which
 * invalidates every `sync-activity` query for this merchant, regardless of
 * limit/result) just re-fetches the same already-visible rows fresh, with no
 * separate merge/dedupe logic needed for rows shifting between pages.
 */
export function useSyncActivity(
  merchantId: string | undefined,
  params: { limit?: number; result?: SyncResult } = {},
) {
  const token = useMerchantStore((s) => s.token);
  const { limit = 5, result } = params;
  return useQuery({
    queryKey: [...syncActivityKey(merchantId), { limit, result }],
    queryFn: () => {
      const search = new URLSearchParams({ merchantId: merchantId ?? '', limit: String(limit) });
      if (result) search.set('result', result);
      return api<SyncActivityListResponse>('GET', `/admin/sync-activity?${search.toString()}`);
    },
    enabled: !!token && !!merchantId,
    refetchOnWindowFocus: false,
  });
}

export function useGenerateCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { merchantId: string; ucUsername: string }) =>
      api<GenerateCredentialsResponse>('POST', '/admin/credentials/generate', vars),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: credentialsKey(vars.merchantId) });
    },
    // Defense in depth against a stale build (or a race) calling generate()
    // for a merchant that already has credentials: rather than leaving the
    // UI stuck on a raw error, refetch what's actually on file so it can
    // show the real existing credentials instead.
    onError: (err, vars) => {
      if (err instanceof ApiException && err.errorCode === 'CREDENTIALS_ALREADY_EXIST') {
        qc.invalidateQueries({ queryKey: credentialsKey(vars.merchantId) });
      }
    },
  });
}

/**
 * Fetches the currently-active credentials for a merchant, if any exist —
 * lets the Connect page show what was generated on a PREVIOUS visit instead
 * of always looking like a blank first-time state. Possible only because
 * the password is stored as reversible ciphertext (backend migration 0011),
 * not a one-way hash.
 */
export function useCredentials(merchantId: string | undefined) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: credentialsKey(merchantId),
    queryFn: () =>
      api<StoredCredentialsResponse | null>('GET', `/admin/credentials?merchantId=${merchantId}`),
    enabled: !!token && !!merchantId,
    refetchOnWindowFocus: false,
  });
}

export function useRegenerateCredentials(merchantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<GenerateCredentialsResponse>('POST', '/admin/credentials/regenerate', { merchantId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: credentialsKey(merchantId) });
    },
  });
}

export function useRetrySyncActivity(merchantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      api<{ ok: boolean }>('POST', `/admin/sync-activity/${jobId}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: syncActivityKey(merchantId) });
    },
  });
}

/**
 * Manual Reconciliation panel (§7): kicks off a reconciliation run for a
 * merchant/time-range and returns just the job id (202-style) — the caller
 * is expected to then poll `useReconciliationJob` with that id.
 */
export function useTriggerReconciliation() {
  return useMutation({
    mutationFn: (vars: { merchantId: string; timeRangeStart: string; timeRangeEnd: string }) =>
      api<{ jobId: string }>('POST', '/admin/reconcile', vars),
  });
}

/**
 * Polls a reconciliation job's progress/results while `RUNNING` — same
 * poll-while-running convention as `admin-meta`/`admin-wizzy`'s catalog sync
 * status hooks (`refetchInterval` keyed off the job's own status field).
 */
export function useReconciliationJob(jobId: string | undefined) {
  return useQuery({
    queryKey: reconcileJobKey(jobId),
    queryFn: () => api<ReconciliationJob>('GET', `/admin/reconcile/${jobId}`),
    enabled: !!jobId,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 3000 : false),
  });
}

export function useAlerts(merchantId: string | undefined) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: alertsKey(merchantId),
    queryFn: () => api<AlertListResponse>('GET', `/admin/alerts?merchantId=${merchantId}`),
    enabled: !!token && !!merchantId,
    refetchOnWindowFocus: false,
  });
}

export function useAcknowledgeAlert(merchantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { alertId: string; acknowledgedBy: string }) =>
      api<{ ok: boolean }>('POST', `/admin/alerts/${vars.alertId}/acknowledge`, {
        acknowledgedBy: vars.acknowledgedBy,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: alertsKey(merchantId) });
    },
  });
}

export function useConfig(merchantId: string | undefined) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: configKey(merchantId),
    queryFn: () => api<UcConfig>('GET', `/admin/config?merchantId=${merchantId}`),
    enabled: !!token && !!merchantId,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateConfig(merchantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partialUpdate: UcConfigInput) =>
      api<UcConfig>('PUT', `/admin/config?merchantId=${merchantId}`, partialUpdate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configKey(merchantId) });
    },
  });
}
