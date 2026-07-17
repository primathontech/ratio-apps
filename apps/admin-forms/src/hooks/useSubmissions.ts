import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export interface SubmissionListItem {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  files: Record<string, string>;
  recaptchaScore: number | null;
  createdAt: string;
}

export interface SubmissionListResult {
  submissions: SubmissionListItem[];
  page: number;
  limit: number;
  hasMore: boolean;
}

/** Row expand: same item plus field key → 7-day signed file URL. */
export interface SubmissionDetail extends SubmissionListItem {
  fileUrls: Record<string, string>;
}

export interface DeliveryRow {
  id: number;
  submissionId: string;
  formId: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastStatusCode: number | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryListResult {
  deliveries: DeliveryRow[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export function useSubmissions(formId: string, page = 1) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.submissions(formId, page),
    queryFn: () =>
      api<SubmissionListResult>('GET', `/api/forms/${formId}/submissions?page=${page}&limit=20`),
    enabled: !!token && !!formId,
  });
}

/** Fetched lazily — only once a row is expanded (signed URLs are minted here). */
export function useSubmissionDetail(submissionId: string | null) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.submissionDetail(submissionId ?? ''),
    queryFn: () => api<SubmissionDetail>('GET', `/api/submissions/${submissionId}`),
    enabled: !!token && !!submissionId,
  });
}

export function useDeliveries(formId: string, page = 1) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.deliveries(formId, page),
    queryFn: () =>
      api<DeliveryListResult>('GET', `/api/forms/${formId}/deliveries?page=${page}&limit=20`),
    enabled: !!token && !!formId,
  });
}

export function useRetriggerDelivery(formId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: number) =>
      api<{ status: string }>('POST', `/api/deliveries/${deliveryId}/retrigger`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.deliveriesAll(formId) });
    },
  });
}

// ─── async CSV export (background job → S3 → signed download URL) ────────────

export type ExportJobStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface CreateExportResult {
  jobId: string;
  status: ExportJobStatus;
}

export interface ExportJobResult {
  status: ExportJobStatus;
  rowCount?: number;
  /** 1-hour signed S3 URL — present only once `status === 'ready'`. */
  downloadUrl?: string;
}

/** POST that enqueues a background export; resolves with the job id to poll. */
export function useCreateExport(formId: string) {
  return useMutation({
    mutationFn: () => api<CreateExportResult>('POST', `/api/forms/${formId}/exports`),
  });
}

/**
 * Poll an export job every ~2s until it reaches a terminal state
 * (`ready`/`failed`), at which point polling stops. Enabled only while a
 * `jobId` is set.
 */
export function useExportJob(formId: string, jobId: string | null) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.exportJob(formId, jobId ?? ''),
    queryFn: () => api<ExportJobResult>('GET', `/api/forms/${formId}/exports/${jobId}`),
    enabled: !!token && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'ready' || status === 'failed' ? false : 2000;
    },
  });
}

// The api() wrapper JSON-parses everything, and window.open can't carry the
// Authorization header — so CSV export fetches the bytes itself and triggers
// a client-side download.
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const BASE = RAW_BASE.endsWith('/') ? `${RAW_BASE.slice(0, -1)}/forms` : `${RAW_BASE}/forms`;

export async function downloadSubmissionsCsv(formId: string): Promise<void> {
  const token = useMerchantStore.getState().token;
  const res = await fetch(`${BASE}/api/forms/${formId}/submissions/export`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${formId}-submissions.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
