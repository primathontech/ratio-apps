import { api } from './api';

export interface ValidateResult {
  ok: boolean;
  error?: string;
  accountName?: string;
}

export function validateGa4(measurementId: string) {
  return api<ValidateResult>('POST', '/api/validate-ga4', { measurementId });
}

export function validateAds(conversionId: string, conversionLabel: string) {
  return api<ValidateResult>('POST', '/api/validate-ads', { conversionId, conversionLabel });
}

export function validateGmc(merchantId: string, key: string) {
  return api<ValidateResult>('POST', '/api/validate-gmc', { merchantId, key });
}
