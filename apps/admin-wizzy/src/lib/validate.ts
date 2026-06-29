import { api } from './api';

export interface ValidateResult {
  ok: boolean;
  error?: string;
}

export function validateWizzy(storeId: string, storeSecret: string, apiKey: string) {
  return api<ValidateResult>('POST', '/api/validate-wizzy', { storeId, storeSecret, apiKey });
}
