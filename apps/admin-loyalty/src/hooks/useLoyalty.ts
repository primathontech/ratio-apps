import type { LoyaltyCustomerFilters } from '@shared/schemas/loyalty-export';
import type { LoyaltyConditionNode } from '@shared/schemas/loyalty-rules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

/**
 * React Query hooks for every `/loyalty/api/*` admin endpoint (TRD §2).
 * Response interfaces mirror the backend DTOs exactly — with Dates arriving
 * as ISO strings after JSON serialization.
 */

// ─── Background-job polling policy ──────────────────────────────────────────

/**
 * How long a job may go without the server touching it before we treat it as
 * stalled and stop polling. A lost SQS message, a stopped worker or a DLQ'd
 * batch leaves a job on `processing` forever; a naive fixed interval would
 * then refetch every 2s for as long as the tab stays open — indefinitely, on
 * every open tab.
 */
const STALL_AFTER_MS = 5 * 60 * 1000;

/**
 * Back off as a job goes quiet: snappy while rows are visibly landing, slower
 * once nothing has moved for a while, and off entirely past {@link
 * STALL_AFTER_MS}. `StalledHint` in the UI explains the stop and offers a
 * manual refresh, so a genuinely slow job is never a dead end.
 */
const POLL_STEPS: { quietForMs: number; everyMs: number }[] = [
  { quietForMs: 30_000, everyMs: 2_000 },
  { quietForMs: 120_000, everyMs: 5_000 },
  { quietForMs: STALL_AFTER_MS, everyMs: 15_000 },
];

/**
 * The interval for a job last touched at `lastProgressAt`, or `false` to stop.
 *
 * @param running   is the job in a non-terminal state?
 * @param lastProgressAt  server-side `updatedAt` (ISO). Undefined = no signal
 *                        yet, so poll at the base rate.
 */
export function jobPollInterval(
  running: boolean,
  lastProgressAt: string | undefined,
): number | false {
  if (!running) return false;
  const touchedAt = lastProgressAt ? Date.parse(lastProgressAt) : Number.NaN;
  if (Number.isNaN(touchedAt)) return POLL_STEPS[0]?.everyMs ?? 2_000;
  const quietFor = Date.now() - touchedAt;
  // A clock skewed into the future must not read as "stalled long ago".
  if (quietFor < 0) return POLL_STEPS[0]?.everyMs ?? 2_000;
  for (const step of POLL_STEPS) {
    if (quietFor < step.quietForMs) return step.everyMs;
  }
  return false; // stalled — stop and let the merchant retry by hand
}

/** True once we have given up polling a job that never finished. */
export function isStalled(status: string, lastProgressAt: string | undefined): boolean {
  if (!isRunningStatus(status)) return false;
  const touchedAt = lastProgressAt ? Date.parse(lastProgressAt) : Number.NaN;
  if (Number.isNaN(touchedAt)) return false;
  return Date.now() - touchedAt >= STALL_AFTER_MS;
}

export function isRunningStatus(status: string): boolean {
  return status === 'pending' || status === 'validating' || status === 'processing';
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export interface DashboardSummary {
  pointsIssued: number;
  pointsRedeemed: number;
  pointsExpired: number;
  /** redeemed / issued as a percentage, one decimal. */
  redemptionRate: number;
  customersWithBalance: number;
  outstandingPoints: number;
}

export interface TrendPoint {
  date: string;
  pointsIssued: number;
  pointsRedeemed: number;
  pointsExpired: number;
}

export interface RulePerfRow {
  id: string;
  name: string;
  ruleType: string;
  active: boolean;
  matches: number;
  extraCoins: number;
  uniqueCustomers: number;
}

export type QrState = 'active' | 'not_started' | 'expired' | 'paused' | 'fully_claimed';

export interface QrPerfRow {
  id: string;
  code: string;
  eventName: string;
  state: QrState;
  scanCount: number;
  newPhoneCount: number;
  converted: number;
  conversionRate: number;
}

export interface BulkDashboardSummary {
  bulkCredited: number;
  bulkDebited: number;
  operations: number;
}

function rangeQuery(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function useToken(): string | null {
  return useMerchantStore((s) => s.token);
}

export function useDashboardSummary(from?: string, to?: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.dashboardSummary(from, to),
    queryFn: () => api<DashboardSummary>('GET', `/api/dashboard/summary${rangeQuery(from, to)}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useDashboardTrend(from?: string, to?: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.dashboardTrend(from, to),
    queryFn: () => api<TrendPoint[]>('GET', `/api/dashboard/trend${rangeQuery(from, to)}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useDashboardRules() {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.dashboardRules(),
    queryFn: () => api<RulePerfRow[]>('GET', '/api/dashboard/rules'),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useDashboardQr() {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.dashboardQr(),
    queryFn: () => api<QrPerfRow[]>('GET', '/api/dashboard/qr'),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useDashboardBulk(from?: string, to?: string) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.dashboardBulk(from, to),
    queryFn: () => api<BulkDashboardSummary>('GET', `/api/dashboard/bulk${rangeQuery(from, to)}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

// ─── Bulk operations ────────────────────────────────────────────────────────

export type BulkOperationStatus =
  | 'validating'
  | 'awaiting_confirm'
  | 'processing'
  | 'done'
  | 'failed';

export interface BulkOperation {
  id: string;
  type: 'credit' | 'debit';
  status: BulkOperationStatus | string;
  fileName: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  processedRows: number;
  successCount: number;
  failureCount: number;
  /** Coins the operation moves, after duplicate-phone last-wins. 0 pre-confirm. */
  totalPoints: number;
  createdAt: string;
  /** Server-side liveness signal — drives the poll backoff / stall stop. */
  updatedAt: string;
}

export type BulkRowStatus = 'pending' | 'success' | 'failed' | 'skipped';

export interface BulkOperationRow {
  rowNumber: number;
  phone: string;
  points: number;
  reason: string | null;
  status: BulkRowStatus | string;
  errorReason: string | null;
  coreTransactionId: string | null;
  processedAt: string | null;
}

export interface BulkOpRowsPage {
  items: BulkOperationRow[];
  total: number;
  page: number;
  limit: number;
}

export interface BulkOpsPage {
  items: BulkOperation[];
  total: number;
  page: number;
  limit: number;
}

export interface BulkRowPayload {
  rowNumber: number;
  phone: string;
  points: number;
  reason?: string;
}

export function useBulkOps(page = 1, limit = 20) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.bulkOps(page, limit),
    queryFn: () => api<BulkOpsPage>('GET', `/api/bulk-operations?page=${page}&limit=${limit}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
    // The worker drains rows in the background, so a freshly-confirmed upload
    // lands here as `processing` with 0/N rows and then never moves — the
    // merchant had to reload the page to learn what their CSV actually did.
    // Poll while anything is in flight; back off and stop for a job the server
    // has gone quiet on, so a stuck operation can't poll forever.
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const running = (query.state.data?.items ?? []).filter((op) => isRunningStatus(op.status));
      if (running.length === 0) return false;
      // Freshest signal across the running jobs wins — one live job keeps the
      // list responsive even next to an older stalled one.
      const intervals = running
        .map((op) => jobPollInterval(true, op.updatedAt))
        .filter((ms): ms is number => ms !== false);
      return intervals.length > 0 ? Math.min(...intervals) : false;
    },
  });
}

/** Progress read — polls while the backend is still working through rows. */
export function useBulkOp(id: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.bulkOp(id ?? 'none'),
    queryFn: () => api<BulkOperation>('GET', `/api/bulk-operations/${id}`),
    enabled: !!token && !!id,
    refetchOnWindowFocus: false,
    // Stop on error too: a 401/500 leaves the last-known `processing` data in
    // place, so a status-only check would keep retrying a broken call forever.
    refetchInterval: (query) =>
      query.state.status === 'error'
        ? false
        : jobPollInterval(
            isRunningStatus(query.state.data?.status ?? ''),
            query.state.data?.updatedAt,
          ),
  });
}

/**
 * One page of an operation's rows — which customers it touched and what
 * happened to each. Only fetched while the detail view is open (`id` non-null).
 */
export function useBulkOpRows(id: string | null, page = 1, limit = 50) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.bulkOpRows(id ?? 'none', page),
    queryFn: () =>
      api<BulkOpRowsPage>('GET', `/api/bulk-operations/${id}/rows?page=${page}&limit=${limit}`),
    enabled: !!token && !!id,
    refetchOnWindowFocus: false,
    // Rows flip from `pending` as the worker gets to them; keep the open
    // detail view live rather than making the merchant close and reopen it.
    // `processedAt` of the most recently settled row is the liveness signal,
    // so a stalled operation stops this poll exactly like the others.
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const items = query.state.data?.items ?? [];
      if (!items.some((row) => row.status === 'pending')) return false;
      const lastProcessed = items
        .map((row) => row.processedAt)
        .filter((at): at is string => Boolean(at))
        .sort()
        .at(-1);
      return jobPollInterval(true, lastProcessed);
    },
  });
}

export function useCreateBulkOp() {
  return useMutation({
    mutationFn: (input: { type: 'credit' | 'debit'; fileName?: string; totalRows?: number }) =>
      api<BulkOperation>('POST', '/api/bulk-operations', input),
  });
}

export function useIngestRows() {
  return useMutation({
    mutationFn: ({ id, rows }: { id: string; rows: BulkRowPayload[] }) =>
      api<{ received: number; validRows: number; invalidRows: number }>(
        'POST',
        `/api/bulk-operations/${id}/rows`,
        { rows },
      ),
  });
}

export function useConfirmBulkOp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<BulkOperation & { duplicateWarnings: number }>(
        'POST',
        `/api/bulk-operations/${id}/confirm`,
      ),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.bulkOp(data.id), data);
      qc.invalidateQueries({ queryKey: ['loyalty', 'bulk-ops'] });
    },
  });
}

// ─── Earning rules ──────────────────────────────────────────────────────────

export interface LoyaltyRule {
  id: string;
  name: string;
  ruleType: 'MULTIPLIER' | 'BONUS';
  value: number;
  targetType: 'SEGMENT' | 'CUSTOMER_LIST';
  conditions: LoyaltyConditionNode | null;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  priority: number;
  createdAt?: string;
  updatedAt?: string;
}

/** JSON-friendly create/update payload (backend coerces the date strings). */
export interface LoyaltyRulePayload {
  name: string;
  ruleType: 'MULTIPLIER' | 'BONUS';
  value: number;
  targetType: 'SEGMENT' | 'CUSTOMER_LIST';
  conditions?: LoyaltyConditionNode | null;
  startsAt: string;
  endsAt?: string | null;
  active: boolean;
  priority: number;
}

export interface RuleCustomersPage {
  items: string[];
  total: number;
  page: number;
  limit: number;
}

export interface RulePerformance {
  matches: number;
  extraCoins: number;
  uniqueCustomers: number;
}

export function useRules() {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.rules(),
    queryFn: () => api<LoyaltyRule[]>('GET', '/api/rules'),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useRule(id: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.rule(id ?? 'none'),
    queryFn: () => api<LoyaltyRule>('GET', `/api/rules/${id}`),
    enabled: !!token && !!id,
    refetchOnWindowFocus: false,
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoyaltyRulePayload) => api<LoyaltyRule>('POST', '/api/rules', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.rules() }),
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LoyaltyRulePayload }) =>
      api<LoyaltyRule>('PUT', `/api/rules/${id}`, input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.rule(data.id), data);
      qc.invalidateQueries({ queryKey: queryKeys.rules() });
    },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ deleted: true }>('DELETE', `/api/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.rules() }),
  });
}

export function useSetRuleActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<LoyaltyRule>('POST', `/api/rules/${id}/status`, { active }),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.rule(data.id), data);
      qc.invalidateQueries({ queryKey: queryKeys.rules() });
    },
  });
}

export function useRuleCustomers(id: string | null, page = 1, limit = 20) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.ruleCustomers(id ?? 'none', page),
    queryFn: () =>
      api<RuleCustomersPage>('GET', `/api/rules/${id}/customers?page=${page}&limit=${limit}`),
    enabled: !!token && !!id,
    refetchOnWindowFocus: false,
  });
}

export function useAppendRuleCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, phones }: { id: string; phones: string[] }) =>
      api<{ added: number; invalid: number }>('POST', `/api/rules/${id}/customers`, { phones }),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['loyalty', 'rule-customers', vars.id] }),
  });
}

export function useRemoveRuleCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, phones }: { id: string; phones: string[] }) =>
      api<{ removed: number }>('DELETE', `/api/rules/${id}/customers`, { phones }),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['loyalty', 'rule-customers', vars.id] }),
  });
}

export function useRulePerformance(id: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.rulePerformance(id ?? 'none'),
    queryFn: () => api<RulePerformance>('GET', `/api/rules/${id}/performance`),
    enabled: !!token && !!id,
    refetchOnWindowFocus: false,
  });
}

// ─── QR codes ───────────────────────────────────────────────────────────────

export type QrStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED';

export interface QrCode {
  id: string;
  code: string;
  eventName: string;
  pointsPerScan: number;
  maxScans: number;
  startsAt: string;
  expiresAt: string;
  claimMessage: string | null;
  status: QrStatus;
  scanCount: number;
  newPhoneCount: number;
  state: QrState;
  createdAt?: string;
  updatedAt?: string;
}

export interface QrDetail extends QrCode {
  claimUrl: string | null;
  loaderSnippet: string;
}

export interface QrPayload {
  eventName: string;
  pointsPerScan: number;
  maxScans: number;
  startsAt: string;
  expiresAt: string;
  claimMessage?: string;
}

export interface QrScan {
  id: number;
  qrCodeId: string;
  phone: string;
  isNewPhone: boolean | 0 | 1;
  coreTransactionId: string | null;
  convertedOrderId: string | null;
  convertedAt: string | null;
  scannedAt: string;
}

export interface QrScansPage {
  rows: QrScan[];
  total: number;
  page: number;
  limit: number;
}

export function useQrCodes() {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.qrCodes(),
    queryFn: () => api<QrCode[]>('GET', '/api/qr-codes'),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useQrCode(id: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.qrCode(id ?? 'none'),
    queryFn: () => api<QrDetail>('GET', `/api/qr-codes/${id}`),
    enabled: !!token && !!id,
    refetchOnWindowFocus: false,
  });
}

export function useCreateQr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QrPayload) =>
      api<QrCode & { claimUrl: string }>('POST', '/api/qr-codes', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.qrCodes() }),
  });
}

export function useUpdateQr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: QrPayload }) =>
      api<QrCode>('PUT', `/api/qr-codes/${id}`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.qrCode(data.id) });
      qc.invalidateQueries({ queryKey: queryKeys.qrCodes() });
    },
  });
}

export function useSetQrStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'PAUSED' | 'ACTIVE' }) =>
      api<QrCode>('POST', `/api/qr-codes/${id}/status`, { status }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.qrCode(data.id) });
      qc.invalidateQueries({ queryKey: queryKeys.qrCodes() });
    },
  });
}

export function useQrScans(id: string | null, page = 1, limit = 20) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.qrScans(id ?? 'none', page),
    queryFn: () => api<QrScansPage>('GET', `/api/qr-codes/${id}/scans?page=${page}&limit=${limit}`),
    enabled: !!token && !!id,
    refetchOnWindowFocus: false,
  });
}

// ─── Exports ────────────────────────────────────────────────────────────────

export type ExportStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface ExportJob {
  id: string;
  status: ExportStatus | string;
  filters: LoyaltyCustomerFilters;
  email: string | null;
  rowCount: number | null;
  /** Set when `status === 'failed'` — why it failed, in merchant language. */
  errorReason: string | null;
  emailedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /** Server-side liveness signal — drives the poll backoff / stall stop. */
  updatedAt: string;
}

export interface ExportsPage {
  items: ExportJob[];
  total: number;
  page: number;
  limit: number;
}

export function useExports(page = 1, limit = 20) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.exports(),
    queryFn: () => api<ExportsPage>('GET', `/api/exports?page=${page}&limit=${limit}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
    // Keep the history table fresh while a job is running — with the same
    // backoff-and-give-up policy, so an export the worker never picks up
    // can't poll indefinitely.
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const running = (query.state.data?.items ?? []).filter((j) => isRunningStatus(j.status));
      if (running.length === 0) return false;
      const intervals = running
        .map((j) => jobPollInterval(true, j.updatedAt))
        .filter((ms): ms is number => ms !== false);
      return intervals.length > 0 ? Math.min(...intervals) : false;
    },
  });
}

export function useCreateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { filters: LoyaltyCustomerFilters; email?: string }) =>
      api<ExportJob & { rowCountEstimate: number }>('POST', '/api/exports', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.exports() }),
  });
}

// ─── Customers ──────────────────────────────────────────────────────────────

export type CustomerSort =
  | 'points_balance'
  | 'lifetime_earned'
  | 'lifetime_spend'
  | 'lifetime_orders'
  | 'last_order_at';

export interface CustomerRow {
  merchantId: string;
  phone: string;
  name: string | null;
  email: string | null;
  pointsBalance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  lifetimeExpired: number;
  lifetimeAdjusted: number;
  /** DECIMAL — arrives as a string from mysql2. */
  lifetimeSpend: string;
  lifetimeOrders: number;
  lastOrderAt: string | null;
  firstSeenSource: 'order' | 'bulk' | 'qr' | 'manual';
  balanceSyncedAt: string | null;
}

export interface CustomersPage {
  rows: CustomerRow[];
  total: number;
}

export interface CoreBalance {
  phone: string;
  points_balance: number;
  points_earned_lifetime: number;
  points_redeemed_lifetime: number;
  points_expired_lifetime: number;
  points_adjusted_lifetime: number;
}

export interface CustomerProfile {
  profile: CustomerRow;
  balance: CoreBalance;
  history: { items: Record<string, unknown>[]; pagination: Record<string, unknown> };
}

export function useCustomers(
  filters: LoyaltyCustomerFilters,
  sort: CustomerSort = 'points_balance',
  page = 1,
  limit = 20,
) {
  const token = useToken();
  const filtersKey = JSON.stringify(filters);
  const params = new URLSearchParams({ sort, page: String(page), limit: String(limit) });
  if (filters.length > 0) params.set('filters', filtersKey);
  return useQuery({
    queryKey: queryKeys.customers(filtersKey, sort, page, limit),
    queryFn: () => api<CustomersPage>('GET', `/api/customers?${params.toString()}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useCustomerProfile(phone: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.customerProfile(phone ?? 'none'),
    queryFn: () => api<CustomerProfile>('GET', `/api/customers/${encodeURIComponent(phone ?? '')}`),
    enabled: !!token && !!phone,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useAdjustCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      phone,
      input,
    }: {
      phone: string;
      input: { direction: 'credit' | 'debit'; points: number; reason: string };
    }) =>
      api<{ direction: 'credit' | 'debit'; points: number; newBalance: number }>(
        'POST',
        `/api/customers/${encodeURIComponent(phone)}/adjust`,
        input,
      ),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: queryKeys.customerProfile(vars.phone) }),
  });
}
