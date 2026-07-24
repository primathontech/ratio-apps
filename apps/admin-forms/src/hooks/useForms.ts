import type { FormAppearance, FormField, FormInput } from '@shared/schemas/form-schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

/** A form as `GET /api/forms/:id` returns it (backend `FormEntity`). */
export interface FormEntity {
  id: string;
  name: string;
  schema: FormField[];
  submitLabel: string;
  successMessage: string;
  spamProtection: 'recaptcha' | 'honeypot';
  notificationEmail: string | null;
  webhookUrl: string | null;
  description?: string | null;
  redirectUrl?: string | null;
  appearance?: FormAppearance;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface FormListItem {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FormListResult {
  forms: FormListItem[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export function useForms(page = 1) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.forms(page),
    queryFn: () => api<FormListResult>('GET', `/api/forms?page=${page}&limit=20`),
    enabled: !!token,
  });
}

export function useForm(id: string) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.form(id),
    queryFn: () => api<FormEntity>('GET', `/api/forms/${id}`),
    enabled: !!token && !!id,
  });
}

export function useCreateForm() {
  const qc = useQueryClient();
  return useMutation({
    // z.input shape: fields with schema defaults may be omitted on create.
    mutationFn: (input: Partial<FormInput> & Pick<FormInput, 'name' | 'schema'>) =>
      api<FormEntity>('POST', '/api/forms', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.formsAll() });
    },
  });
}

export function useUpdateForm(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => api<FormEntity>('PUT', `/api/forms/${id}`, input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.form(id), data);
      void qc.invalidateQueries({ queryKey: queryKeys.formsAll() });
    },
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>('DELETE', `/api/forms/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.formsAll() });
    },
  });
}

/** Activate/deactivate (list Switch + builder Publish button). */
export function useToggleFormStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<FormEntity>('POST', `/api/forms/${id}/${active ? 'activate' : 'deactivate'}`),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.form(data.id), data);
      void qc.invalidateQueries({ queryKey: queryKeys.formsAll() });
    },
  });
}

export function useDuplicateForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<FormEntity>('POST', `/api/forms/${id}/duplicate`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.formsAll() });
    },
  });
}
